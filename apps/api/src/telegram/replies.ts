const openLabel = "Open Cadence";

export const replyCopy = {
  started: "Cadence will message you here when one of your orders changes state.",
  pointer: "Cadence works in the app. Open it to see your plans and orders.",
} as const;

const appButton = (url: string) =>
  url.startsWith("https://") ? { text: openLabel, web_app: { url } } : { text: openLabel, url };

export const webhookReply = (chatId: number, text: string, appUrl: string) => ({
  method: "sendMessage",
  chat_id: chatId,
  text,
  reply_markup: { inline_keyboard: [[appButton(appUrl)]] },
  link_preview_options: { is_disabled: true },
});
