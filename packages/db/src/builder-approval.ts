import type { BuilderApproval } from "@cadence/core";
import type { AccountConnectionRow } from "./schema/accounts";

export function builderApprovalOf(
  connection: Pick<AccountConnectionRow, "builderCode" | "builderFeeBps">,
): BuilderApproval | null {
  const { builderCode, builderFeeBps } = connection;
  return builderCode === null || builderFeeBps === null
    ? null
    : { builderCode, maxFeeBps: builderFeeBps };
}
