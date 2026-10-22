import { sql } from "drizzle-orm";
import { createDb } from "@cadence/db";
import { afterAll, beforeEach } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || !databaseUrl.endsWith("/cadence_test")) {
  throw new Error("API tests must run against the cadence_test database");
}

export const { db, close } = createDb(databaseUrl);

async function emptyEveryTable(): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length === 0) {
    return;
  }
  const names = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}

export function resetDatabaseBetweenTests(): void {
  beforeEach(emptyEveryTable);
  afterAll(close);
}
