import type { AccountState, DecimalString, ExchangeOrderSnapshot, OrderSide } from "@cadence/core";
import type {
  OrderAck,
  ReduceOnlyClose,
  StrategyAck,
  StrategyOrder,
  SymbolConfiguration,
} from "./client";
import { StrikeRejectedError } from "./errors";
import { absDecimal, compareDecimal } from "./exact";
import { strategyRequestBody } from "./orders";
import { createReplayLedger } from "./replay-ledger";
import { replayMark, ruleViolation } from "./replay-rules";
import { capturedTierZeroFees, type ReplayScenario } from "./replay-scenarios";

type OrderFields = Omit<ExchangeOrderSnapshot, "orderId" | "symbol">;

const liveStatuses: readonly ExchangeOrderSnapshot["status"][] = ["pending", "open", "untriggered"];
const opposite = (side: OrderSide): OrderSide => (side === "buy" ? "sell" : "buy");

export function createReplayExchange(scenario: ReplayScenario, now: () => number) {
  const { market } = scenario;
  const accountId = `replay:${scenario.name}`;
  const orders: ExchangeOrderSnapshot[] = [];
  const submitted: StrategyOrder[] = [];
  let sequence = 0;
  let leverage = scenario.leverage;
  const nextId = () => String(1_000_000 + (sequence += 1));
  const ledger = createReplayLedger({
    startingBalance: scenario.availableBalance,
    takerRate: capturedTierZeroFees.takerRate,
    now,
    nextId,
  });
  const isLive = (order: ExchangeOrderSnapshot) => liveStatuses.includes(order.status);
  const mark = () => replayMark(scenario, now() - scenario.marketDataAgeMs);
  const rejected = (operation: string, message: string) =>
    new StrikeRejectedError({ operation, status: 400, code: null, message });

  function record(fields: OrderFields): ExchangeOrderSnapshot {
    const order = { orderId: nextId(), symbol: market.symbol, ...fields };
    orders.push(order);
    return order;
  }

  function execute(order: ExchangeOrderSnapshot, price: DecimalString, size: DecimalString) {
    if (ledger.fill(order, price, size, leverage).positionClosed) {
      for (const live of orders.filter((other) => other.reduceOnly && isLive(other))) {
        live.status = "canceled";
        live.closeReason = "position_closed";
      }
    }
  }

  function placeStrategy(order: StrategyOrder): StrategyAck {
    strategyRequestBody(order);
    const problem = ruleViolation(order, market, mark());
    if (problem !== null) {
      throw rejected("placeStrategy", problem);
    }
    submitted.push({ ...order });
    const buying = order.side === "buy";
    const quote = buying ? scenario.ask : scenario.bid;
    const reachable = compareDecimal(quote, order.limitPrice) * (buying ? 1 : -1) <= 0;
    const fillable = reachable && compareDecimal(scenario.depthSize, order.size) >= 0;
    const shared = {
      strategyId: order.strategyId,
      size: order.size,
      filled: "0",
      closeReason: null,
    };
    const primary = record({
      ...shared,
      clientOrderId: order.entryClientOrderId,
      side: order.side,
      type: "limit",
      status: "expired",
      price: order.limitPrice,
      stopPrice: null,
      reduceOnly: false,
      isStrategyPrimary: true,
    });
    if (fillable) {
      execute(primary, quote, order.size);
    }
    if (!scenario.behaviour.omitExitLegs) {
      const leg = {
        ...shared,
        side: opposite(order.side),
        price: null,
        reduceOnly: true,
        isStrategyPrimary: false,
        status: fillable ? "untriggered" : "expired",
        closeReason: fillable ? null : "order_strategy_primary_closed",
      } as const;
      record({
        ...leg,
        clientOrderId: order.stopClientOrderId,
        type: "stop",
        stopPrice: order.stopPrice,
      });
      record({
        ...leg,
        clientOrderId: order.targetClientOrderId,
        type: "take_profit",
        stopPrice: order.targetPrice,
      });
    }
    return {
      strategyId: order.strategyId,
      entryClientOrderId: order.entryClientOrderId,
      accountId,
      acknowledgedAt: now(),
    };
  }

  function closeReduceOnly(close: ReduceOnlyClose): OrderAck {
    if (close.symbol !== market.symbol) {
      throw rejected("closeReduceOnly", "the replay exchange lists only its scenario's market");
    }
    const order = record({
      clientOrderId: close.clientOrderId,
      side: close.side,
      type: "market",
      status: "rejected",
      size: close.size,
      filled: "0",
      price: null,
      stopPrice: null,
      reduceOnly: true,
      strategyId: null,
      isStrategyPrimary: false,
      closeReason: null,
    });
    const position = ledger.position();
    const held = position === null ? 0 : compareDecimal(position.signedSize, "0");
    if (position === null || held === (close.side === "buy" ? 1 : -1)) {
      order.closeReason = position === null ? "no_open_position" : "order_increase_position";
    } else {
      const size = absDecimal(position.signedSize);
      const clamped = compareDecimal(close.size, size) <= 0 ? close.size : size;
      execute(order, close.side === "sell" ? scenario.bid : scenario.ask, clamped);
    }
    return { clientOrderId: close.clientOrderId, accountId, acknowledgedAt: now() };
  }

  function configure(symbol: string, settings: SymbolConfiguration) {
    if (symbol !== market.symbol) {
      throw rejected("leverage", "the replay exchange lists only its scenario's market");
    }
    const cap = market.marginTiers[0]?.maxLeverage ?? 1;
    if (!Number.isInteger(settings.leverage) || settings.leverage < 1 || settings.leverage > cap) {
      throw rejected("leverage", `leverage must be a whole number from 1 to ${String(cap)}`);
    }
    leverage = settings.leverage;
  }

  const latest = (symbol: string, clientOrderId: string) =>
    orders.findLast((order) => order.symbol === symbol && order.clientOrderId === clientOrderId);
  const openOrders = (symbol: string | null) =>
    orders
      .filter((order) => (symbol === null || order.symbol === symbol) && isLive(order))
      .map((order) => ({ ...order }));

  function accountState(symbol: string): AccountState {
    const position = ledger.position();
    const held = position !== null && symbol === market.symbol;
    return {
      account: {
        accountId,
        environment: "replay",
        availableBalance: ledger.availableBalance(),
        observedAt: now(),
      },
      positions: held
        ? [{ symbol, ...position, marginMode: "isolated", liquidationPrice: null }]
        : [],
      openOrders: openOrders(symbol),
      symbolSettings: { symbol, marginMode: "isolated", leverage },
    };
  }

  return {
    mark,
    placeStrategy,
    closeReduceOnly,
    configure,
    accountState,
    openOrders,
    cancel: (symbol: string, clientOrderId: string) => {
      const order = latest(symbol, clientOrderId);
      if (order !== undefined && isLive(order)) {
        order.status = "canceled";
      }
    },
    order: (symbol: string, clientOrderId: string) => {
      const order = latest(symbol, clientOrderId);
      return order === undefined ? null : { ...order };
    },
    fills: ledger.fills,
    submitted: (): readonly StrategyOrder[] => submitted.map((order) => ({ ...order })),
  };
}
