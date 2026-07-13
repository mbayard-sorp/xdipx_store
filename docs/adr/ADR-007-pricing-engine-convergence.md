# ADR-007: Pricing Engine Convergence (contain now, converge later)

**Date:** 2026-07-13
**Status:** Accepted (owner chose "contain now" during the product-management bridge review)
**Owner:** tech-architect
**Implementation owners:** rr7-engineer (containment + the WS3 cost-sync path), pricing-ops (operational)

> Numbering note: the `docs/adr/` directory has a pre-existing collision — two files are named
> `ADR-001-*.md` (`ADR-001-engineering-feasibility.md`, `ADR-001-phase-0-memory-primitives.md`). This
> ADR takes 007 (the next free number after `ADR-006-voice-charter-unification.md`); the 001 collision
> is out of scope here.

---

## Context

The store runs **two pricing engines** against the same catalog, discovered during the
product-management bridge review (2026-07-13):

- **v1 (legacy):** `pricing-engine.server.ts` + `pricing-apply.server.ts` (`decideAndApply`). Used by
  the Nalpac cost-change webhook. Writes to the `pricing_changes` table. Uses a static tiered-discount
  model (`MARGIN_FLOOR=0.20`, hardcoded discount tiers) and **only enforces MAP for a hardcoded
  2-vendor allowlist** (`MAP_RESTRICTED_VENDORS = ['Lovense','Playground']`); every other vendor's
  computed price never checks the real MAP, and `mapRespected` is hardcoded `true` for those tiers.
- **v2 (current):** `pricing-engine-v2.server.ts` + `pricing-apply-v2.server.ts` (`recomputeCatalog` /
  `recomputeVariant`). Used by the daily batch recompute. Writes to `pricing_audit_log`. Config-driven
  per product-type group, with a universal MAP gate in `decideStatus` (`newPrice < map → rejected`).

Three coupled problems make v1 hazardous:

1. **Shared, incompatible setting.** Both engines read `pipeline_settings.pricing_approval_mode`, but
   with **different enums**: v1 expects `'all' | 'guardrails' | 'auto'` (unknown → defaults `'all'` =
   pending-only); v2 expects `'aggressive' | 'balanced' | 'conservative' | 'review_all'` (unknown →
   `'balanced'`). The only admin UI (`api.pricing.settings.tsx`) writes **only** v2 values — so v1 is
   dormant **by luck, not design**. Any script/SQL/UI that ever writes `'auto'` or `'guardrails'`
   silently wakes v1 into auto-applying prices with its weak MAP protection.
2. **Invisible queue.** v1's pending rows land in `pricing_changes`, which `/admin/pricing` never reads
   (it queries only `pricing_audit_log`). Anything routed through v1 today either auto-applies (weak
   MAP) or vanishes into an unmonitored table.
3. **The price-drop loop (WS3) must write cost-driven repricing.** Routing it through v1
   (`processNalpacCostChanges` → `decideAndApply`) would inherit all of the above.

The prior audit already flagged this (`docs/agent-automation-audit-2026-07.md`: "Two pricing stacks…
converge on v2 before drift causes a MAP incident"); `pricing-apply-v2.server.ts` itself says it
"coexists with pricing-apply.server.ts (legacy) until cutover." Convergence keeps being deferred.

---

## Decision

**Contain now, converge on v2 later.**

1. **The WS3 price-drop / cost-sync loop uses the v2 engine only.** The daily feed-diff detects a
   material Nalpac wholesale/MAP drop on a carried SKU, writes the fresh `wholesale_cost` / `map_price`
   metafields to Shopify, then calls **`recomputeVariant({ variantId, trigger: 'webhook' })`** per SKU
   so the resulting audit row lands in `pricing_audit_log` (the monitored table). It does **not** call
   `processNalpacCostChanges` / `decideAndApply` (v1). A dedicated kill switch
   **`pricing_costsync_enabled`** (default off) gates the new trigger — not the pre-existing
   `pricing_webhook_enabled` (which means "is the external Nalpac webhook on"). Day-scoped idempotency
   comes from a `synced_at` marker on the price-history row, not v1's 60s/30s KV throttles.
2. **v1 stays dormant, explicitly.** Do not set `pricing_approval_mode` to `'auto'` or `'guardrails'`;
   the admin UI's 4-value vocabulary is the only supported writer. This is now written down (here) so a
   future edit doesn't accidentally arm v1.
3. **`map_restricted` becomes a real gate in v2.** v2 fetches `xdipx.map_restricted` but drops it. Use
   it as a hard `rejected`/`pending` floor when `map_restricted = true` and `map_price` is missing
   (mirroring `gmc-metafields.server.ts`'s `mapAllowsAdvertisedDiscount`), or remove the dead fetch.
4. **Full convergence is a tracked, dated follow-up** (owner-approved to defer, not drop): fold v1's
   static tiers into v2's configurable groups, delete v1's direct-apply path, repoint the real Nalpac
   cost-change webhook at `recomputeVariant`, and retire `pricing_changes` (or migrate its rows into
   `pricing_audit_log`) so there is one engine, one audit table, one approval-mode vocabulary, one
   admin surface. Tracked in `docs/store-team/trackers/automation-audit-roadmap.md`.

---

## Alternatives considered

- **Full convergence before shipping WS3.** Cleanest end-state, but a materially larger refactor
  (engine merge + webhook repoint + table retirement + admin UI) that delays the price-drop revenue
  value the owner is chasing. Rejected for now; retained as the tracked follow-up (decision 4).
- **Route WS3 through v1 as-is.** Rejected: inherits the weak MAP coverage, the broken approval-mode
  enum, and the invisible `pricing_changes` queue.
- **Metafield-write-only from WS3, rely on the nightly batch.** A leaner containment (write cost, let
  the 07:00 batch reprice next day). Rejected as the primary path because a 23h wait through a queue
  nobody watches is worse than a targeted `recomputeVariant`; the nightly batch remains a backstop.

---

## Consequences

- **Positive:** cost drops reprice through the engine that actually enforces MAP and is actually
  monitored; the v1 hazard is documented and fenced; WS3 ships without blocking on the big refactor.
- **Negative / residual risk:** two engines still coexist until the follow-up lands. The mitigations
  are decisions 2–3 (keep v1 dormant, harden v2's MAP) plus the merchandising-side guard: any
  price-drop SKU proposed for an auto-publishing homepage/email surface must pass a live-price MAP
  check (`mapAllowsAdvertisedDiscount`) before it is eligible (WS3c). Until convergence, a MAP incident
  is possible only if someone arms v1 by hand — which this ADR exists to prevent.
