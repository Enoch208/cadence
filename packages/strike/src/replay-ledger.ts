import {
  initialMargin,
  type DecimalString,
  type ExchangeFill,
  type ExchangeOrderSnapshot,
  type OrderSide,
} from "@cadence/core";
import {
  absDecimal,
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  negateDecimal,
  subtractDecimal,
} from "./exact";

export type ReplayPosition = {
  signedSize: DecimalString;
  entryPrice: DecimalString;
  leverage: number;
};

const quotePlaces = 8;
const direction = (side: OrderSide) => (side === "buy" ? 1 : -1);
const signed = (side: OrderSide, size: DecimalString) =>
  side === "buy" ? size : negateDecimal(size);
const smaller = (a: DecimalString, b: DecimalString) => (compareDecimal(a, b) <= 0 ? a : b);

export function createReplayLedger(args: {
  startingBalance: DecimalString;
  takerRate: DecimalString;
  now: () => number;
}) {
  const fills: ExchangeFill[] = [];
  let position: ReplayPosition | null = null;
  let realized = "0";
  let feesPaid = "0";

  function reduce(
    open: ReplayPosition,
    side: OrderSide,
    price: DecimalString,
    size: DecimalString,
  ) {
    const closing = smaller(size, absDecimal(open.signedSize));
    const perUnit =
      side === "sell"
        ? subtractDecimal(price, open.entryPrice)
        : subtractDecimal(open.entryPrice, price);
    realized = addDecimal(realized, multiplyDecimal(perUnit, closing));
    const left = addDecimal(open.signedSize, signed(side, closing));
    position = compareDecimal(left, "0") === 0 ? null : { ...open, signedSize: left };
    return subtractDecimal(size, closing);
  }

  function increase(side: OrderSide, price: DecimalString, size: DecimalString, leverage: number) {
    if (position === null) {
      position = { signedSize: signed(side, size), entryPrice: price, leverage };
      return;
    }
    const total = addDecimal(position.signedSize, signed(side, size));
    const cost = addDecimal(
      multiplyDecimal(absDecimal(position.signedSize), position.entryPrice),
      multiplyDecimal(size, price),
    );
    position = {
      ...position,
      signedSize: total,
      entryPrice: divideDecimal(cost, absDecimal(total), quotePlaces),
    };
  }

  function fill(
    order: ExchangeOrderSnapshot,
    price: DecimalString,
    size: DecimalString,
    leverage: number,
  ): { positionClosed: boolean } {
    const fee = multiplyDecimal(multiplyDecimal(price, size), args.takerRate);
    feesPaid = addDecimal(feesPaid, fee);
    order.status = "filled";
    order.filled = size;
    fills.push({
      fillId: `${order.orderId}-fill-${String(fills.filter((existing) => existing.orderId === order.orderId).length + 1)}`,
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price,
      size,
      fee,
      filledAt: args.now(),
    });
    const before = position;
    const opposing =
      before !== null && compareDecimal(before.signedSize, "0") !== direction(order.side);
    const remaining = opposing ? reduce(before, order.side, price, size) : size;
    if (compareDecimal(remaining, "0") > 0) {
      increase(order.side, price, remaining, leverage);
    }
    const after = position === null ? 0 : compareDecimal(position.signedSize, "0");
    return { positionClosed: opposing && after !== compareDecimal(before.signedSize, "0") };
  }

  function availableBalance(): DecimalString {
    const margin =
      position === null
        ? "0"
        : initialMargin(
            multiplyDecimal(absDecimal(position.signedSize), position.entryPrice),
            position.leverage,
          );
    return subtractDecimal(
      subtractDecimal(addDecimal(args.startingBalance, realized), feesPaid),
      margin,
    );
  }

  return {
    fill,
    availableBalance,
    position: (): ReplayPosition | null => position,
    fills: (symbol: string, sinceMs: number) =>
      fills
        .filter((entry) => entry.symbol === symbol && entry.filledAt >= sinceMs)
        .map((entry) => ({ ...entry })),
  };
}
