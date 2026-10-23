# Cadence

**One trade idea. Your own risk.**

Someone in a Telegram trading group posts a setup. Cadence turns it into a plan that each member
can take on Strike at a size that fits their own account, with the stop and target attached, or
be told in plain words why they should not.

- **Live app:** https://cadencetrade.xyz
- **Telegram bot:** [@usecadencebot](https://t.me/usecadencebot)
- **Built on:** [Strike Finance](https://www.strikefinance.org) perpetuals, **mainnet**
- **Evidence:** [`evidence/`](evidence/): every mainnet order ID, and what is proven only in replay

## Try it in a minute, with no money

1. Open the practice plan: https://cadencetrade.xyz/p/83c3e2p5dgkw (replay, open until 26 Oct
   20:00 UTC).
2. Press **Preview for me** and sign in with Telegram.
3. Under **Accounts**, add the replay accounts **Fills cleanly** and **Arrives late**.
4. Preview the plan with each. One is **Ready**; the other **Cannot execute**, because the price
   has already left the entry range, and it says so.
5. Approve with **Fills cleanly** and watch the order go from reserved to filled to
   **Exits verified**, then press **Close position** and read the receipt.

Every screen says **Live** or **Replay**. Replay runs against a deterministic simulation of Strike
with no credentials, so it cannot place a real order.

## What is real

On 23 October 2026 Cadence traded on Strike mainnet from two dedicated sub-accounts. Sample size:
two live entries and one close.

- **One plan, two accounts, two sizes.** The same plan previewed **Ready** at $24.58 on the $10
  account and **Smaller size** at $14.75 on the $3 account.
- **Bounded entry, native exits.** Order `11516191287` filled 0.0003 BTC at 81,742 as one
  fill-or-kill limit order. Target `11516191288` and stop `11516191289` sat on Strike, and Cadence
  marked them verified only once they matched the filled size.
- **A refusal from real state.** A second plan declined the first account, "You already have a
  Cadence plan open on this market", and filled the second account at 81,552 (order
  `11525670252`); its exits were verified 2.8 s after the order was sent.
- **A full lifecycle.** The member closed the first position from Cadence (order `11538974990`,
  sold at 81,764). The receipt shows a realized result of **−$0.0179** after both fees, computed
  from Strike's fills, not from the plan.

Anyone can check these on Strike's public fill history; the commands are in
[`evidence/`](evidence/).

## The problem

A curator posts: long at 100, stop at 98, target at 106. A member who sees it forty minutes later at
105 is taking a different trade, risking seven to make one. Their account, budget and entry price
all differ from the curator's, and copying the message loses the conditions that made the idea
coherent. Copy trading follows a lead's fills; Cadence lets a member approve one published plan
under its entry conditions and their own risk budget.

## How it works

1. **Publish.** The curator sets market, direction, entry range, stop, target and an entry window,
   or pastes the setup they already wrote and lets an AI model fill the form. Every value it fills
   shows the words it came from, the server drops any value whose words are not in the message, and
   the curator confirms before anything is published. The plan is versioned and fixed by a digest.
   The bot posts a card with a **Preview for me** button in the group.
2. **Preview.** A member signs in with Telegram and picks one of their own Strike sub-accounts.
   Cadence reads that account, the order book and the mark price and decides **Ready**, **Smaller
   size** or **Cannot execute**, with the reason and every cost behind the planned risk.
3. **Approve.** The approval binds one order for this plan version: at most this size, at this
   limit, filled in full or not at all, with the stop and target attached. Risk is reserved before
   anything is sent.
4. **Execute and reconcile.** A single worker checks again against fresh data, records the exact
   order, sends it as one strategy order, and shows "Exits verified" only once Strike's own state
   confirms it. A member who has started the bot gets each step as a Telegram message.
5. **Close and receipt.** The position ends at the stop, at the target, or when the member presses
   **Close position**. The receipt ties the plan version to the fills.

A model never sizes, approves or sends anything. It only drafts plan fields that the curator confirms.

## Built for real money

- **Deterministic decisions.** A pure engine checks, in a fixed order: plan standing, account and
  market capability, data freshness (account and book within 3 s, mark within 6 s), the entry
  range, unknown exposure, the risk budget, Strike's price bounds, then size, margin, liquidation
  buffer and reward to risk after costs. Quantities only ever round down.
- **Never a second order.** Order IDs derive from the approval and the order's role and are written
  to the database before sending. Strike does not reject a repeated client order ID, so after a lost
  answer Cadence looks the order up before doing anything else. A worker killed mid-submit and
  restarted sends nothing twice.
- **Exits verified, not assumed.** The stop and target are checked against the filled size. If they
  are missing, the position is closed with a reduce-only order and the page says "Recovery
  required" until it is.
- **Exchange lag handled.** On mainnet Strike's order lookup trailed its fills by minutes. Cadence
  reconciles from fills and open orders, so a filled entry or a member's close is not left waiting
  on the lookup.
- **A hard live ceiling.** The worker refuses any live order above `CADENCE_LIVE_MAX_NOTIONAL` ($25
  in production), whatever the member's budget.
- **Keys that cannot withdraw.** Members connect an API key bound to one Strike sub-account, which
  can trade only that sub-account and never withdraw. Keys are sealed with AES-256-GCM to their
  owner, account, environment and key version.
- **Pause.** A member can stop new entries at any time; open positions keep their exits on Strike.

## Strike integration

| What Cadence does                                | Strike endpoint                                                     | Where                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Market rules, tick and lot grids, margin tiers   | `GET /v2/markets`, `GET /v2/fee-tiers`                              | `packages/strike/src/public-reads.ts`                                     |
| Order book and mark price                        | `GET /price/v2/depth`, `GET /price/v2/markPrice`                    | `packages/strike/src/public-reads.ts`                                     |
| Signed requests (Ed25519, server-time offset)    | every authenticated route, `GET /v2/time`                           | `packages/strike/src/signer.ts`, `clock.ts`                               |
| Account, positions, open orders, symbol settings | `GET /v2/account`, `/v2/positions`, `/v2/openOrders`, `/v2/symbols` | `packages/strike/src/live-account.ts`                                     |
| Bounded entry with native stop and target        | `POST /v2/order/strategy` (limit, fill-or-kill)                     | `packages/strike/src/orders.ts`, `live-client.ts`                         |
| Find an order after an uncertain answer          | `GET /v2/order?client_order_id=`                                    | `packages/strike/src/live-account.ts`                                     |
| Fills for reconciliation and receipts            | `GET /v2/history/fill`                                              | `packages/strike/src/live-account.ts`                                     |
| Member close and recovery close                  | `POST /v2/order` (reduce-only)                                      | `packages/strike/src/live-client.ts`, `apps/worker/src/close-position.ts` |
| Cancel an unfilled entry or a leftover exit      | `DELETE /v2/order/cancel`                                           | `packages/strike/src/live-client.ts`                                      |
| Isolated margin and leverage at connection       | `POST /v2/marginMode`, `POST /v2/leverage`                          | `apps/api/src/accounts/connect.ts`                                        |
| Connect with one wallet signature (not yet run)  | `/auth/builder/request-signature`, `/auth/builder/verify-signature` | `packages/strike/src/builder-connect.ts`                                  |
| Curator fee (replay only)                        | `X-Builder-Fee-Bps` on the strategy order                           | `packages/strike/src/orders.ts`                                           |

## Curator fees, in replay

A curator can attach their own Strike builder code and a fee of 1 to 20 basis points to a replay
plan. Members connected under that code pay it on their fills; it is part of the plan's digest,
counted in planned risk, bound by the approval, and shown on the receipt. It has not run on mainnet,
so live plans refuse it.

## Architecture

```mermaid
flowchart LR
  Curator["Curator"] --> Web["Web app (Vercel)"]
  Member["Member"] --> Web
  Group["Telegram group"] <--> Bot["@usecadencebot"]
  Bot <--> API
  Web --> API["API (Hono)"]
  API --> DB[("Postgres")]
  API --> Engine["Decision engine"]
  Worker["Worker"] --> DB
  Worker --> Engine
  Worker --> Strike["Strike mainnet"]
  API -. public reads .-> Strike
```

| Package           | Responsibility                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | The shared contract and the pure engine: grids, pricing, costs, margin, the decision, the intent lifecycle, receipts |
| `packages/strike` | Strike adapter: signing, response validation, the live, public and replay clients                                    |
| `packages/db`     | Schema with the invariants as database constraints, sealed credentials, exposure                                     |
| `apps/api`        | Telegram sign-in and webhook, plans, drafting, previews, consent and reservation, receipts, events                   |
| `apps/worker`     | The only process that sends orders: submission, reconciliation, closes, recovery, Telegram messages                  |
| `apps/web`        | The landing page and the member and curator screens                                                                  |

The API and the worker run on a VPS under systemd with Postgres; the web app is on Vercel.

## Running it

Requirements: Node 24, pnpm 10.33, Docker (or any Postgres 17).

```sh
pnpm install --frozen-lockfile
docker run -d --name cadence-postgres -p 127.0.0.1:54340:5432 \
  -e POSTGRES_USER=cadence -e POSTGRES_PASSWORD=cadence -e POSTGRES_DB=cadence postgres:17-alpine
docker exec cadence-postgres createdb -U cadence cadence_test
cp packages/db/.env.example packages/db/.env
pnpm db:migrate
DATABASE_URL=postgres://cadence:cadence@127.0.0.1:54340/cadence_test pnpm db:migrate
pnpm test
pnpm --filter @cadence/web dev
```

Copy `apps/api/.env.example` and `apps/worker/.env.example` to `.env` and fill them in to run the
API (`pnpm --filter @cadence/api dev`) and the worker (`pnpm --filter @cadence/worker dev`). Tests
never reach Strike: they run against captured responses and the replay client.

## Known limitations

- **Sample size.** Two live entries and one close so far, on BTC-USD only.
- **Wallet connect.** It has not been run against mainnet. It binds a member's main account rather
  than a sub-account. Its key never expires, and Strike lets it reach deposit, withdrawal and vault
  routes; Cadence has no code that calls them.
- **Planned risk.** It is a modelled loss at the stop, not a maximum loss. A stop can fill worse
  than planned, and funding can change.
- **Public positions.** Strike positions are publicly readable by account ID, so Cadence makes no
  privacy claim about them.
- **Practice group.** The demo runs in the builder's own Telegram group. What its members say is
  feedback, not traction.

## Build log

- **21 Oct.** The shared contract between engine, Strike adapter and backend, frozen before any
  feature.
- **22 Oct.** In order:
  - the decision engine and sizing;
  - the Strike adapter with signing and validated responses, plus the replay client;
  - the schema with invariants as constraints;
  - previews, consent and reservation;
  - the worker with persist-before-send and reconciliation;
  - the landing page and app screens;
  - Telegram sign-in, plan cards and order messages;
  - AI drafting from the curator's message;
  - wallet connect;
  - the curator funnel;
  - deployment.
- **23 Oct.** In order:
  - first mainnet orders;
  - a fix for Strike's order lookup lagging a filled entry;
  - the member's **Close position**;
  - curator fees in replay;
  - a first full mainnet lifecycle, closed and reconciled.
