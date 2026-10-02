# Analytics & Conversion-Tracking Runbook

Operational reference for the revenue-conversion signal paths (Meta CAPI Purchase, GA4 Purchase)
and who watches them. Companion to `docs/adr/ADR-009-conversion-tracking-ownership-and-watcher.md`,
which records the ownership decision this doc operationalizes: **no new agent** — `log-monitor`
owns real-time triage via deterministic code, `store-strategist` owns the weekly trend, and the
alarm itself is a boolean invariant on a small number of DB rows, never an LLM classifying logs.

## Signal inventory

| Signal | Destination | Source event | Delivery path | Ledger table | Idempotency key |
|---|---|---|---|---|---|
| Meta CAPI Purchase | Meta Conversions API | Shopify `orders/create` webhook | webhook leg (pre-response) + 15-min reconcile sweep, both via `sendPurchaseWithLedger` (`app/lib/purchase-capi.server.ts`) | `meta_capi_outbox` | `purchase_<shopifyOrderId>` (`buildPurchaseEvent`) |
| GA4 Purchase | GA4 Measurement Protocol | Shopify `orders/create` webhook | webhook leg only today (no reconcile sweep yet, see Known debt) | `ga4_purchase_outbox` | per `app/lib/ga4-summary.server.ts` / the webhook's GA4 send call in `server/webhooks.ts` |

Both tables are read without a direct DB connection via `GET /api/team/conversion-status`
(team-token auth), which returns each table's unresolved count and oldest-unresolved age. This is
the QA-reachable substitute for a raw `psql` (a cloud QA session's egress is restricted to
xdipx.com).

## The two-leg architecture and the Purchase dedup contract

Purchase is the only conversion event with no browser-pixel counterpart — the shopper is on
Shopify's checkout domain when it happens — so the `orders/create` webhook is the only real-time
path. A webhook that silently never fires (the actual 2026-05 to 2026-07 failure mode, see
Incident record) cannot be fixed by making the webhook handler better, so delivery is built on two
independent legs that both produce the **identical deterministic event id** and can therefore run
freely without double-counting:

1. **Webhook leg.** `server/webhooks.ts`'s `/order-created` handler calls
   `sendPurchaseWithLedger(fromWebhookOrder(order))` before responding to Shopify.
2. **Reconcile leg.** `reconcilePurchases()` (same file) sweeps Shopify orders with
   `financial_status:paid` over a trailing window (default 26h) and sends whatever the ledger has
   no **resolved** row for. It runs on a 15-minute cadence today by riding `/cron/log-monitor`'s
   schedule (see Known debt) and is also reachable directly at `POST /cron/purchase-reconcile`
   (`sinceHours`, `dryRun` params).

**The dedup contract:** the event id is `purchase_<orderId>` and nothing else
(`buildPurchaseEvent`). Both legs compute it the same way, so Meta collapses a webhook send and a
later reconcile send for the same order into one conversion — running both is free, and a Shopify
webhook retry is idempotent for the same reason. The `meta_capi_outbox` row is written **before**
the send is attempted, not only on failure, so "we tried" survives a process death mid-flight; an
unresolved row (`resolvedAt IS NULL`) means either in-flight or genuinely stuck, never "never
attempted."

Meta rejects events older than 7 days (`META_MAX_EVENT_AGE_MS`), so the reconciler cannot recover a
gap past that window — it ages into `tooOld` in `ReconcileResult` and stays an unrecovered loss.

## Incident record: 2026-05 to 2026-07

Meta CAPI `Purchase` was never delivered in production for over two months. Traced 2026-07-31.
Root cause: the `orders/create` webhook had never fired at all — `order_line_items` was empty for
every order ever placed — compounded by two design flaws fixed in the same pass:

- Conversion sends ran as unawaited post-response work with no `waitUntil` primitive on Vercel
  fluid compute, so the process could be torn down before the send completed.
- `sendCapiEvent` returned `{ok: true}` on missing credentials, making a misconfigured environment
  indistinguishable from a delivered conversion.

A related gap: `docs/audits/2026-07-29-agent-fleet-evaluation.md` had already flagged
`meta_capi_failures` (the table's name before the `meta_capi_outbox` rename) and
`ga4_purchase_failures` as "write-only, nothing watches" two days before this incident was traced —
the fix had already been recommended and sat unactioned, which is itself part of why ownership is
now written down here rather than left implicit.

A second, smaller incident on 2026-08-05 to 06: migration 082's unapplied rename left
`meta_capi_outbox` briefly absent, so every Purchase ledger write failed for roughly two days with
the only visible symptom being a 500 on `/api/team/conversion-status` (tickets #5061/#5092). This
is why `recordLedgerWriteFailure()` now bumps an independent KV counter
(`getPurchaseCapiWriteFailureCount()`) on a persistent ledger-write failure, so a renamed or
missing table surfaces within hours even if the Neon-backed ledger itself is the thing that is
broken.

## Manual health-check steps

1. **Unresolved-queue snapshot:** `GET /api/team/conversion-status` (team-token auth) — unresolved
   count and oldest-unresolved age for both `meta_capi_outbox` and `ga4_purchase_outbox`. Zero and
   null is healthy.
2. **Dry-run reconcile:** `POST /cron/purchase-reconcile` with `{"dryRun": true}` — reports
   `scanned`/`gaps`/`tooOld` without sending anything, so you can see whether the webhook leg is
   keeping up without risking a duplicate-adjacent send (duplicates are harmless per the dedup
   contract, but a dry run is still the right first look).
3. **Meta Test Events:** confirm `events_received` is nonzero and matches recent order volume in
   Meta Events Manager's Test Events tool. `events_received: 0` on an HTTP 200 is a **failure**,
   not a pass — `meta-capi.server.ts` reports it as such rather than silent success (the exact
   failure mode that hid the original two-month gap).
4. **GA4 DebugView:** confirm `purchase` events are arriving with the expected `transaction_id` and
   value, matching recent order volume.
5. **Ledger write-failure counter:** `getPurchaseCapiWriteFailureCount()` (exported from
   `purchase-capi.server.ts`) — nonzero over the trailing ~48h means the ledger itself (not just
   the Meta send) is failing to write, which is the migration-082-class failure above.

## Alarm ownership and escalation

Real-time detection is deterministic code, never an LLM classifying logs: a revenue-conversion gap
is a boolean invariant on a small number of rows and must alarm the same way every time.

- **`purchase-watcher.server.ts`** (ticket #590) runs from the `/cron/log-monitor` handler every 15
  minutes and checks four signals: (1) unresolved `meta_capi_outbox` rows older than its staleness
  threshold, (2) the same for `ga4_purchase_outbox`, (3) a recent-order gap — Shopify reports paid
  orders in the window but one or more left no `order_line_items` row, meaning the webhook path
  never processed them — gated behind a consecutive-run strike threshold so lag doesn't false-alarm
  and a zero-sale day (normal at this store's volume) is never read as a failure, and (4) the
  fallback-stub marker in recent logs (a misconfigured Shopify webhook subscription hitting the
  React Router stub route instead of the real Express handler).
- **Routing:** P0 (webhook dead with live orders — checks 3 and 4) pages by email **and** SMS via
  `app/lib/owner-alerts.server.ts`. P1 (historical / individual send failures — checks 1 and 2) is
  email only. Neither opens a GitHub issue — these are operational alerts, not bug reports.
  Each alert fires at most once per episode, deliberately, after the alarm-fatigue lesson below.
- **`log-monitor` is the triage owner** for anything this surfaces outside the automated alert path
  (see `.claude/agents/log-monitor.md`'s `critical_knowledge`). It reads Vercel logs; it does not
  gain DB query tools — the deterministic alarm above is what puts the signal in front of it.
- **`store-strategist` is the weekly trend owner.** Its mandatory Acquisition section already
  tracks "what reached a human" per channel weekly (see `.claude/agents/store-strategist.md`'s
  `<inputs>`); this is the cadence that would have caught the original two-month gap on its own,
  independent of whether the real-time alarm has a bug.
- **`ads-manager`** keeps its existing narrow handoff only: catalog feed / pixel / CAPI issues it
  notices in diagnostics become a `suggestion` of kind `code`. It gains no new tools or scope — it
  is propose-only and the wrong agent to self-certify the health of the pipeline its own ROI math
  depends on.
- **Alarm-fatigue discipline:** the checkout-probe incident (fleet audit finding #13) paged
  email+SMS daily on 6/6 failing runs with no real signal behind it. Every alarm here has an
  explicit threshold (a gap surviving multiple consecutive sweeps, not the first observed miss) so
  a page means something.

## Known debt (ticket numbers)

- **`/cron/purchase-reconcile` still rides `/cron/log-monitor`'s schedule rather than having its own
  `vercel.json` entry.** Accepted as an emergency stopgap in ADR-009 because the code is
  independently try/catch-wrapped and the route already exists for a clean one-line addition
  later — but it means the reconciliation goes dark, silently, the day someone disables or
  refactors log-monitor's cron without knowing something else rides it. `vercel.json` is a
  protected path, so this needs an owner-attended PR, not one agent-editor or R-DEV can land
  unattended.
- **No reconcile sweep for GA4 Purchase**, only for Meta CAPI. The signal-inventory table above
  reflects this asymmetry; closing it means extending `reconcilePurchases()` (or a GA4-specific
  sibling) to also sweep `ga4_purchase_outbox`.
- **No generalized invariant registry yet.** ADR-009 proposed `app/lib/ops-invariants.server.ts` —
  a small declarative `{ name, query, thresholdFn, severity }` list generalizing
  `gatherOpsWatch()`'s existing bespoke checks (social draft backlog, pricing-recompute miss,
  enrichment staleness, stranded verified tickets) plus CAPI/GA4 gap detection. As of this writing
  that file does not exist; `gatherOpsWatch()` in `app/lib/owner-digest.server.ts` still carries
  four individually hand-rolled checks. Revisit if a sixth same-shape surface appears (ADR-009
  explicitly rejected building the heavier version pre-emptively).
- **`store-strategist`'s Acquisition table has no Conversion Tracking row yet** (Shopify paid-order
  count vs. resolved outbox rows for the week), though ADR-009 calls for one. Out of scope for this
  doc's own wiring step; tracked here so it isn't lost.

## Common failure modes

- **Missing credentials returning `skipped` instead of a loud failure.** Check `meta-capi.server.ts`
  reports missing Meta credentials as a failure (`result.error`/`result.skipped`), not as
  `{ok: true}` — the exact bug that hid the original two-month gap. If you see `events_received: 0`
  on an HTTP 200 from Meta, that is a failure to investigate, not a pass.
- **Stuck unresolved rows with no `lastError`.** Usually means the send never completed (process
  died mid-flight) rather than a Meta-side rejection. The reconcile sweep will retry it on its next
  pass as long as the order is still inside Meta's 7-day event window.
- **A renamed or temporarily-missing ledger table.** Surfaces as a spike in
  `getPurchaseCapiWriteFailureCount()` and/or a 500 from `/api/team/conversion-status`, independent
  of whether the Meta send itself is healthy. See the 2026-08-05/06 incident above.
- **Reconcile sweep throttled by a colliding Shopify Admin query on the same cron tick.** The sweep
  retries THROTTLED errors up to 4 times with an escalating backoff (`RECONCILE_THROTTLE_RETRIES`,
  `RECONCILE_THROTTLE_BACKOFF_MS`); if it is throttled on every single run, look for another job
  sharing the same 15-minute tick and holding the Shopify rate-limit bucket near zero (observed
  2026-08-05 against the discovery-index rebuild).
- **A zero-Purchase day reading as a failure.** This store runs single-digit daily orders, so a
  quiet day is normal and must never page. `purchase-watcher.server.ts` only treats a gap as P0
  when Shopify's own ground truth shows paid orders existed in the window and the gap survives
  multiple consecutive sweeps — never on raw silence.

---

Wiring: `.claude/agents/log-monitor.md` and `.claude/agents/store-strategist.md` both cite this
runbook (ADR-009's "a doc nobody cites is a doc nobody reads").
