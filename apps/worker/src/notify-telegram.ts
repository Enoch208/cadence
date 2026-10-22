import { GrammyError, HttpError, InlineKeyboard, type Api } from "grammy";
import type { OutgoingMessage } from "./notify-message";

export type Delivery =
  | { kind: "sent"; messageId: number }
  | { kind: "retry"; afterMs: number | null; reason: string }
  | { kind: "refused"; reason: string; botStopped: boolean }
  | { kind: "unconfirmed"; reason: string };

export interface MessageSender {
  send(message: OutgoingMessage): Promise<Delivery>;
}

const keyboardFor = ({ label, url }: OutgoingMessage["button"]) =>
  url.startsWith("https://")
    ? new InlineKeyboard().webApp(label, url)
    : new InlineKeyboard().url(label, url);

function answered(error: GrammyError): Delivery {
  const reason = `Telegram ${String(error.error_code)}: ${error.description}`.slice(0, 300);
  if (error.error_code === 429) {
    const seconds = error.parameters.retry_after;
    return { kind: "retry", afterMs: seconds === undefined ? null : seconds * 1_000, reason };
  }
  if (error.error_code >= 500) {
    return { kind: "retry", afterMs: null, reason };
  }
  return { kind: "refused", reason, botStopped: error.error_code === 403 };
}

export function createTelegramSender(api: Api): MessageSender {
  return {
    async send(message) {
      try {
        const sent = await api.sendMessage(message.chatId, message.text, {
          reply_markup: keyboardFor(message.button),
          link_preview_options: { is_disabled: true },
        });
        return { kind: "sent", messageId: sent.message_id };
      } catch (error) {
        if (error instanceof GrammyError) {
          return answered(error);
        }
        if (error instanceof HttpError) {
          return { kind: "unconfirmed", reason: error.message };
        }
        throw error;
      }
    },
  };
}
