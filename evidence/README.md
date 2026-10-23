# Evidence

What Cadence has done on Strike mainnet, and what is proven only in replay and tests. Every ID below
comes from a recorded run on 23 October 2026. Times are UTC.

## Mainnet orders

Two dedicated Strike sub-accounts, funded with $10 (Cadence A) and $3 (Cadence B). Sample size:
**two live entries and one close**. Every live order is capped at $25 notional by the worker.

| Time     | What happened                                                                                                                                                                                  | Strike order IDs                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 02:40:24 | Plan `v2rtfw7kaqmv` previewed on both accounts. A: **Ready**, 0.00030 BTC, $24.58, planned risk $0.49 (held to the $25 live cap). B: **Smaller size**, 0.00018 BTC, $14.75, planned risk $0.30 | —                                                             |
| 02:40:54 | A approved: one fill-or-kill limit entry with native target and stop. Filled 0.0003 BTC at 81,742, fee $0.0123                                                                                 | entry `11516191287`, target `11516191288`, stop `11516191289` |
| 02:48:12 | Exits verified: target 84,700 and stop 80,900, reduce-only, sized to the 0.0003 position                                                                                                       | —                                                             |
| 04:28:37 | Plan `dfjkqsvp0v25` previewed. A: **Cannot execute**, "You already have a Cadence plan open on this market". B: **Smaller size**, 0.00018 BTC, $14.72, planned risk $0.29                      | —                                                             |
| 04:28:54 | B approved and filled 0.00018 BTC at 81,552, fee $0.0073. Exits verified 2.8 s after the order was sent                                                                                        | entry `11525670252`, target `11525670253`, stop `11525670254` |
| 06:48:05 | A closed by the member from the order page: one reduce-only market sell, 0.0003 BTC at 81,764. Strike cancelled the stop and target                                                            | close `11538974990`                                           |
| 07:00:24 | A reconciled and its receipt built from the fills: entry 81,742, exit 81,764, realized **−$0.0179** after both fees                                                                            | —                                                             |

B's position is open with its stop and target on Strike.

### Check it yourself

Strike publishes an account's fills by account ID. The responses as captured at 07:01 are in
[`mainnet/`](mainnet/).

```sh
curl "https://api.strikefinance.org/v2/history/fill?account_id=01a15f97-e492-73aa-8feb-eb8d5e292dbc&limit=10"
curl "https://api.strikefinance.org/v2/history/fill?account_id=01a15f99-12ee-716d-943a-b3ddb3e09283&limit=10"
```

## Capability matrix

| Capability                                                      | Strike mainnet                      | Replay and tests                                                               |
| --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| Signed reads: account, positions, open orders, fills            | Yes, both accounts                  | `packages/strike/tests/live-client-reads.test.ts`                              |
| One plan, a different correct size per account                  | Yes, two plans, two accounts        | `packages/core/tests`                                                          |
| Bounded fill-or-kill entry with native stop and target          | Yes, 2 orders                       | `apps/worker/tests/submit.test.ts`                                             |
| Exits verified against the filled size                          | Yes, 2 positions                    | `apps/worker/tests/reconcile.test.ts`                                          |
| Member closes a position, receipt from the fills                | Yes, 1 close                        | `apps/worker/tests/close-position.test.ts`                                     |
| Declined because the account already holds a plan on the market | Yes                                 | `packages/core/tests`                                                          |
| Late entry declined in plain words                              | No                                  | replay scenario "Arrives late"; "declines a late entry in the preview…"        |
| Stale market data refused                                       | No                                  | replay scenario "Old prices"; "declines stale market data in the preview"      |
| Duplicate approvals become one intent and one order             | No                                  | "turns duplicate approvals into one intent and one order"                      |
| Lost response found by client ID, never resent                  | No                                  | replay scenario "Lost answer"; "reconciles a lost response by client ID…"      |
| Worker killed mid-submit sends nothing twice                    | No                                  | "survives a worker killed after the order left…" and "…before the order left…" |
| Missing exits closed with a reduce-only order                   | No                                  | replay scenario "Missing exits"; `apps/worker/tests/end-to-end.test.ts`        |
| $25 live notional ceiling, checked before every send            | Yes, A's first order was held to it | "refuses a live order whose notional is above the live ceiling…"               |
| Plan drafted from the curator's message (AI)                    | Yes, 8 of 8 real-model cases        | `pnpm --filter @cadence/api check:drafting`                                    |
| Telegram plan card and order messages                           | Yes                                 | `apps/api/tests`, `apps/worker/tests/notify*.test.ts`                          |
| Connect with one wallet signature (builder connect)             | Not run                             | `packages/strike/tests/builder-connect.test.ts`                                |
| Curator fee through the curator's builder code                  | Not run; live plans refuse it       | `apps/worker/tests/curator-fee-end-to-end.test.ts`                             |

Replay is a deterministic simulation of Strike with no credentials and no network. It is evidence of
Cadence's logic, never of exchange execution.
