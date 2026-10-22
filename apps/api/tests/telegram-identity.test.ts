import { describe, expect, it } from "vitest";
import { verifyLoginWidget, verifyWebAppInitData } from "../src/auth/telegram";
import {
  otherBotToken,
  signLoginWidget,
  signWebAppInitData,
  testBotToken,
  webAppFields,
  withTamperedHash,
} from "./support/telegram";

const nowSeconds = 1_792_670_400;
const ada = { id: 424242, first_name: "Ada", last_name: "Obi", username: "ada_trades" };

describe("Telegram Mini App init data", () => {
  it("returns the signed identity", () => {
    const initData = signWebAppInitData(webAppFields(ada, nowSeconds - 60));
    expect(verifyWebAppInitData(initData, testBotToken, nowSeconds)).toEqual({
      telegramUserId: 424242,
      firstName: "Ada",
      lastName: "Obi",
      username: "ada_trades",
    });
  });

  it("refuses a tampered hash", () => {
    const initData = withTamperedHash(signWebAppInitData(webAppFields(ada, nowSeconds - 60)));
    expect(verifyWebAppInitData(initData, testBotToken, nowSeconds)).toBeNull();
  });

  it("refuses a field changed after signing", () => {
    const params = new URLSearchParams(signWebAppInitData(webAppFields(ada, nowSeconds - 60)));
    params.set("user", JSON.stringify({ ...ada, id: 1 }));
    expect(verifyWebAppInitData(params.toString(), testBotToken, nowSeconds)).toBeNull();
  });

  it("refuses data signed more than a day ago", () => {
    const initData = signWebAppInitData(webAppFields(ada, nowSeconds - 86_401));
    expect(verifyWebAppInitData(initData, testBotToken, nowSeconds)).toBeNull();
  });

  it("refuses data signed with another bot's token", () => {
    const initData = signWebAppInitData(webAppFields(ada, nowSeconds - 60), otherBotToken);
    expect(verifyWebAppInitData(initData, testBotToken, nowSeconds)).toBeNull();
  });

  it("refuses data with no hash, no user or a repeated field", () => {
    const fields = webAppFields(ada, nowSeconds - 60);
    const withoutHash = new URLSearchParams(signWebAppInitData(fields));
    withoutHash.delete("hash");
    const withoutUser = Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== "user"),
    );
    const repeated = `${signWebAppInitData(fields)}&auth_date=${String(nowSeconds)}`;
    expect(verifyWebAppInitData(withoutHash.toString(), testBotToken, nowSeconds)).toBeNull();
    expect(
      verifyWebAppInitData(signWebAppInitData(withoutUser), testBotToken, nowSeconds),
    ).toBeNull();
    expect(verifyWebAppInitData(repeated, testBotToken, nowSeconds)).toBeNull();
  });
});

describe("Telegram Login Widget", () => {
  const widgetFields = (authDate: number) => ({
    id: "424242",
    first_name: "Ada",
    username: "ada_trades",
    photo_url: "https://t.me/i/userpic/320/ada.jpg",
    auth_date: String(authDate),
  });

  it("returns the signed identity", () => {
    const fields = signLoginWidget(widgetFields(nowSeconds - 60));
    expect(verifyLoginWidget(fields, testBotToken, nowSeconds)).toEqual({
      telegramUserId: 424242,
      firstName: "Ada",
      lastName: null,
      username: "ada_trades",
    });
  });

  it("refuses a changed field, an old login and another bot's token", () => {
    const signed = signLoginWidget(widgetFields(nowSeconds - 60));
    const stale = signLoginWidget(widgetFields(nowSeconds - 86_401));
    const foreign = signLoginWidget(widgetFields(nowSeconds - 60), otherBotToken);
    expect(verifyLoginWidget({ ...signed, id: "1" }, testBotToken, nowSeconds)).toBeNull();
    expect(verifyLoginWidget(stale, testBotToken, nowSeconds)).toBeNull();
    expect(verifyLoginWidget(foreign, testBotToken, nowSeconds)).toBeNull();
  });
});
