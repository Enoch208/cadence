import type {
  DecimalString,
  Environment,
  ExchangeOrderStatus,
  MarginMode,
  OrderSide,
} from "./contract";

export type AccountSnapshot = {
  accountId: string;
  environment: Environment;
  availableBalance: DecimalString;
  observedAt: number;
};

export type PositionSnapshot = {
  symbol: string;
  signedSize: DecimalString;
  entryPrice: DecimalString;
  marginMode: MarginMode;
  leverage: number;
  liquidationPrice: DecimalString | null;
};

export type ExchangeOrderSnapshot = {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: string;
  status: ExchangeOrderStatus;
  size: DecimalString;
  filled: DecimalString;
  price: DecimalString | null;
  stopPrice: DecimalString | null;
  reduceOnly: boolean;
  strategyId: string | null;
  isStrategyPrimary: boolean;
  closeReason: string | null;
};

export type SymbolSettings = {
  symbol: string;
  marginMode: MarginMode;
  leverage: number;
};

export type AccountState = {
  account: AccountSnapshot;
  positions: readonly PositionSnapshot[];
  openOrders: readonly ExchangeOrderSnapshot[];
  symbolSettings: SymbolSettings;
};

export type ExchangeFill = {
  fillId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: DecimalString;
  size: DecimalString;
  fee: DecimalString;
  filledAt: number;
};
