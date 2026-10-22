import type { AccountConnectionRow, Db } from "@cadence/db";
import type {
  BuilderConnectClient,
  Signer,
  StrikeClient,
  StrikePublicClient,
} from "@cadence/strike";
import type { PlanDrafter } from "./drafting/contract";
import type { ApiEnv } from "./env";
import type { TelegramPublisher } from "./telegram/publisher";

export type StrikeClientFactory = {
  public(): StrikePublicClient;
  forConnection(connection: AccountConnectionRow): StrikeClient;
  forSigner(signer: Signer): StrikeClient;
};

export type AppDeps = {
  db: Db;
  env: ApiEnv;
  strike: StrikeClientFactory;
  telegram: TelegramPublisher;
  drafter: PlanDrafter | null;
  builderConnect: BuilderConnectClient | null;
  now: () => number;
};

export type AppEnv = { Variables: { userId: string } };
