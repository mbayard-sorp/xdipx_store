# ADR-009: Conversion-tracking ownership, the write-only-table watcher, and the reconciliation stopgap

Date: 2026-07-31
Status: Accepted
Author: tech-architect (review of rr7-engineer's purchase-CAPI fix)

## Context

Meta CAPI `Purchase` was never delivered in production for over two months. Root
cause: the `orders/create` webhook never fired at all (`order_line_items` is
empty for every order ever placed), compounded by two design flaws now fixed:
conversion sends ran as unawaited post-response work with no `waitUntil` on
Vercel fluid compute, and `sendCapiEvent` returned `{ok: true}` on missing
credentials, making a misconfigured environment indistinguishable from a
delivered conversion.

`rr7-engineer` shipped the code fix: `app/lib/purchase-capi.server.ts`
(deterministic `purchase_<orderId>` event id, a write-before-send ledger
reusing `meta_capi_failures` as an outbox, `reconcilePurchases()`), moved the
conversion sends before the webhook response under a 2500ms ceiling, and made
`meta-capi.server.ts` report missing credentials and `events_received: 0` as
failures rather than silent success. This ADR covers what the code fix does
not: who watches this surface going forward, and whether the pattern
generalizes.

`docs/audits/2026-07-29-agent-fleet-evaluation.md` had already flagged
`meta_capi_failures` and `ga4_purchase_failures` as "write-only, nothing
watches" two days before this incident was traced, and recommended (finding,
"do you need more agents", #2) "a small new cron or log-monitor extension" —
that recommendation sat unactioned, which is itself evidence for the decision
below.

## Decision

**1. Ownership is split by cadence, not given to one new agent.**

- **Real-time gap detection is deterministic code, not an agent.** The
  reconcile sweep already logs a `console.warn` on any gap
  (`purchase-capi.server.ts`); this ADR requires that warning to also call
  `sendOwnerEmail`/`sendOwnerSms` (`app/lib/owner-alerts.server.ts`) the same
  way the checkout probe does, with an explicit threshold (a gap that
  survives two consecutive 15-minute reconcile runs, i.e. ~30 minutes
  unresolved) to avoid the checkout-probe alarm-fatigue mistake (fleet audit
  finding #13: 6/6 failing runs paged email+SMS daily with no real signal).
  A revenue-conversion gap must not depend on an LLM classifying free-text
  logs correctly; it is a boolean invariant on a small number of rows and
  should alarm the same way every time.
- **`log-monitor` is the triage owner** for the P0/P1 this produces. It
  already owns "webhook failures" as a signal category and already opens a
  GitHub issue per P0 group in autonomous mode — this surface becomes one
  more pattern in its `critical_knowledge` list
  (`.claude/agents/log-monitor.md`), not a new capability. It does not gain
  DB query tools; it keeps reading Vercel logs, and the deterministic alarm
  above is what puts the signal there.
- **`store-strategist` is the weekly trend owner.** Its mandatory Acquisition
  section already tracks "what reached a human" per channel weekly; add a
  Conversion Tracking row (Shopify paid-order count vs. resolved
  `meta_capi_failures`/`ga4_purchase_failures` rows for the week) so a slow
  regression is caught even if the real-time alarm has a bug — this is the
  cadence that would have caught the two-month gap on its own, independent
  of any alarm working correctly.
- **`ads-manager` keeps its existing narrow handoff** ("catalog feed / pixel
  / CAPI issues you notice in diagnostics → suggestion, kind `code`") and
  gains no new tools or scope. It is PROPOSE-ONLY, weekly, and its Meta MCP
  OAuth is unverified — the wrong moment to widen it, and the wrong agent to
  self-certify the health of the pipeline its own ROI math depends on.
- **No new agent.** The fleet evaluation's own verdict was "mostly no,"
  headcount is not the gap, wiring is.

**Traded away:** no agent whose full mandate is conversion-tracking depth
(pixel fire-rate on-page, consent-mode drift, Shopify Markets/catalog-feed
health for Meta Shopping). Acceptable while ad spend is $0; revisit when
`ads_team_enabled` flips to live spend.

**2. The detection gap generalizes, and there is a structural fix, but not a
big one yet.**

`gatherOpsWatch()` in `app/lib/owner-digest.server.ts` is already this exact
pattern: four bespoke, individually try/catch-wrapped SQL checks (social
draft backlog, pricing-recompute miss, enrichment staleness, stranded
verified tickets), each added reactively after an incident. Adding
CAPI/GA4 gap detection as a fifth hand-rolled block would repeat the pattern
the owner is asking to break.

Other confirmed same-shape surfaces (write target, no reconciliation):
`review_invites` (downstream of the same webhook, empty despite a real
fulfilled order; the review-reminders cron is a permanent no-op),
`pricing_changes` (6,586 rows, a stale queue nobody noticed had stopped
draining), and at the workflow layer, non-PR suggestion-bus kinds
(`process`/`strategy`/`program`, 67 approved rows, zero completions ever —
same shape, no DB table).

Given four-to-five confirmed instances and an audit that already named this
exact anti-pattern once without action, generalize now rather than write a
fifth bespoke block: a small declarative invariant list —
`{ name, query, thresholdFn, severity }` — checked by one generic runner,
feeding both the existing digest Ops-watch section (becomes data-driven
instead of hardcoded) and the owner-alerts P0 path. This mirrors what
`program-manager` already does for `docs/store-team/trackers/*.md` (evidence
probes + RAG), just DB-based and on a tighter cadence. Do not build a
heavier registry (UI, admin table) — a `const` array in
`app/lib/ops-invariants.server.ts` is enough for the current count of
surfaces.

**3. The reconciliation design is accepted as a stopgap, with two follow-up
tickets, not as a permanent shape.**

- Riding `/cron/log-monitor` to avoid touching the protected `vercel.json`
  is a reasonable emergency stopgap — the gap has been open two months and
  the code is well-isolated (independent try/catch, its own
  `POST /cron/purchase-reconcile` already exists for a clean one-line
  `vercel.json` addition later) — but it is not acceptable as the permanent
  home. Piggybacking a revenue-critical reconciliation job onto a
  diagnostics job's schedule means the reconciliation goes dark, silently,
  the day someone disables or refactors log-monitor's cron without knowing
  something else rides it — which is the same failure shape as this whole
  incident. File a `kind:code` ticket now, targeted at `vercel.json`, so it
  enters the release engine's protected-path owner-escalation queue instead
  of living as an undocumented rider indefinitely.
- Reusing `meta_capi_failures` as a general outbox is acceptable short-term
  given `db/schema.ts` is a protected path and the code documents the
  semantic shift clearly in both the schema comment and the module header.
  But the name is a real footgun: the next reader (human or agent) building
  a health check against this table will reasonably assume "unresolved row
  = failure" when it also means "legitimately in flight." File a
  `kind:code` follow-up (not blocking this ship) to rename to
  `meta_capi_outbox` / `ga4_purchase_outbox` the next time the owner is
  already touching `db/schema.ts` for an unrelated migration.

## Alternatives considered

- **New `analytics-ops` agent**, sole owner of conversion-tracking health.
  Rejected for now: the detection problem is a boolean DB invariant, not a
  reasoning problem, so a scheduled LLM agent is the wrong tool for the
  primary fix and would add another cloud-routine surface to keep in sync.
  Revisit if/when paid spend goes live and the surface grows (pixel
  fire-rates, catalog feed, consent-mode drift are all reasoning-shaped
  problems a specialist agent would help with).
- **Widen `ads-manager`** with DB/health tools. Rejected: conflict of
  interest (it would certify the health of the signal its own campaign ROI
  claims depend on), wrong cadence (weekly vs. a gap that should alarm in
  under an hour), and its Meta MCP grant is still OAuth-unverified.
- **Build the full invariant-registry abstraction now** (admin UI, DB-backed
  config). Rejected: four-to-five known instances doesn't justify a general
  product; a `const` array + one runner captures the same win at a tenth of
  the effort. Escalate to the heavier version if a sixth instance appears.

## Consequences

- `log-monitor.md` gains one `critical_knowledge` entry; no new tools.
- `store-strategist.md` gains one row in its Acquisition table; no new
  inputs beyond a read the digest gatherer already does.
- `owner-alerts.server.ts` gains one more P0 caller (from the reconcile
  sweep), reusing the existing email+SMS path — must respect the
  alarm-fatigue lesson from finding #13 (only alarm past a real threshold,
  never on the first observed gap).
- A new `app/lib/ops-invariants.server.ts` (or equivalent) generalizes
  `gatherOpsWatch()`'s four existing checks plus the new CAPI/GA4 one into a
  declarative list — additive, does not touch `db/schema.ts`.
- Two tracked follow-ups that must not be forgotten: `vercel.json` entry for
  `/cron/purchase-reconcile` (protected path, owner-escalated), and the
  `meta_capi_failures` → `meta_capi_outbox` rename (protected path,
  owner-escalated).
- Open risk not fully closed by this ADR: the pre-response send in
  `server/webhooks.ts` still has no `waitUntil` primitive backing the
  post-2500ms-timeout continuation — see the accompanying review for a
  scoped follow-up (evaluate `@vercel/functions`' `waitUntil()` inside
  `server/index.ts` only, per the Oxygen migration seam).
