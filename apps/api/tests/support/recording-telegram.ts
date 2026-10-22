import type { PlanCard, TelegramPublisher } from "../../src/telegram/publisher";

export class RecordingTelegram implements TelegramPublisher {
  readonly cards: PlanCard[] = [];
  private readonly administrators = new Set<string>();
  private failNextPost = false;

  makeAdministrator(chatId: string, telegramUserId: number): void {
    this.administrators.add(`${chatId}:${String(telegramUserId)}`);
  }

  failTheNextPost(): void {
    this.failNextPost = true;
  }

  isChatAdministrator(chatId: string, telegramUserId: number): Promise<boolean> {
    return Promise.resolve(this.administrators.has(`${chatId}:${String(telegramUserId)}`));
  }

  postPlanCard(card: PlanCard): Promise<{ messageId: number }> {
    if (this.failNextPost) {
      this.failNextPost = false;
      return Promise.reject(new Error("Telegram refused the message"));
    }
    this.cards.push(card);
    return Promise.resolve({ messageId: this.cards.length });
  }
}
