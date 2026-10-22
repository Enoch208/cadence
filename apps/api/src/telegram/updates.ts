import { z } from "zod";
import type { TelegramIdentity } from "../auth/telegram";

export type BotTurn =
  | { kind: "start"; chatId: number; identity: TelegramIdentity }
  | { kind: "message"; chatId: number }
  | { kind: "stopped"; telegramUserId: number }
  | { kind: "joinedGroup"; chatId: number; admin: boolean }
  | { kind: "ignored" };

const optionalName = z
  .string()
  .max(256)
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? null : value));

const sender = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  is_bot: z.boolean(),
  first_name: z.string().min(1).max(256),
  last_name: optionalName,
  username: optionalName,
});

const chat = z.object({ id: z.number().int(), type: z.string() });

const updateSchema = z.object({
  update_id: z.number().int(),
  message: z.object({ chat, from: sender.optional(), text: z.string().optional() }).optional(),
  my_chat_member: z
    .object({ chat, from: sender, new_chat_member: z.object({ status: z.string() }) })
    .optional(),
});

type Update = z.infer<typeof updateSchema>;
type Sender = z.infer<typeof sender>;

const startCommand = /^\/start(?:@\w+)?(?:\s|$)/;

const groupTypes = new Set(["group", "supergroup"]);
const presentStatuses = new Set(["member", "administrator"]);

function membershipTurn(membership: NonNullable<Update["my_chat_member"]>): BotTurn {
  const { chat: where, new_chat_member: next } = membership;
  if (where.type === "private") {
    return next.status === "kicked"
      ? { kind: "stopped", telegramUserId: membership.from.id }
      : { kind: "ignored" };
  }
  return groupTypes.has(where.type) && presentStatuses.has(next.status)
    ? { kind: "joinedGroup", chatId: where.id, admin: next.status === "administrator" }
    : { kind: "ignored" };
}

const identityOf = (from: Sender): TelegramIdentity => ({
  telegramUserId: from.id,
  firstName: from.first_name,
  lastName: from.last_name,
  username: from.username,
});

function turnOf(update: Update): BotTurn {
  const { message, my_chat_member: membership } = update;
  if (membership !== undefined) {
    return membershipTurn(membership);
  }
  if (message?.from === undefined || message.from.is_bot || message.chat.type !== "private") {
    return { kind: "ignored" };
  }
  if (startCommand.test(message.text ?? "")) {
    return { kind: "start", chatId: message.chat.id, identity: identityOf(message.from) };
  }
  return { kind: "message", chatId: message.chat.id };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function readTurn(body: string): BotTurn {
  const update = updateSchema.safeParse(parseJson(body));
  return update.success ? turnOf(update.data) : { kind: "ignored" };
}
