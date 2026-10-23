import { GrammyError, InlineKeyboard, type Api } from "grammy";

export type PlanCard = {
  chatId: string;
  text: string;
  boldLength: number;
  button: { label: string; url: string };
};

export interface TelegramPublisher {
  isChatAdministrator(chatId: string, telegramUserId: number): Promise<boolean>;
  postPlanCard(card: PlanCard): Promise<{ messageId: number }>;
}

const notInChat = (error: unknown) =>
  error instanceof GrammyError && (error.error_code === 400 || error.error_code === 403);

export function createGrammyPublisher(api: Api): TelegramPublisher {
  return {
    async isChatAdministrator(chatId, telegramUserId) {
      try {
        const membership = await api.getChatMember(chatId, telegramUserId);
        return membership.status === "creator" || membership.status === "administrator";
      } catch (error) {
        if (notInChat(error)) {
          return false;
        }
        throw error;
      }
    },
    async postPlanCard(card) {
      const message = await api.sendMessage(card.chatId, card.text, {
        entities: [{ type: "bold", offset: 0, length: card.boldLength }],
        reply_markup: new InlineKeyboard().url(card.button.label, card.button.url),
        link_preview_options: { is_disabled: true },
      });
      return { messageId: message.message_id };
    },
  };
}
