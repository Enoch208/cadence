import { createHash, createHmac } from "node:crypto";

export const testBotToken = "110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
export const otherBotToken = "220302654:BBIerUdwDI2wHXKyTgfpTBt1L6QBMEtbx";

const checkString = (fields: Record<string, string>) =>
  Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ""}`)
    .join("\n");

export function signWebAppInitData(fields: Record<string, string>, token = testBotToken): string {
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

export function webAppFields(
  user: { id: number; first_name: string; last_name?: string; username?: string },
  authDate: number,
): Record<string, string> {
  return {
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ ...user, language_code: "en", allows_write_to_pm: true }),
    auth_date: String(authDate),
    signature: "V2ViQXBwRGF0YVNpZ25hdHVyZUZvclRlc3RzT25seQ",
  };
}

export function signLoginWidget(
  fields: Record<string, string>,
  token = testBotToken,
): Record<string, string> {
  const secret = createHash("sha256").update(token).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  return { ...fields, hash };
}

export function withTamperedHash(initData: string): string {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.set("hash", `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`);
  return params.toString();
}
