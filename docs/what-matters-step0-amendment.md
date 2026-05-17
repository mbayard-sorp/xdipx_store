# "What Matters" — Step 0 Amendment

**Status:** Follow-up to Co-Work review; ships with the revised migration plan
**Date:** 2026-05-16
**Scope:** Replace step 0 of [what-matters-cowork-review.md](what-matters-cowork-review.md) with the amendment below
**Why:** Instrumentation grep changes the effort estimate from ~2 weeks to ~2 days

---

## Grep findings

**Web — instrumented.** `discovery_chip_toggle` fires today via [app/lib/analytics.client.ts:182](../app/lib/analytics.client.ts) with:

```ts
{
  chip_group: 'mood' | 'audience' | 'matters' | 'category',
  chip_value: string,
  chip_on: boolean,
}
```

Joinable to standard GA4 ecommerce events (`add_to_cart`, `begin_checkout`) by session. Covers three of the four validation questions:

- Selection rate per chip — direct
- Co-selection patterns (Whisper-quiet × Discreet × Travel-ready) — joinable by session
- Conversion lift, chip-filtered vs unfiltered — joinable to ecommerce events

**SMS — not instrumented.** No `sms_gate_advance` event exists. The gate logic at [app/lib/ai-agent/chat.server.ts:259](../app/lib/ai-agent/chat.server.ts) writes a `gate_sessions` row but does not emit an analytics event. SMS skip rate must come from a SQL query against `gate_sessions`, not GA4.

---

## Amended step 0

Replace Co-Work's step 0 (instrument + 30 days of data) with this two-track approach:

### Track A — web (GA4 pull, ~half day)

Pull last 30 days from GA4 for `discovery_chip_toggle`:

1. **Selection rate per chip** — group by `chip_group = 'matters'`, count `chip_on = true` per `chip_value`. Confirms or denies the table-stakes hypothesis (`Body-Safe Silicone`, `Rechargeable`, `Soft-Touch` should be <2% if the audit is right).
2. **Co-selection matrix** — sessions where `Whisper-quiet` was selected, percent that also selected `Discreet` and/or `Travel-ready`. Resolves the "don't draw attention" overlap question. Threshold: >70% overlap → fold per Co-Work's note.
3. **Conversion lift** — sessions with ≥1 matters chip toggled vs sessions without, compare `add_to_cart` rate. Establishes baseline so post-launch comparison is meaningful.

### Track B — SMS (one-off SQL, ~1 hour)

Query `gate_sessions` table for:

1. **Skip rate** — percentage of sessions that selected `Just show me` (or equivalent skip sentinel) at the MATTERS gate. Resolves the 4-vs-5 SMS chip question (Co-Work open Q 5). Threshold: >50% → stay at 4 chips; <50% → expand to 5.
2. **Most-selected MATTERS value via SMS** — informs which 4 SMS chips earn the slots. Validates Option A vs Option B in Co-Work's revised SMS subset section.

If `gate_sessions` doesn't have the granularity to extract chip values (likely — gate state stores slot values, not user click data), Track B becomes "skip rate only" and the SMS subset gets picked from web data instead. Acceptable degradation.

### What this does NOT do

- Does not delay shipping for an SMS instrumentation project. If we want per-chip SMS click data for v2.1 tuning, log a follow-up to add `sms_gate_advance` — but do not block this migration on it.
- Does not validate `Easy to clean` (no historical signal exists — it's a new chip). That tag will be validated post-launch against `discovery_chip_toggle` data.

---

## Revised step 0 timeline

| Task | Effort | Owner |
|---|---|---|
| GA4 pull + chip selection rate analysis | 2 hours | Cowork |
| Co-selection matrix (Whisper × Discreet × Travel) | 1 hour | Cowork |
| Conversion lift baseline | 1 hour | Cowork |
| `gate_sessions` SQL query | 1 hour | Code |
| Decision write-up (keep/fold/swap) | 1 hour | Cowork |

**Total: ~6 hours of work, ~1 business day elapsed.** No new instrumentation required. Migration plan steps 1–9 proceed as Co-Work specified.

---

## Open question now resolved

**Co-Work open Q 5 ("SMS 4 vs 5 visible chips") becomes answerable in step 0** via the `gate_sessions` skip-rate query. Don't carry it forward as an open question — fold it into the step 0 deliverable.

---

## Files touched

None this round — this is planning only. Implementation begins at Co-Work's revised migration plan step 1 after step 0 deliverable lands.

## References

- Web analytics: [app/lib/analytics.client.ts:182](../app/lib/analytics.client.ts)
- SMS gate logic: [app/lib/ai-agent/chat.server.ts:259](../app/lib/ai-agent/chat.server.ts)
- SMS gate definitions: [app/lib/sms-v2/discovery-gate.server.ts](../app/lib/sms-v2/discovery-gate.server.ts)
- Original proposal: [docs/what-matters-proposal.md](what-matters-proposal.md)
- Co-Work review: [docs/what-matters-cowork-review.md](what-matters-cowork-review.md)
