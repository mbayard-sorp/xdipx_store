# "What Matters" Chip Set — Audit & Proposal

**Status:** Proposal for Co-Work review
**Date:** 2026-05-16
**Scope:** Third gate of the home-page "Find you in a product" discovery flow + SMS discovery gate parity
**Related metafield:** `xdipx.matters_tags` (list.text)

---

## Current state

### Web (12 chips) — [app/types/discovery.ts:35](../app/types/discovery.ts)

```
Beginner-Friendly · Body-Safe Silicone · Discreet Design · First-Time ·
Hands-Free · Rechargeable · Soft-Touch · Travel-Size · Waterproof ·
App-Controlled · Whisper-Quiet · Plus-Size-Friendly
```

### SMS gate (5 chips) — [app/lib/sms-v2/discovery-gate.server.ts:84](../app/lib/sms-v2/discovery-gate.server.ts)

```
Beginner-friendly · Quiet · Waterproof · Travel-ready · Just show me
```

The two surfaces have already diverged. They write to and read from the same `xdipx.matters_tags` field, so today one of them is wrong about what values exist on a product.

---

## Audit — what's broken

### 1. Three chips are table stakes, not filters

`Body-Safe Silicone`, `Rechargeable`, and `Soft-Touch` describe ~every quality product in the catalog. Selecting them narrows nothing.

**Effect:** the filter feels broken ("I picked silicone and got 80 results"). These belong in PDP bullet copy, not in a discovery chip set.

### 2. Redundancy

`Beginner-Friendly` and `First-Time` are the same chip with two labels.

### 3. Mixed semantic axes

Material specs (`Silicone`, `Soft-Touch`), capabilities (`Hands-Free`, `App-Controlled`, `Waterproof`), and lifestyle constraints (`Discreet`, `Travel-Size`, `Plus-Size-Friendly`) sit side by side. The user has to mentally sort what kind of question each chip is asking before they can answer it.

### 4. Two chips, one concept

`Hands-Free` and `App-Controlled` are both sub-cases of "remote / position-independent / partner-controlled play."

### 5. Web ↔ SMS drift

Web has 12, SMS has 5, both write to one metafield. SMS already trimmed because 12 didn't survive contact with users.

### 6. Casing inconsistency

`MOODS` and `AUDIENCES` use sentence case ("Slow & Intimate", "Date Night"). `MATTERS` uses Title-Case-With-Hyphens. Pick one.

---

## The filter test

Every chip should pass:

> **"Without this, the product won't work for me."**

If a chip describes a baseline expectation (table stakes) or a nice-to-have, drop it. Discovery chips are constraints, not features.

---

## Proposed set (8 chips, web canonical)

| Chip | Why it earns the slot |
|---|---|
| **Beginner-friendly** | Strongest self-select signal; first-timers say it out loud |
| **Whisper-quiet** | Real constraint — roommates, kids, thin walls |
| **Waterproof** | Distinct intent — shower/bath use case |
| **Travel-ready** | TSA, locking case, discreet packaging — bundled concern |
| **Discreet** | Look + sound + plain packaging; covers gift and roommate use |
| **Hands-free or remote** | Folds in app-controlled; covers couple play and solo positioning |
| **For sensitive bodies** | Low-pressure, ultra-soft, hypoallergenic — inclusive of pressure-sensitive and plus-size |
| **Easy to clean** | New — high-frequency real concern, especially for textured/insertable |

### Dropped (and where they go)

| Dropped chip | Reason | New home |
|---|---|---|
| Body-Safe Silicone | Baseline expectation | PDP bullet / "What it is" copy |
| Rechargeable | Baseline expectation | PDP spec line |
| Soft-Touch | Baseline / subjective | PDP bullet |
| First-Time | Duplicate of Beginner-friendly | Merge |
| Plus-Size-Friendly | Subset of "For sensitive bodies" — but see open question 1 | Folded, or kept (TBD) |
| App-Controlled | Subset of "Hands-free or remote" | Folded |
| Discreet Design | Renamed to `Discreet` (covers look + sound + packaging) | Renamed |

### SMS gate

SMS keeps showing the top 4 + "Just show me", but pulls from the same canonical 8-item list so metafield values stay coherent across surfaces.

**Recommended SMS subset:**

```
Beginner-friendly · Whisper-quiet · Waterproof · Discreet · Just show me
```

---

## Open questions for Co-Work

1. **Plus-Size-Friendly** — keep as a standalone chip for explicit inclusivity signaling, even though it technically folds into "For sensitive bodies"? Brand decision, not a structural one.
2. **Easy to clean** is a net-new tag — backfill across the catalog now, or hold until v2?
3. Lock casing to **sentence-case** (`Whisper-quiet`) to match `MOODS` / `AUDIENCES`?
4. **Migration path** for the three retired chips on already-tagged products — strip silently from `matters_tags`, or surface them as PDP bullet copy first so we don't lose the signal?
5. Does the SMS gate stay at 4 visible chips + skip, or expand to 5? (Currently 4 + skip.)

---

## Migration plan (if approved)

1. Update `MATTERS` in [app/types/discovery.ts](../app/types/discovery.ts) to the new 8-item list.
2. Update `MATTERS_OPTS` in [app/lib/sms-v2/discovery-gate.server.ts](../app/lib/sms-v2/discovery-gate.server.ts) to the SMS subset.
3. Write a backfill script (mirrors the audience-tagging pattern in [docs/audience-tagging-handoff.md](audience-tagging-handoff.md)) that:
   - Reads existing `matters_tags` per product
   - Maps dropped values to their new home (drop, merge, or rename)
   - Adds `Easy to clean` and `For sensitive bodies` where applicable based on product type / category
   - Writes back to `xdipx.matters_tags`
4. Update the enricher brief ([app/lib/enricher-brief.server.ts](../app/lib/enricher-brief.server.ts)) and Emma prompts so new products are tagged against the new vocabulary.
5. Update Ask Emma chat-tools matters_tags references for consistency.

---

## File references

- Web chip definition: [app/types/discovery.ts:35](../app/types/discovery.ts)
- SMS chip definition: [app/lib/sms-v2/discovery-gate.server.ts:84](../app/lib/sms-v2/discovery-gate.server.ts)
- Metafield reads: [app/lib/shopify.server.ts](../app/lib/shopify.server.ts) (search `matters_tags`)
- Scoring weight: [app/lib/discovery-emma.ts:22](../app/lib/discovery-emma.ts) (`SCORE_MATTERS = 2`)
- Pattern to copy for backfill: [docs/audience-tagging-handoff.md](audience-tagging-handoff.md)
