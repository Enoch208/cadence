export type PlanCard = {
  chatId: string;
  text: string;
  button: { label: string; url: string };
};

export interface TelegramPublisher {
  isChatAdministrator(chatId: string, telegramUserId: number): Promise<boolean>;
  postPlanCard(card: PlanCard): Promise<{ messageId: number }>;
}
