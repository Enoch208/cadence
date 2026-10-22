import { and, asc, eq } from "drizzle-orm";
import { communities, communityPublishers, type CommunityRow, type Executor } from "@cadence/db";
import { findUser } from "../auth/users";
import type { AppDeps } from "../deps";
import { recordEvent, userActor } from "../events";
import { conflict, forbidden, notFound, unauthenticated } from "../http/errors";

export const communityView = (community: CommunityRow) => ({
  id: community.id,
  name: community.name,
  telegramChatId: community.telegramChatId.toString(),
});

export async function registerCommunity(
  deps: AppDeps,
  userId: string,
  input: { name: string; telegramChatId: bigint },
) {
  const user = await findUser(deps.db, userId);
  if (user === null) {
    throw unauthenticated();
  }
  const chatId = input.telegramChatId.toString();
  if (!(await deps.telegram.isChatAdministrator(chatId, user.telegramUserId))) {
    throw forbidden(
      "NOT_GROUP_ADMIN",
      "Cadence could not confirm that you are an admin of that Telegram group. Add the Cadence bot to the group, check that you are an admin, then try again.",
    );
  }
  return deps.db.transaction(async (tx) => {
    const [community] = await tx
      .insert(communities)
      .values({
        ownerUserId: userId,
        name: input.name,
        telegramChatId: input.telegramChatId,
        createdAt: deps.now(),
      })
      .onConflictDoNothing({ target: communities.telegramChatId })
      .returning();
    if (community === undefined) {
      throw conflict(
        "GROUP_ALREADY_REGISTERED",
        "That Telegram group is already connected to Cadence.",
      );
    }
    await tx.insert(communityPublishers).values({ communityId: community.id, userId });
    await recordEvent(tx, {
      at: deps.now(),
      actor: userActor(userId),
      correlationId: community.id,
      environment: null,
      type: "community_registered",
      data: { telegramChatId: chatId },
    });
    return communityView(community);
  });
}

export async function listCommunities(db: Executor, userId: string) {
  const rows = await db
    .select({ community: communities })
    .from(communities)
    .innerJoin(communityPublishers, eq(communityPublishers.communityId, communities.id))
    .where(eq(communityPublishers.userId, userId))
    .orderBy(asc(communities.createdAt), asc(communities.name));
  return rows.map(({ community }) => communityView(community));
}

export async function requirePublisher(db: Executor, communityId: string, userId: string) {
  const [community] = await db.select().from(communities).where(eq(communities.id, communityId));
  if (community === undefined) {
    throw notFound("That community does not exist.");
  }
  const [publisher] = await db
    .select()
    .from(communityPublishers)
    .where(
      and(eq(communityPublishers.communityId, communityId), eq(communityPublishers.userId, userId)),
    );
  if (publisher === undefined) {
    throw forbidden(
      "NOT_A_PUBLISHER",
      "Only this community's publishers can create, publish or revoke its plans.",
    );
  }
  return community;
}
