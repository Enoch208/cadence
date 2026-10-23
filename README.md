# Cadence

[![CI](https://github.com/Enoch208/cadence/actions/workflows/ci.yml/badge.svg)](https://github.com/Enoch208/cadence/actions/workflows/ci.yml)

**One trade idea. Your own risk.**

Someone in a Telegram trading group posts a setup. Cadence turns it into a versioned plan that each
member can take on Strike at a size that fits their own account, as one bounded order with Strike's
native stop and target attached, or be told in plain words why they should not. Every fill, exit
and close is reconciled against Strike's own records, and the receipt is built from the fills.

[![Cadence demo video](docs/demo-poster.jpg)](https://youtu.be/T2OdM5DFgmE)

- **Demo video (2:28):** https://youtu.be/T2OdM5DFgmE (also at https://cadencetrade.xyz/demo.mp4,
  and full quality in the [release](https://github.com/Enoch208/cadence/releases/tag/demo-2026-10-23))
- **Live app:** https://cadencetrade.xyz
- **Try it with no money:** the practice plan https://cadencetrade.xyz/p/83c3e2p5dgkw, open until
  26 Oct 20:00 UTC
- **Telegram bot:** [@usecadencebot](https://t.me/usecadencebot)
- **Verified mainnet run:** every order ID, with Strike's public fill history, in
  [`evidence/`](evidence/)

---

## Contents

- [The problem](#the-problem)
- [What Cadence does](#what-cadence-does)
- [Try it in a minute](#try-it-in-a-minute)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [The decision engine](#the-decision-engine)
- [One order, never two](#one-order-never-two)
- [The order lifecycle](#the-order-lifecycle)
- [Exits, closes and recovery](#exits-closes-and-recovery)
- [Telegram](#telegram)
- [What the model does, and what it never does](#what-the-model-does-and-what-it-never-does)
- [Guarantees](#guarantees)
- [The verified mainnet run](#the-verified-mainnet-run)
- [Screens](#screens)
- [Data model](#data-model)
- [Tech stack](#tech-stack)
- [Running it yourself](#running-it-yourself)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)
- [Build log](#build-log)
- [Credits](#credits)

---

## The problem

A curator posts: long at 100, stop at 98, target at 106. A member who sees it forty minutes later
at 105 is taking a different trade, risking seven to make one. Another member's account is a tenth
the size of the curator's. A third never sets the stop. Everyone reads the same message, and
everyone trades it differently, because copying the message loses the conditions that made the idea
coherent.

Copy trading does not fix this: it follows a lead's fills, at the lead's size and timing.

## What Cadence does

Cadence lets a member approve **one published plan under its entry conditions and their own risk
budget**, with Strike's native primitives doing the execution. One link gives three different
correct outcomes:

| Outcome            | When                                                     | What the member sees                                   |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------ |
| **Ready**          | The plan fits the account and the market right now       | The size, limit, planned risk and every cost behind it |
| **Smaller size**   | Margin, depth or the live cap limit the size             | The smaller size and what limited it                   |
| **Cannot execute** | The entry has passed, data is stale, the account is busy | The reason in plain words, with the numbers            |

The product rests on one boundary:

> **Deterministic code decides. AI only drafts.**

A model may turn the curator's pasted message into draft plan fields that the curator confirms. It
never sizes a position, never approves or sends an order, never sees a key, and is absent from the
decision path. Sizing, admission and reconciliation are pure TypeScript, checked by property tests.

## Try it in a minute

No money, no Strike account:

1. Open the practice plan: https://cadencetrade.xyz/p/83c3e2p5dgkw
2. Press **Preview for me** and sign in with Telegram.
3. Under **Accounts**, add the replay accounts **Fills cleanly** and **Arrives late**.
4. Preview the plan with each. One is **Ready**; the other **Cannot execute**, because the price
   has already left the entry range, and it says so.
5. Approve with **Fills cleanly** and watch it go from reserved to filled to **Exits verified**.
6. Press **Close position**, then read the receipt.

Every screen says **Live** or **Replay**. Replay runs against a deterministic simulation of Strike
that has no credentials and no network, so it cannot place a real order.

## How it works

```mermaid
flowchart LR
    A["Setup posted<br/>in the group"] --> B["Draft<br/>AI fills the form,<br/>every value quoted"]
    B --> C["Publish<br/>versioned plan,<br/>fixed by a digest"]
    C --> D["Card in the group<br/>@usecadencebot"]
    D --> E["Preview<br/>member's own account,<br/>book and mark"]
    E --> F{"Decision engine"}
    F -- "Ready · Smaller size" --> G["Approve<br/>one bounded order,<br/>risk reserved"]
    F -- "Cannot execute" --> X["Reason in<br/>plain words"]
    G --> H["Worker<br/>re-checks, persists,<br/>sends once"]
    H --> I["Strike mainnet<br/>FOK entry + native<br/>stop and target"]
    I --> J["Reconcile<br/>fill · exits verified"]
    J --> K["Close<br/>stop, target or<br/>Close position"]
    K --> L["Receipt<br/>from Strike's fills"]
```

1. **Publish.** The curator sets market, direction, entry range, stop, target and an entry window,
   or pastes the setup they already wrote and lets the model fill the form. Each filled value shows
   the words it came from, and the curator confirms before anything is published. The plan is
   versioned and fixed by a SHA-256 digest of its payload; a correction is a new version, so nobody
   approves terms they never saw.
2. **Distribute.** The bot posts a card with a **Preview for me** button in the curator's group.
3. **Preview.** A member signs in with Telegram and picks one of their own Strike sub-accounts.
   Cadence reads the account, the order book and the mark price and returns **Ready**, **Smaller
   size** or **Cannot execute**. A preview is valid for 15 seconds.
4. **Approve.** The approval binds one order for this plan version: at most this size, at this
   limit, filled in full or not at all, with the stop and target attached. Intent, reservation and
   outbox row are written in one transaction before any network call.
5. **Execute.** The worker checks again against fresh data, writes the exact payload, sends one
   strategy order, and finds it by its client ID if the answer is lost.
6. **Reconcile.** A fill is shown only when Strike's state shows it; "Exits verified" only when the
   stop and target are resting at the plan's prices for the filled size. The member gets each step
   as a Telegram message.
7. **Close and receipt.** The position ends at the stop, at the target, or when the member presses
   **Close position**. The receipt ties the plan version and its digest to the fills, fees and
   realized result.

## Architecture

The API decides and records; the worker is the only process that sends orders. Postgres is the
source of truth: every money-moving step is a row before it is a request, so a restarted worker
resumes from the database rather than from memory.

```mermaid
flowchart TB
    subgraph People
        direction LR
        Curator["Curator<br/>browser"]
        Member["Member<br/>phone, from Telegram"]
        Group["Telegram group"]
    end

    subgraph Cadence["Cadence"]
        direction TB
        Web["Web app · Vercel<br/>cadencetrade.xyz"]
        API["API · Hono<br/>sign-in · plans · drafting<br/>previews · consent · receipts"]
        Worker["Worker<br/>the only process<br/>that sends orders"]
        Engine["Decision engine<br/>packages/core · pure"]
        DB[("Postgres<br/>invariants as constraints")]
    end

    subgraph Outside["Services"]
        direction LR
        TG["Telegram Bot API"]
        Strike["Strike mainnet"]
        AI["OpenAI<br/>drafting only"]
    end

    Curator --> Web
    Member --> Web
    Group <--> TG
    Web -- "/api" --> API
    API --> Engine
    Worker --> Engine
    API --> DB
    Worker --> DB
    API <-- "cards · webhook" --> TG
    Worker -- "order messages" --> TG
    Worker -- "signed orders" --> Strike
    API -. "reads" .-> Strike
    API -. "draft" .-> AI
```

- **One engine, two callers.** The API runs the engine for a preview; the worker runs the same
  function again just before sending. Identical inputs give identical decisions.
- **One Strike interface, two clients.** `@cadence/strike` exports a typed client with a live
  implementation (Ed25519-signed, server-clock offset) and a replay implementation (fixtures, no
  signer, no network). The API and worker depend on the interface only; a replay label is display
  metadata the engine never reads.
- **No transaction is held across a Strike call.** Reservation commits first; the worker claims the
  outbox item under a lease, and a crashed worker's lease is reclaimed.

### Where Strike fits

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

Every Strike response is validated with zod at the adapter edge and normalized from PascalCase.
The live client exposes named operations only, every path is a literal in the code, and no response
field can choose a URL or an action.

## The decision engine

`packages/core` is a pure function of the plan version, the member's risk policy, an account
snapshot, active reservations, market rules, depth, mark price, fees and `now`. It has no network
access and no database, so the same code runs in the API, the worker and the tests.

```mermaid
flowchart TD
    In(["Plan version · policy · account · reservations ·<br/>market rules · depth · mark · fees · now"]) --> P{"Plan standing"}
    P -- "revoked · superseded · expired" --> B1["Cannot execute"]
    P --> Cap{"Market and account<br/>capability"}
    Cap -- "unsupported" --> B2["Cannot execute"]
    Cap --> Fr{"Fresh data?<br/>account and book ≤ 3 s · mark ≤ 6 s"}
    Fr -- "stale · unreconciled" --> B3["Cannot execute"]
    Fr --> R{"Price inside<br/>the entry range?"}
    R -- "no" --> B4["Cannot execute<br/>OUTSIDE_ENTRY_RANGE"]
    R --> Ex{"Exposure"}
    Ex -- "plan open on this market ·<br/>unrecognized position or order" --> B5["Cannot execute"]
    Ex --> Bu{"Risk budget left?"}
    Bu -- "no" --> B6["Cannot execute"]
    Bu --> Sz["Size: largest lot that keeps<br/>planned loss within budget,<br/>from depth, never rounded up"]
    Sz --> T{"Margin · depth · minimum ·<br/>liquidation buffer ·<br/>reward to risk after costs"}
    T -- "fails" --> B7["Cannot execute"]
    T -- "limited below budget" --> RS["Smaller size"]
    T -- "full size" --> OK["Ready"]
```

Reasons are reported in a fixed order, so the same failure always reads the same way. The planned
loss the size is searched against:

```text
planned_loss(q) = q · |P − S|               P = worst price the entry may fill at, S = stop
                + entry fee + exit fee      taker rate on q·P and on q·S
                + stop slippage reserve
                + funding reserve           hourly rate × the policy's horizon
                + curator fee               replay plans only

budget  = min(per-trade, aggregate, session budget) − risk already committed
q       = the largest lot-rounded size with planned_loss(q) ≤ budget
```

Planned risk is a modelled loss at the stop, never a maximum loss. Prices, sizes and fees are
decimal strings on the wire, `numeric` in Postgres and `decimal.js` in code, never a JavaScript
`number`.

## One order, never two

Strike does not deduplicate `client_order_id`, and some rejects return 201 with nothing after them.
So every order has a stable identity, derived from the intent and the order's role
(`cad-<intent>-e`, `-s`, `-t`, `-c`, `-r`), written to the database with its exact payload and
digest before it is sent, and looked up by that identity before anything is ever sent again.

```mermaid
sequenceDiagram
    autonumber
    participant M as Member
    participant A as API
    participant DB as Postgres
    participant W as Worker
    participant S as Strike mainnet
    participant T as Telegram

    M->>A: Approve this plan (preview id)
    A->>DB: One transaction: intent, reservation, outbox row
    Note over A,DB: A second click finds the same intent<br/>(unique per account and plan version)
    A-->>M: Intent id
    W->>DB: Claim the outbox item under a lease
    W->>S: Fresh account, book and mark
    W->>W: Same engine again: inside the approved envelope,<br/>under the live notional ceiling
    W->>DB: Exact payload and digest under cad-…-e / -s / -t
    W->>S: POST /v2/order/strategy (FOK limit, stop, target)
    alt the answer arrives
        S-->>W: Acknowledged
    else the answer is lost, or the worker is killed
        W->>S: GET /v2/order?client_order_id=cad-…-e
        Note over W,S: Found, filled or absent: decided on evidence,<br/>never by sending again
    end
    W->>S: Positions, open orders, fills
    W->>DB: fill_observed, then exits_verified
    W->>T: "Exits verified" to the member
```

If the answer can be resolved neither way, the reservation stays and new entries on that account
pause until a person looks. The live ceiling (`CADENCE_LIVE_MAX_NOTIONAL`, $25 in production) is
required at startup with no default and checked immediately before every live send, whatever the
member's budget.

## The order lifecycle

The intent's state moves only through this table (`packages/core/src/transitions.ts`). Silence is
never an outcome: no answer within the timeout means `unknown`, which is then reconciled.

```mermaid
stateDiagram-v2
    [*] --> prepared
    prepared --> reserved : approved
    prepared --> blocked : validation_failed
    reserved --> submitted : submit_attempted
    reserved --> blocked : validation_failed
    reserved --> expired : entry_window_closed
    submitted --> unknown : submit_timed_out
    unknown --> submitted : acknowledged
    submitted --> rejected : exchange_rejected
    submitted --> unfilled : entry_unfilled
    submitted --> canceled : entry_canceled
    submitted --> open_verifying : fill_observed
    unknown --> rejected : exchange_rejected
    unknown --> unfilled : entry_unfilled
    unknown --> open_verifying : fill_observed
    open_verifying --> open_verified : exits_verified
    open_verifying --> recovery_required : exits_missing
    open_verifying --> closed : close_reconciled
    open_verified --> closed : close_reconciled
    open_verified --> recovery_required : exits_missing
    recovery_required --> open_verified : exits_verified
    recovery_required --> closed : recovery_confirmed
    blocked --> [*]
    rejected --> [*]
    unfilled --> [*]
    canceled --> [*]
    expired --> [*]
    closed --> [*]
```

An HTTP acknowledgement is never shown as filled, and a fill is never shown as "Exits verified"
until both exits are observed against the actual position size.

## Exits, closes and recovery

Every reconcile pass judges an open position from what Strike reports, not from what Cadence sent.

```mermaid
flowchart TD
    O(["Open position<br/>reconcile pass"]) --> Opp{"Position held<br/>the other way?"}
    Opp -- "yes" --> Pz["Touch nothing,<br/>pause new entries"]
    Opp -- "no" --> Held{"Position size > 0?"}
    Held -- "yes" --> Armed{"Stop and target resting,<br/>reduce-only, at the plan's prices,<br/>covering the filled size?"}
    Armed -- "yes" --> V["Exits verified"]
    Armed -- "still missing 10 s<br/>after the fill" --> Rec["Recovery required:<br/>cancel the residual entry,<br/>reduce-only close of the reconciled size"]
    Held -- "no" --> Flat{"No exit still resting,<br/>fills net to zero,<br/>a member's close attributed?"}
    Flat -- "yes" --> C["Closed<br/>receipt from the fills"]
    Flat -- "no" --> Hold["Hold, look again next pass"]
```

- **Member close.** **Close position** sends one reduce-only market order under `cad-<intent>-c`,
  persisted before it is sent and never resent. Once the position is flat, any stop or target the
  exchange left resting is cancelled, at most once each.
- **Recovery** never reverses a position, only reduces it, and "Recovery required" stays on screen
  until it is resolved.
- **Strike's order lookup lags its fills.** On mainnet `GET /v2/order` returned nothing for a filled
  fill-or-kill entry for about seven minutes, and after a close it kept reporting cancelled exits as
  resting. Cadence therefore also reconciles from fill history and open orders: an unlabelled fill is
  attributed to the entry or to the member's close only under strict guards (one order, the right
  side, after the send, no larger than the order, never an exit's order).

## Telegram

Telegram is distribution, never authority.

- **Sign-in** uses Telegram-signed login data, checked on the server. A Telegram ID alone never
  authenticates a financial action; every account, intent and receipt route checks the session's
  ownership.
- **Plan cards** are posted by @usecadencebot to the curator's group, with the levels, the entry
  window and a **Preview for me** button.
- **Order messages** go to members who have started the bot, one per state change, from an outbox
  of their own: `submitted`, `open_verified`, `closed` and the rest, each sent at most once.
- **The webhook** only accepts requests carrying a secret derived from the bot token with
  HMAC-SHA256 and compared in constant time (`apps/api/src/telegram/webhook-secret.ts`). When the
  bot is added to a group it replies with the group's ID, so the curator can connect it.
- **No key ever travels through Telegram.**

## What the model does, and what it never does

| Job          | Input                                              | Output                                                    | Guard                                                                                                                                                    |
| ------------ | -------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft a plan | The curator's pasted message, Strike's market list | Eight plan fields, each with the exact words it came from | A value is kept only if its quote is in the message and, for a price, states that number; the rest come back as missing; the curator confirms each field |

The model is OpenAI `gpt-6.1-sol` through the Responses API with a strict JSON schema and
`store: false` (`apps/api/src/drafting/`). Drafting is off unless a key is set, limited to 12
drafts per member per 10 minutes, and nothing it returns is stored or published. A real-model check
(`pnpm --filter @cadence/api check:drafting`) passed 8 of 8 messages on 22 October, median 4.0 s.
The model never sizes, never decides, never approves, never sends and never sees a key.

## Guarantees

Each of these is enforced in code or by a database constraint, and covered by tests.

| Guarantee                                                | How                                                                                | Where                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A double click is one intent and one order               | Unique intent per account and plan version, inside the approval transaction        | `packages/db/src/schema/intents.ts`, `apps/api/src/intents/approve.ts`                   |
| One Cadence plan per account and market                  | Partial unique index on open intents, and `SYMBOL_BUSY` in the engine              | `packages/db/src/schema/intents.ts`, `packages/core/src/decide-checks.ts`                |
| Nothing is sent that was not written first               | Payload and digest persisted under the derived client ID before the request        | `apps/worker/src/submit.ts`, `apps/worker/src/order-rows.ts`                             |
| A lost answer is never resent                            | Looked up by client ID; an unresolved one keeps the reservation and pauses entries | `apps/worker/src/entry-verdict.ts`, `apps/worker/src/reconcile.ts`                       |
| A worker killed mid-submit sends nothing twice           | Outbox leases are reclaimed and the intent resumes from persisted state            | `apps/worker/src/outbox.ts`, `apps/worker/tests/end-to-end.test.ts`                      |
| An order never leaves the approved envelope              | Re-check before sending: no larger size, no worse limit, no changed curator fee    | `apps/worker/src/recheck.ts`, `apps/worker/src/envelope.ts`                              |
| No live order above the ceiling                          | `CADENCE_LIVE_MAX_NOTIONAL` required at startup and checked before every live send | `apps/worker/src/env.ts`, `apps/worker/src/envelope.ts`                                  |
| "Exits verified" means the exits are really there        | Both legs resting, reduce-only, at the plan's prices, covering the filled size     | `apps/worker/src/exits.ts`                                                               |
| Missing exits are closed, never reversed                 | Cancel the residual entry, then a reduce-only close of the reconciled size         | `apps/worker/src/recovery.ts`                                                            |
| A member's close is sent once and leaves nothing resting | Persisted close row, never resent; leftover exits cancelled at most once           | `apps/worker/src/close-position.ts`, `apps/worker/src/close-view.ts`                     |
| A receipt never shows a hypothetical result              | Built from persisted fills only; realized PnL only when exits equal entries        | `packages/core/src/receipt.ts`, `apps/worker/src/receipts.ts`                            |
| Replay cannot place a real order                         | The replay client takes no credentials and never calls `fetch`                     | `packages/strike/src/replay-client.ts`, `packages/strike/tests/replay-scenarios.test.ts` |
| A member's key is never readable at rest                 | AES-256-GCM, bound to owner, account, environment and key version                  | `packages/db/src/credential-vault.ts`                                                    |
| A key that Strike refuses stops trading at once          | The connection is disconnected on a credential failure                             | `apps/worker/src/credentials.ts`                                                         |
| A Telegram message is never sent twice                   | One notification per intent and state, claimed before sending                      | `packages/db/src/schema/notifications.ts`, `apps/worker/src/notify-queue.ts`             |
| A curator fee never reaches a live order                 | Live plans with a curator fee fail validation                                      | `packages/core/src/plan.ts`                                                              |

## The verified mainnet run

Two dedicated Strike sub-accounts, funded with $10 (A) and $3 (B), on 23 October 2026 (UTC). Sample
size: **two live entries and one close.** Full IDs and the captured fill history are in
[`evidence/`](evidence/).

| Time     | What happened on Strike mainnet                                                                                             | Strike order IDs                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 02:40:24 | One plan previewed on both accounts: A **Ready** at $24.58 (held to the $25 cap), B **Smaller size** at $14.75              | —                                                             |
| 02:40:54 | A filled 0.0003 BTC at 81,742 as one fill-or-kill entry, with native target 84,700 and stop 80,900                          | entry `11516191287`, target `11516191288`, stop `11516191289` |
| 02:48:12 | Exits verified against the 0.0003 position                                                                                  | —                                                             |
| 04:28:37 | A second plan: A **Cannot execute**, "You already have a Cadence plan open on this market"; B **Smaller size** at $14.72    | —                                                             |
| 04:28:54 | B filled 0.00018 BTC at 81,552; exits verified 2.8 s after the order was sent                                               | entry `11525670252`, target `11525670253`, stop `11525670254` |
| 06:48:05 | A closed from Cadence with **Close position**: one reduce-only sell, 0.0003 at 81,764; Strike cancelled the stop and target | close `11538974990`                                           |
| 07:00:24 | A reconciled; receipt from the fills: entry 81,742, exit 81,764, realized **−$0.0179** after both fees                      | —                                                             |

Check them yourself on Strike's public fill history:

```sh
curl "https://api.strikefinance.org/v2/history/fill?account_id=01a15f97-e492-73aa-8feb-eb8d5e292dbc&limit=10"
curl "https://api.strikefinance.org/v2/history/fill?account_id=01a15f99-12ee-716d-943a-b3ddb3e09283&limit=10"
```

The landing page's counters are read from Cadence's own records of live orders: at the time of
writing, 3 plans published, 2 orders placed, 2 exits verified, 0 duplicate orders. B's position is
open with its exits on Strike.

## Screens

| Route                  | What it is for                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/`                    | The landing page, with the live counters                                                                        |
| `/p/:publicId`         | The public plan a Telegram card links to                                                                        |
| `/p/:publicId/preview` | Pick an account, see Ready, Smaller size or Cannot execute with every cost, and approve                         |
| `/intents/:id`         | The order: its timeline, what was approved, each order on Strike, and **Close position**                        |
| `/receipts/:id`        | The receipt: plan version and digest, fills, fees, realized result and every Strike order ID                    |
| `/app`                 | The dashboard: open orders, history, and each published plan's funnel (previewed, could take, approved, filled) |
| `/author`              | Publish a plan, from the form or from a pasted message                                                          |
| `/account`             | Connect a Strike sub-account key, add replay accounts, set risk rules, pause new entries                        |

## Data model

```mermaid
erDiagram
    USERS ||--o{ COMMUNITIES : "owns"
    USERS ||--o{ COMMUNITY_PUBLISHERS : "publishes as"
    COMMUNITIES ||--o{ COMMUNITY_PUBLISHERS : "allows"
    COMMUNITIES ||--o{ PLANS : "hosts"
    PLANS ||--o{ PLAN_VERSIONS : "versioned as"
    USERS ||--o{ ACCOUNT_CONNECTIONS : "connects"
    USERS ||--o{ RISK_POLICIES : "sets"
    PLAN_VERSIONS ||--o{ PREVIEWS : "previewed in"
    ACCOUNT_CONNECTIONS ||--o{ PREVIEWS : "checked against"
    PREVIEWS ||--o| EXECUTION_INTENTS : "approved as"
    EXECUTION_INTENTS ||--|| RESERVATIONS : "holds"
    EXECUTION_INTENTS ||--o{ EXCHANGE_ORDERS : "sends"
    EXCHANGE_ORDERS ||--o{ FILLS : "filled by"
    EXECUTION_INTENTS ||--o| RECEIPTS : "ends in"
    EXECUTION_INTENTS ||--o{ OUTBOX : "queues"
    EXECUTION_INTENTS ||--o{ NOTIFICATIONS : "messages"
    EXECUTION_INTENTS ||--o{ EVENTS : "logs"
    USERS ||--o{ BUILDER_CHALLENGES : "wallet connect"

    PLAN_VERSIONS {
        int version
        jsonb payload
        string digest
        bigint entryExpiresAt
    }
    ACCOUNT_CONNECTIONS {
        string environment
        string strikeAccountId
        bytes keyCiphertext
        int keyVersion
        string credentialSource
    }
    EXECUTION_INTENTS {
        string state
        jsonb approved
        string approvedDigest
        string strategyId
    }
    RESERVATIONS {
        numeric plannedLoss
        numeric initialMargin
        string status
    }
    EXCHANGE_ORDERS {
        string role
        string clientOrderId
        string exchangeOrderId
        jsonb payload
        string payloadDigest
    }
    FILLS {
        string exchangeFillId
        string side
        numeric price
        numeric size
        numeric fee
    }
```

The invariants live in the database, not only in code:

| Constraint                                                                     | What it guarantees                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `execution_intents_account_plan_version_unique`                                | One intent per account per plan version              |
| `execution_intents_account_market_open_unique`                                 | One open Cadence plan per account and market         |
| `exchange_orders_client_order_id_unique`, `exchange_orders_intent_role_unique` | One order per role per intent, one row per client ID |
| `fills_exchange_fill_id_unique`                                                | A fill is stored once                                |
| `reservations_intent_unique`                                                   | One reservation per intent                           |
| `outbox_intent_kind_open_unique`                                               | One open job of each kind per intent                 |
| `notifications_intent_state_unique`                                            | One Telegram message per intent and state            |
| `*_digest_is_sha256`, `*_not_negative`, `*_positive`                           | Digests, sizes and prices are well formed            |

The Postgres enums are built from the same arrays as the shared contract
(`packages/core/src/contract.ts`), so the database and the wire cannot disagree. The full schema is
in `packages/db/src/schema/`, with migrations generated by drizzle-kit in `packages/db/drizzle/`.

## Tech stack

| Layer    | Choice                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Exchange | Strike Finance perpetuals, mainnet: REST with Ed25519 request signing                                   |
| Engine   | Pure TypeScript, `decimal.js`, zod 4                                                                    |
| API      | Hono on Node 24, grammY for Telegram, the OpenAI SDK for drafting                                       |
| Worker   | A separate persistent Node process with a Postgres outbox                                               |
| Database | Postgres 17 through Drizzle ORM, migrations from drizzle-kit                                            |
| Frontend | React 19, Vite 8, Tailwind CSS 4, motion, React Router, Hugeicons                                       |
| Hosting  | Vercel for the web app; the API and worker under systemd on a VPS, behind nginx with TLS                |
| Tests    | Vitest 5 projects against real Postgres, captured Strike responses and the replay client                |
| Tooling  | pnpm 10.33 with exact pins, TypeScript 5.9 strict, ESLint strict type-checked, Prettier, GitHub Actions |

## Running it yourself

You need Node 24, pnpm 10.33 and Docker (or any Postgres 17).

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

To run the API and the worker, copy `apps/api/.env.example` and `apps/worker/.env.example` to
`.env` in each app and fill them in:

| Variable                                           | Used by       | What it is                                                          |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                                     | API, worker   | Postgres connection                                                 |
| `KEY_ENCRYPTION_KEY`, `KEY_ENCRYPTION_KEY_VERSION` | API, worker   | The key that seals members' Strike keys, and its version            |
| `STRIKE_API_BASE`                                  | API, worker   | `https://api.strikefinance.org`                                     |
| `CADENCE_LIVE_MAX_NOTIONAL`                        | API, worker   | The hard ceiling on any live order's notional, required, no default |
| `TELEGRAM_BOT_TOKEN`                               | API, worker   | The bot that posts cards and order messages                         |
| `PUBLIC_WEB_ORIGIN`                                | API, worker   | The web app's origin, for links in messages                         |
| `SESSION_SECRET`, `PORT`, `TELEGRAM_BOT_USERNAME`  | API           | Sessions, the listening port, the bot's username for sign-in        |
| `OPENAI_API_KEY`                                   | API, optional | Turns drafting on                                                   |
| `STRIKE_BUILDER_CODE`                              | API, optional | Turns wallet connect on                                             |

| Command                                                             | What it does                                 |
| ------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm --filter @cadence/api dev`                                    | The API with reload                          |
| `pnpm --filter @cadence/worker dev`                                 | The worker                                   |
| `pnpm --filter @cadence/web dev`                                    | The web app on http://127.0.0.1:5190         |
| `pnpm test` · `pnpm test --project core`                            | Every test, or one package                   |
| `pnpm typecheck` · `pnpm lint` · `pnpm format:check` · `pnpm build` | The gate CI runs on every push               |
| `pnpm --filter @cadence/strike probe:account`                       | A read-only signed probe of a Strike account |

Live orders are placed only by the worker. The probe scripts are read-only by default; one that
places or cancels an order needs an explicit `--live-order` flag, prints the exact payload first and
is capped at the market minimum.

## Testing

**91 test files and 1,108 tests**, run on every push in GitHub Actions against a real Postgres.
Tests never reach Strike: they run against sanitized captured mainnet responses through the client
interface, or against the replay client.

| Package           | Files | Tests | What it covers                                                                                             |
| ----------------- | ----: | ----: | ---------------------------------------------------------------------------------------------------------- |
| `packages/core`   |    15 |   422 | The engine: grids, pricing, costs, margin, every admission stage, sizing properties, transitions, receipts |
| `packages/strike` |    19 |   258 | Signing, request bytes, response schemas from captured mainnet replies, live and replay clients            |
| `apps/api`        |    31 |   242 | Sign-in, plans and digests, drafting verification, previews, consent and reservation, ownership, Telegram  |
| `apps/worker`     |    16 |   123 | Submission, lost answers, restarts, reconciliation, exits, recovery, closes, curator fees, notifications   |
| `apps/web`        |    10 |    63 | Copy for every state and reason, the plan form, draft filling, example figures against the engine          |

The sizing properties in `packages/core/tests/decide-properties.test.ts` run across generated
inputs: a lower budget, a worse quote, a higher taker fee or a curator fee never increases the
quantity; planned loss never exceeds the admissible budget; every bounded entry is inside the range,
on Strike's grids and fillable; identical input gives identical output; and a mirrored short gets
the mirrored outcome of a long. The worker's end-to-end tests kill the worker before and after the
order leaves and check that a fresh worker sends nothing twice.

## Project layout

| Path               | What lives there                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `packages/core/`   | The shared contract and the pure engine: grids, pricing, costs, margin, decision, lifecycle, receipts |
| `packages/strike/` | The Strike adapter: signer, server clock, zod schemas, the live, public and replay clients            |
| `packages/db/`     | The schema with its constraints, migrations, the credential vault, exposure                           |
| `apps/api/`        | Hono routes: auth, plans, drafting, previews, intents, receipts, stats, the Telegram webhook          |
| `apps/worker/`     | The executor: outbox, submit, reconcile, close, recovery, notifications                               |
| `apps/web/`        | The landing page and the member and curator screens                                                   |
| `evidence/`        | The capability matrix and captured mainnet fill history                                               |

## Known limitations

- **Sample size.** Two live entries and one close, on BTC-USD only.
- **Cadence holds a delegated trading key.** A member's Strike key is sealed at rest and bound to
  one sub-account that cannot withdraw, but Cadence can trade with it. Cadence is not
  non-custodial.
- **Wallet connect has not run on mainnet.** It binds a member's main account rather than a
  sub-account. Its key never expires, and Strike lets it reach deposit, withdrawal and vault
  routes; Cadence has no code that calls them.
- **Curator fees are replay only.** The fee path is built and tested end to end in replay, and live
  plans refuse it until it has run on mainnet. Whether Strike's fill fee already includes a builder
  fee is unverified, so the receipt labels the curator fee as computed.
- **Reconciliation can wait on Strike.** When its order lookup lags, a close is reconciled from fill
  history and open orders; in the verified run, A's close took twelve minutes to reconcile, which
  included deploying the fix for that lag.
- **Planned risk is a model.** It is the loss at the stop with costs, not a maximum loss. A stop can
  fill worse than planned, and funding can change.
- **Positions are public.** Strike positions are readable by account ID, so Cadence makes no
  privacy claim about them.
- **The practice group is the builder's own.** What its members say is feedback, not traction.

## Build log

- **21 Oct.** The shared contract between engine, Strike adapter and backend, frozen before any
  feature; CI on every push.
- **22 Oct.** In order:
  - the decision engine and sizing;
  - the Strike adapter with signing and validated responses, and the replay client;
  - the schema with invariants as constraints;
  - previews, consent and reservation;
  - the worker with persist-before-send and reconciliation;
  - the landing page and the app screens;
  - Telegram sign-in, plan cards and order messages;
  - AI drafting from the curator's message;
  - wallet connect;
  - the curator funnel;
  - deployment.
- **23 Oct.** In order:
  - the first mainnet orders;
  - reconciliation from fills when Strike's order lookup lags;
  - **Close position**;
  - curator fees in replay;
  - a full mainnet lifecycle, closed and reconciled.

## Credits

- The landing page's layout is adapted from the free
  [Meeko](https://meeko-template.framer.website/) Framer template by Elemis Themes, used under the
  Framer Community terms; none of its images or illustrations ship.
- Typefaces: Uncut Sans, Inter and Caveat, under the SIL Open Font License. Icons: Hugeicons free.
- The Strike logo belongs to Strike Finance and is used unmodified.
