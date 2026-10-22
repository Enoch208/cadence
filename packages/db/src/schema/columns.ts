import { sql, type SQL } from "drizzle-orm";
import { bigint, numeric, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const instant = (name: string) => bigint(name, { mode: "number" });

export const decimal = (name: string) => numeric(name);

export const sha256Hex = (column: AnyPgColumn): SQL => sql`${column} ~ '^[0-9a-f]{64}$'`;

export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "))})`;
