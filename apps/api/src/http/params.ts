import type { Context } from "hono";
import { notFound } from "./errors";

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidParam(c: Context, name: string, missing: string): string {
  const value = c.req.param(name) ?? "";
  if (!uuidShape.test(value)) {
    throw notFound(missing);
  }
  return value;
}
