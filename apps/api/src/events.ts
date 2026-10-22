import type { Environment } from "@cadence/core";
import { events, type Executor } from "@cadence/db";

export type ApplicationEvent = {
  at: number;
  actor: string;
  correlationId: string;
  environment: Environment | null;
  type: string;
  data: Record<string, string | number | boolean | null>;
};

export async function recordEvent(db: Executor, event: ApplicationEvent): Promise<void> {
  await db.insert(events).values(event);
}

export const userActor = (userId: string) => `user:${userId}`;
