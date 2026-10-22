import { decimalStringSchema, exchangeOrderStatuses, marginModes, orderSides } from "@cadence/core";
import { z } from "zod";
import { jsonId, jsonInteger } from "../json";

const decimal = decimalStringSchema;
const goSlice = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullable()
    .transform((items) => items ?? []);

export const documentedAccountSchema = z.object({
  account_id: z.string().min(1),
  available_balance: decimal,
});

export const documentedPositionsSchema = z.object({
  positions: goSlice(
    z.object({
      symbol: z.string().min(1),
      size: decimal,
      entry_price: decimal,
      margin_mode: z.enum(marginModes),
      leverage: jsonInteger,
      liquidation_price: decimal.or(z.literal("")),
    }),
  ),
});

export const documentedOrderSchema = z.object({
  ID: jsonId,
  ClientOrderID: z.string(),
  Symbol: z.string().min(1),
  Strategy: z.object({ ID: z.string().min(1), IsPrimary: z.boolean() }).nullish(),
  CloseReason: z.string(),
  Side: z.enum(orderSides),
  Status: z.enum(exchangeOrderStatuses),
  Type: z.string().min(1),
  Size: decimal,
  Filled: decimal,
  Price: decimal.or(z.literal("")),
  StopPrice: decimal.or(z.literal("")),
  ReduceOnly: z.boolean(),
});

export const documentedOpenOrdersSchema = z.object({ orders: goSlice(documentedOrderSchema) });

const symbolSettingSchema = z.object({ margin_mode: z.enum(marginModes), leverage: jsonInteger });

export const documentedSymbolsSchema = z.object({
  default_margin_mode: z.enum(marginModes),
  default_leverage: jsonInteger,
  symbol_settings: z
    .record(z.string(), symbolSettingSchema)
    .nullable()
    .transform((settings) => settings ?? {}),
});

export const documentedFillHistorySchema = z.object({
  fills: goSlice(
    z.object({
      id: jsonId,
      order_id: jsonId,
      symbol: z.string().min(1),
      side: z.enum(orderSides),
      price: decimal,
      size: decimal,
      fee: decimal,
      timestamp: jsonInteger,
    }),
  ),
});

export const documentedStrategyAckSchema = z.object({
  strategy_id: z.string().min(1),
  primary_client_order_id: z.string().min(1),
  account_id: z.string().min(1),
  symbol: z.string().min(1),
});

export const documentedOrderAckSchema = z.object({
  client_order_id: z.string().min(1),
  account_id: z.string().min(1),
  symbol: z.string().min(1),
});
