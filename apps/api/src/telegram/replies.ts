const openLabel = "Open Cadence";

export const replyCopy = {
  started: "Cadence will message you here when one of your orders changes state.",
  pointer: "Cadence works in the app. Open it to see your plans and orders.",
} as const;

export const groupWelcome = (chatId: number, admin: boolean) =>
  admin
    ? `Cadence can post plan cards here. To publish to this group, open Publish a plan in Cadence and enter this group ID: ${String(chatId)}`
    : `Make me an admin of this group so I can post plan cards. Then open Publish a plan in Cadence and enter this group ID: ${String(chatId)}`;

export const groupReply = (chatId: number, text: string) => ({
  method: "sendMessage",
  chat_id: chatId,
  text,
  link_preview_options: { is_disabled: true },
});

const appButton = (url: string) =>
  url.startsWith("https://") ? { text: openLabel, web_app: { url } } : { text: openLabel, url };

export const webhookReply = (chatId: number, text: string, appUrl: string) => ({
  method: "sendMessage",
  chat_id: chatId,
  text,
  reply_markup: { inline_keyboard: [[appButton(appUrl)]] },
  link_preview_options: { is_disabled: true },
});
