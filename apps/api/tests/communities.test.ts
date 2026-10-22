import { describe, expect, it } from "vitest";
import { call, signIn, testApp } from "./support/app";
import { resetDatabaseBetweenTests } from "./support/database";
import { curator, curatorWithCommunity, groupChatId, member } from "./support/flows";

resetDatabaseBetweenTests();

const register = { name: "Range Traders", telegramChatId: groupChatId };

describe("communities", () => {
  it("registers a group only for one of its Telegram admins and returns the chat ID as text", async () => {
    const { app, telegram } = testApp();
    const cookie = await signIn(app, curator);
    const refused = await call(app, "POST", "/api/communities", { cookie, body: register });
    expect(refused).toMatchObject({ status: 403, body: { code: "NOT_GROUP_ADMIN" } });
    telegram.makeAdministrator(groupChatId, curator.id);
    const reply = await call(app, "POST", "/api/communities", { cookie, body: register });
    expect(reply.status).toBe(201);
    expect(reply.body).toEqual({
      community: {
        id: expect.any(String) as string,
        name: "Range Traders",
        telegramChatId: groupChatId,
      },
    });
  });

  it("refuses a group that another curator already registered", async () => {
    const { app, telegram } = testApp();
    await curatorWithCommunity(app, telegram);
    telegram.makeAdministrator(groupChatId, member.id);
    const cookie = await signIn(app, member);
    const reply = await call(app, "POST", "/api/communities", { cookie, body: register });
    expect(reply).toMatchObject({ status: 409, body: { code: "GROUP_ALREADY_REGISTERED" } });
  });

  it("refuses a chat ID that is not a whole number", async () => {
    const { app } = testApp();
    const cookie = await signIn(app, curator);
    for (const telegramChatId of ["-100abc", -1001234567890, "99999999999999999999"]) {
      const reply = await call(app, "POST", "/api/communities", {
        cookie,
        body: { ...register, telegramChatId },
      });
      expect(reply.status).toBe(400);
    }
  });

  it("lists only the caller's communities", async () => {
    const { app, telegram } = testApp();
    const { cookie } = await curatorWithCommunity(app, telegram);
    const outsider = await signIn(app, member);
    expect((await call(app, "GET", "/api/communities", { cookie })).body).toEqual({
      communities: [
        { id: expect.any(String) as string, name: "Range Traders", telegramChatId: groupChatId },
      ],
    });
    expect((await call(app, "GET", "/api/communities", { cookie: outsider })).body).toEqual({
      communities: [],
    });
  });

  it("needs a signed-in user", async () => {
    const { app } = testApp();
    expect((await call(app, "GET", "/api/communities")).status).toBe(401);
    expect((await call(app, "POST", "/api/communities", { body: register })).status).toBe(401);
  });
});
