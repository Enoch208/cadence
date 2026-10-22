import type { OrderRole } from "./contract";

const roleCodes: Record<OrderRole, string> = {
  entry: "e",
  stop: "s",
  target: "t",
  recovery_close: "r",
};

export const strategyIdFor = (intentId: string) => `cad-${intentId}`;

export const clientOrderIdFor = (intentId: string, role: OrderRole) =>
  `cad-${intentId}-${roleCodes[role]}`;
