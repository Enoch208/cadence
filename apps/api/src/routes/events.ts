import { Hono } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { requireUser } from "../auth/middleware";
import type { AppDeps, AppEnv } from "../deps";
import { describeFailure } from "../http/errors";
import { intentEventsAfter } from "../intents/read";

export const eventPollMs = 500;

const resumeFrom = (lastEventId: string | undefined) =>
  lastEventId !== undefined && /^\d{1,15}$/.test(lastEventId) ? Number(lastEventId) : 0;

async function relay(deps: AppDeps, userId: string, stream: SSEStreamingApi, after: number) {
  let cursor = after;
  while (!stream.aborted) {
    for (const event of await intentEventsAfter(deps.db, userId, cursor)) {
      await stream.writeSSE({
        event: "intent",
        id: String(event.id),
        data: JSON.stringify({ intentId: event.correlationId, at: event.at, type: event.type }),
      });
      cursor = event.id;
    }
    await stream.sleep(eventPollMs);
  }
}

export function eventRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get("/events", requireUser(deps), (c) => {
    const userId = c.get("userId");
    const after = resumeFrom(c.req.header("last-event-id"));
    return streamSSE(c, async (stream) => {
      try {
        await relay(deps, userId, stream, after);
      } catch (error) {
        process.stderr.write(`The progress stream stopped. ${describeFailure(error)}\n`);
        await stream.writeSSE({ event: "error", data: "The progress stream stopped. Reconnect." });
      }
    });
  });
}
