import type {
  AccountState,
  BookSnapshot,
  DecimalString,
  Environment,
  ExchangeFill,
  ExchangeOrderSnapshot,
  FeeSchedule,
  MarketRules,
  MarkSnapshot,
  OrderSide,
} from "@cadence/core";

export type StrategyOrder = {
  strategyId: string;
  entryClientOrderId: string;
  stopClientOrderId: string;
  targetClientOrderId: string;
  symbol: string;
  side: OrderSide;
  size: DecimalString;
  limitPrice: DecimalString;
  stopPrice: DecimalString;
  targetPrice: DecimalString;
};

export type StrategyAck = {
  strategyId: string;
  entryClientOrderId: string;
  accountId: string;
  acknowledgedAt: number;
};

export type ReduceOnlyClose = {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  size: DecimalString;
};

export type OrderAck = {
  clientOrderId: string;
  accountId: string;
  acknowledgedAt: number;
};

export type SymbolConfiguration = {
  marginMode: "isolated";
  leverage: number;
};

export interface StrikeClient {
  readonly environment: Environment;
  serverTime(): Promise<number>;
  markets(): Promise<readonly MarketRules[]>;
  book(symbol: string, depth: number): Promise<BookSnapshot>;
  mark(symbol: string): Promise<MarkSnapshot>;
  fees(): Promise<FeeSchedule>;
  accountState(symbol: string): Promise<AccountState>;
  order(symbol: string, clientOrderId: string): Promise<ExchangeOrderSnapshot | null>;
  openOrders(symbol: string | null): Promise<readonly ExchangeOrderSnapshot[]>;
  fills(symbol: string, sinceMs: number): Promise<readonly ExchangeFill[]>;
  placeStrategy(order: StrategyOrder): Promise<StrategyAck>;
  cancel(symbol: string, clientOrderId: string): Promise<void>;
  closeReduceOnly(order: ReduceOnlyClose): Promise<OrderAck>;
  configureSymbol(symbol: string, settings: SymbolConfiguration): Promise<void>;
}
