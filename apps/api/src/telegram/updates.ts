import { z } from "zod";
import type { TelegramIdentity } from "../auth/telegram";

export type BotTurn =
  | { kind: "start"; chatId: number; identity: TelegramIdentity }
  | { kind: "message"; chatId: number }
  | { kind: "stopped"; telegramUserId: number }
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

const identityOf = (from: Sender): TelegramIdentity => ({
  telegramUserId: from.id,
  firstName: from.first_name,
  lastName: from.last_name,
  username: from.username,
});

function turnOf(update: Update): BotTurn {
  const { message, my_chat_member: membership } = update;
  if (membership !== undefined) {
    const stopped =
      membership.chat.type === "private" && membership.new_chat_member.status === "kicked";
    return stopped ? { kind: "stopped", telegramUserId: membership.from.id } : { kind: "ignored" };
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
