import { z } from "zod";

const botUsername = z
  .string()
  .min(1)
  .safeParse(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);

export const telegramBotUsername: string | null = botUsername.success ? botUsername.data : null;
