import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { PublishedPlan } from "@cadence/core";
import { id, instant, sha256Hex } from "./columns";
import { planStatusEnum } from "./enums";
import { communities, users } from "./people";

export const plans = pgTable(
  "plans",
  {
    id: id(),
    publicId: text("public_id").notNull(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => communities.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    status: planStatusEnum("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(0),
    draft: jsonb("draft").$type<PublishedPlan>().notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("plans_public_id_unique").on(table.publicId),
    check("plans_current_version_not_negative", sql`${table.currentVersion} >= 0`),
    check(
      "plans_draft_has_no_version",
      sql`${table.status} <> 'draft' or ${table.currentVersion} = 0`,
    ),
    check(
      "plans_published_has_a_version",
      sql`${table.status} <> 'published' or ${table.currentVersion} >= 1`,
    ),
  ],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    version: integer("version").notNull(),
    payload: jsonb("payload").$type<PublishedPlan>().notNull(),
    digest: text("digest").notNull(),
    publishedAt: instant("published_at").notNull(),
    entryExpiresAt: instant("entry_expires_at").notNull(),
  },
  (table) => [
    unique("plan_versions_plan_version_unique").on(table.planId, table.version),
    check("plan_versions_version_positive", sql`${table.version} >= 1`),
    check("plan_versions_digest_is_sha256", sha256Hex(table.digest)),
  ],
);

export type PlanRow = typeof plans.$inferSelect;
export type PlanVersionRow = typeof planVersions.$inferSelect;
