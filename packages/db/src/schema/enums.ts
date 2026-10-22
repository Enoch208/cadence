import { pgEnum } from "drizzle-orm/pg-core";
import {
  environments,
  exchangeOrderStatuses,
  intentStates,
  orderRoles,
  orderSides,
} from "@cadence/core";
import { walletChains } from "@cadence/strike";

export const planStatuses = ["draft", "published", "revoked"] as const;
export type PlanStatus = (typeof planStatuses)[number];

export const connectionStatuses = ["active", "paused", "disconnected"] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

export const credentialSources = ["api_key", "builder"] as const;
export type CredentialSource = (typeof credentialSources)[number];

export const reservationStatuses = ["active", "released"] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];

export const outboxKinds = ["submit", "reconcile", "cancel_entry"] as const;
export type OutboxKind = (typeof outboxKinds)[number];

export const outboxStatuses = ["pending", "claimed", "done"] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const environmentEnum = pgEnum("environment", environments);
export const intentStateEnum = pgEnum("intent_state", intentStates);
export const orderRoleEnum = pgEnum("order_role", orderRoles);
export const orderSideEnum = pgEnum("order_side", orderSides);
export const exchangeOrderStatusEnum = pgEnum("exchange_order_status", exchangeOrderStatuses);
export const planStatusEnum = pgEnum("plan_status", planStatuses);
export const connectionStatusEnum = pgEnum("connection_status", connectionStatuses);
export const credentialSourceEnum = pgEnum("credential_source", credentialSources);
export const walletChainEnum = pgEnum("wallet_chain", walletChains);
export const reservationStatusEnum = pgEnum("reservation_status", reservationStatuses);
export const outboxKindEnum = pgEnum("outbox_kind", outboxKinds);
export const outboxStatusEnum = pgEnum("outbox_status", outboxStatuses);
