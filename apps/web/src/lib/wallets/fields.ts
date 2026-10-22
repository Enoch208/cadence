export function field(value: unknown, name: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return (value as Readonly<Record<string, unknown>>)[name];
}

export const text = (value: unknown): string => (typeof value === "string" ? value : "");

export const dataImage = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("data:image/") ? value : null;
