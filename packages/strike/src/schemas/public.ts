import { decimalStringSchema, marketStatuses, positiveDecimalSchema } from "@cadence/core";
import { z } from "zod";
import { compareDecimal } from "../exact";
import { jsonId, jsonInteger, jsonNumberAsDecimal } from "../json";

const decimal = decimalStringSchema;
const positive = positiveDecimalSchema;

const marginTierSchema = z.object({
  max_notional: positive,
  max_leverage: jsonInteger.pipe(z.number().int().min(1)),
  maintenance_margin_rate: decimal,
  maintenance_amount: decimal,
});

const marketSchema = z.object({
  symbol: z.string().min(1),
  status: z.enum(marketStatuses),
  reduce_only: z.boolean(),
  order_tick_price: positive,
  order_min_price: decimal,
  order_max_price: decimal,
  order_limit_price_bound: positive,
  order_limit_step_size: positive,
  order_limit_min_size: positive,
  order_limit_max_size: positive,
  order_market_min_size: positive,
  order_min_notional: decimal,
  margin_tiers: z.array(marginTierSchema).min(1),
});

export const marketsResponseSchema = z
  .object({ markets: z.record(z.string(), marketSchema) })
  .superRefine(({ markets }, ctx) => {
    for (const [key, market] of Object.entries(markets)) {
      if (market.symbol !== key) {
        ctx.addIssue({ code: "custom", path: ["markets", key], message: "Misfiled market" });
      }
    }
  });

const levelSchema = z.tuple([positive, positive]);

const strictlyOrdered = (levels: readonly (readonly [string, string])[], order: -1 | 1) =>
  levels.every((level, index) => {
    const previous = levels[index - 1];
    return previous === undefined || compareDecimal(level[0], previous[0]) === order;
  });

export const depthResponseSchema = z
  .object({
    lastUpdateId: jsonId,
    E: jsonInteger,
    T: jsonInteger,
    bids: z.array(levelSchema),
    asks: z.array(levelSchema),
  })
  .superRefine((depth, ctx) => {
    if (!strictlyOrdered(depth.bids, -1)) {
      ctx.addIssue({ code: "custom", path: ["bids"], message: "Bids must fall level by level" });
    }
    if (!strictlyOrdered(depth.asks, 1)) {
      ctx.addIssue({ code: "custom", path: ["asks"], message: "Asks must rise level by level" });
    }
    const [bid] = depth.bids;
    const [ask] = depth.asks;
    if (bid !== undefined && ask !== undefined && compareDecimal(bid[0], ask[0]) >= 0) {
      ctx.addIssue({ code: "custom", path: ["bids"], message: "The book is crossed" });
    }
  });

export const markPriceSchema = z.object({
  e: z.literal("markPriceUpdate"),
  E: jsonInteger,
  s: z.string().min(1),
  p: positive,
  i: decimal,
  r: decimal,
  T: jsonInteger,
});

export const serverTimeSchema = z.object({ serverTime: jsonInteger });

export const feeTiersSchema = z.object({
  feeTiers: z.array(
    z.object({
      Tier: jsonInteger,
      TakerRate: jsonNumberAsDecimal,
      MakerRate: jsonNumberAsDecimal,
    }),
  ),
});
