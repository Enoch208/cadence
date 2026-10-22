import { canonicalJson, sha256Hex, type OrderRole } from "@cadence/core";
import { strategyRequestBody, type StrategyOrder } from "@cadence/strike";

export type NewOrderRow = {
  intentId: string;
  role: OrderRole;
  clientOrderId: string;
  payload: unknown;
  payloadDigest: string;
};

const digestOf = (payload: unknown) => sha256Hex(canonicalJson(payload));

export function strategyRows(intentId: string, order: StrategyOrder): NewOrderRow[] {
  const payload = strategyRequestBody(order);
  const payloadDigest = digestOf(payload);
  const roles: readonly (readonly [OrderRole, string])[] = [
    ["entry", order.entryClientOrderId],
    ["stop", order.stopClientOrderId],
    ["target", order.targetClientOrderId],
  ];
  return roles.map(([role, clientOrderId]) => ({
    intentId,
    role,
    clientOrderId,
    payload,
    payloadDigest,
  }));
}
