import type { Environment } from "@cadence/core";
import { events, type Executor } from "@cadence/db";
import { workerActor } from "./deps";

export type EventValue = string | number | boolean | null | readonly string[];
export type EventData = Readonly<Record<string, EventValue>>;

export type WorkerEvent = {
  at: number;
  correlationId: string;
  environment: Environment;
  type: string;
  data: EventData;
};

export async function recordEvent(db: Executor, event: WorkerEvent): Promise<void> {
  await db.insert(events).values({ ...event, actor: workerActor });
}

export const errorData = (error: unknown): EventData =>
  error instanceof Error
    ? { error: error.name, detail: error.message }
    : { error: "non-error", detail: "A non-error value was thrown" };
