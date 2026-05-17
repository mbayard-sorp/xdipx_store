# Handoff: "What Matters Most" Tagging (Matters Axis)

You're picking up the third and final discovery-surface axis on xdipx.com. Mood shipped. Audience just shipped (v2.3 applied 2026-05-16). Matters is next.

The pipeline is now twice-proven. This handoff points to the canonical templates and the lessons we've learned, then flags what's different about matters.

---

## 1. What you're touching

| Axis | Status | Metafield | Reference |
|---|---|---|---|
| **Mood** | ✅ Shipped (Aug 2025) | `xdipx.mood_tags` + `custom.mood_rationale` | Scripts in `hardcore-lehmann-b14eae` worktree (not on main) |
| **Audience** ("Who it's for") | ✅ Shipped (2026-05-16) | `xdipx.audience_tags` + `custom.audience_rationale` | **You use this as the template** |
| **Matters** ("What matters most") | 🟡 Inherited tags only, no methodology pass | `xdipx.matters_tags` + `custom.matters_rationale` (TBC) | **You ship this** |

Discovery scoring weights: mood 3 · audience 2 · **matters 2**. Three axes intersect to rank products.

---

## 2. Current matters vocabulary in production

As of the May 2026 audit, **37 distinct values** live in `xdipx.matters_tags` across 1,642 active products (5,171 total usages, avg ~3.15 tags/product). Snapshot:

```
953  body-safe-silicone     (58%)
425  vibrating              (26%)
354  warming                (22%)
316  rechargeable           (19%)
246  adjustable-fit         (15%)
241  travel-size            (15%)
220  beginner-friendly      (13%)
206  water-based            (13%)
195  natural                (12%)
190  strap-on-compatible    (12%)
188  hands-free             (11%)
175  realistic              (11%)
145  waterproof             (9%)
140  breathable             (9%)
130  suction                (8%)
112  remote                 (7%)
102  app-controlled         (6%)
 99  edible                 (6%)
 96  whisper-quiet          (6%)
 95  flavored               (6%)
 67  discreet-design        (4%)
 65  plus-size              (4%)
 64  fantasy                (4%)
 63  dual-action            (4%)
 44  wand                   (3%)
 42  thrusting              (3%)
 41  dual-density           (3%)
 28  silicone-based         (2%)
 25  anal-safe              (2%)
 23  vegan-leather          (1%)
 20  rotating               (1%)
 20  hybrid                 (1%)
 17  ejaculating            (1%)
 11  drip                   (1%)
  9  latex-free             (1%)
  3  oil-based              (0%)
  1  soft-touch             (0%)
```

**Healthier starting point than audience was.** No single tag dominates the catalog (top tag is `body-safe-silicone` at 58%, vs audience's `him` at 90%). The vocab is also more semantically coherent — these are mostly product-attribute facts ("this is silicone", "this vibrates", "this is rechargeable"), not interpretive judgments.

But it still needs methodology:

- **No closed enum to enforce.** The discovery types file has 12 enumerated matters values, all unused. Matters is catalog-derived like audience.
- **Mixed semantic types** — material (body-safe-silicone, water-based, vegan-leather), function (vibrating, suction, thrusting), feature (rechargeable, waterproof, app-controlled, hands-free), audience-adjacent (beginner-friendly, plus-size, anal-safe), specialty (warming, edible, flavored). Worth deciding whether to keep mixed or split into sub-axes.
- **Duplicates and near-duplicates** to clean up: `water-based` / `silicone-based` / `oil-based` / `hybrid` (all lube bases — keep all 4 or collapse), `body-safe-silicone` vs `soft-touch` (overlap?), `discreet-design` (4%) vs `whisper-quiet` (6%) (do both serve different uses?).
- **Sparsity-floor candidates** (below 40 per spec §4.2): `silicone-based`, `anal-safe`, `vegan-leather`, `rotating`, `hybrid`, `ejaculating`, `drip`, `latex-free`, `oil-based`, `soft-touch`. All would become content collections, not chips.
- **One-off junk**: `drip`, `soft-touch` at 1 SKU. Drop or merge.

---

## 3. The proven pipeline (mirror audience exactly)

Use the audience scripts as templates — they're now battle-tested through v2.3:

```
scripts/_audience-rules.ts         →  scripts/_matters-rules.ts
scripts/build-audience-briefs.ts   →  scripts/build-matters-briefs.ts
scripts/chunk-audience-briefs.ts   →  scripts/chunk-matters-briefs.ts
scripts/merge-audience-chunks.ts   →  scripts/merge-matters-chunks.ts
scripts/format-audience-csv.ts     →  scripts/format-matters-csv.ts
scripts/apply-audience-to-shopify.ts → scripts/apply-matters-to-shopify.ts
```

Every script is a near-mechanical copy. The only meaningful differences:

1. Metafield names: `xdipx.matters_tags` (already exists) and `custom.matters_rationale` (Mike needs to create — multi-line text).
2. Rule set in `_matters-rules.ts` (the hard work — see §4 below).
3. Subagent prompt template adjusts the classification rubric (see §5).
4. Sparsity-floor verification reads from the matters group (rest of the audit code is generic).

The runbook at [docs/audience-tagging-runbook.md](audience-tagging-runbook.md) is the operational template — same phase structure (build → chunk → dispatch ~29 subagents → merge → format → CSV review → dry-run → apply).

---

## 4. What matters-specific rules look like

Unlike audience (where most rules are derived from Type), matters is split between:

### Deterministic from existing matters_tags

Many matters values are already cleanly tagged from the Nalpac feed import. The bulk of the work is:
- Normalize lowercased + de-duplicated (already handled by `scripts/normalize-discovery-tags.ts` if present)
- Apply cleanup rules (drop `drip` and `soft-touch` 1-SKU junk, collapse `gift-idea`-style duplicates if any)
- Migrate audience-orphaned `first-time` → matters `beginner-friendly` (already done by audience C4)

### Deterministic from product attributes

Likely rule candidates:

| Rule | Condition | Adds |
|---|---|---|
| M1 | `Type ∈ { Wand Massager }` | `matters:wand` |
| M2 | Tag/title contains "rechargeable" OR variant has USB | `matters:rechargeable` |
| M3 | Tag/title contains "waterproof" OR "IPX" | `matters:waterproof` |
| M4 | Type matches lubricant subset AND title contains "water" | `matters:water-based` |
| M5 | Same pattern for silicone-based, oil-based, hybrid lubes | respective tag |
| M6 | Title contains "app" OR "remote" | `matters:app-controlled` / `matters:remote` |
| M7 | Type = Travel Kit OR title contains "travel" | `matters:travel-size` |
| M8 | `Type ∈ { Anal Plug, Anal Beads, Anal Training Kit }` AND material is silicone | `matters:anal-safe` |
| M9 | Title or body contains "plus size" / "queen" / "3X" / "4X" | `matters:plus-size` |
| M10 | Vendor/title contains "vegan" AND material is leather-look | `matters:vegan-leather` |
| M11 | Title contains "warming" / "tingling" / "cooling" | sensation-specific matters |

The deterministic coverage will be higher than audience (~70–80% vs audience's 57%) because product attributes are usually explicit in title/body, where audience required inferring relationship type from context.

### Claude pass (for the rest)

Same dispatch pattern as audience — ~10–20 chunks instead of 29 (smaller needs-Claude bucket). Prompt focuses on subjective matters that aren't material/feature facts:

- `beginner-friendly` (not just "labeled beginner" — does the form factor actually invite first-timers?)
- `discreet-design` (judgment: would this fit a hotel-room nightstand?)
- `hands-free` (some hands-free are obvious by Type, others need Claude on body text)
- `warming` / `cooling` / `flavored` (when not in title)

---

## 5. Co-Work conversation — what to align on first

Bring these to Co-Work **before** writing any rules. The mood + audience pattern (4 cycles, 4 cycles, 4 cycles) was efficient because vocab was locked early.

1. **Keep the 37-value vocab as-is, prune, or collapse?**
   - Drop junk: `drip`, `soft-touch` (1 SKU each)
   - Collapse: `water-based` + `silicone-based` + `oil-based` + `hybrid` into single `lube-base:*` family? Or keep as four chips?
   - Merge: `discreet-design` and `whisper-quiet` overlap — same chip or distinct?
2. **Sub-axes or one flat axis?** Matters today mixes material + function + feature + audience-adjacent + specialty. Co-Work may want to split into:
   - Material (silicone, water-based, vegan-leather, etc.)
   - Feature (rechargeable, waterproof, app-controlled, hands-free)
   - Specialty (warming, flavored, edible)
   - Form-factor (wand, thrusting, suction, dual-action)
3. **Add any net-new vocab?** Candidates: `quiet` (less specific than whisper-quiet), `compact`, `body-friendly`, `latex-free`-specific, `hypoallergenic`, `eco-friendly`, `made-in-USA`.
4. **Sparsity floor consistency.** Same 40-SKU floor as audience? Below-floor matters become content collections (e.g., `/collections/vegan-leather`)?
5. **Representation override applicability.** Probably not — matters is mostly product-attribute, no underrepresented identity argument. Below-floor = collection, no override.
6. **Special case: `plus-size`.** It's a body-inclusivity tag at 4% (65 SKUs, clears floor). Co-Work may want it represented similarly to the audience `non-binary` / `sapphic` identity chips (visually distinguished). Worth deciding now.

---

## 6. Lessons from mood + audience (carry forward, don't re-discover)

1. **Replace > append.** Audience v2 dropped inherited tags that didn't fit; the same applies here. Don't be afraid to drop `drip` and `soft-touch` outright.
2. **Deterministic-first, Claude-second.** ~70% deterministic coverage means fewer subagent chunks and lower variance.
3. **Affirmative-signal-only for any "identity"-adjacent matters** (per audience §3 lesson). `plus-size` should require an explicit signal (title contains "queen size" / "3X+" / explicit body-positive marketing), not auto-fire on every Lingerie product over a certain SKU size.
4. **Subagents on Max subscription only.** Never `@anthropic-ai/sdk` in any script. Dispatch via `Agent` tool with `subagent_type: 'general-purpose'`.
5. **Drafts get tagged too** (per audience §4.1). Both active and draft so promoted drafts are launch-ready. Chip-floor measured on active only.
6. **Spot-check before subagent dispatch.** The audience Q4-marketing-language check caught Co-Work's spec inconsistency before 29 subagents got dispatched. Mirror the pattern: run deterministic, look at the distribution, ask Co-Work for green-light, then chunk + dispatch.
7. **`custom.matters_rationale` should be multi-line text.** Same lesson as audience — stacked rule rationales (e.g., `[M1] type=wand · [M2] rechargeable·title-match · [M3] waterproof·tag-match`) easily exceed 255 chars.
8. **No em-dashes in rationales or Co-Work-facing docs.** Mike's preference.
9. **Verification jq one-liners** like the v2.3 Prowler RED / Q7a / Q7b checks should be drafted into the runbook from the start, not improvised. Catches false positives before applying.
10. **Order of operations matters.** Audience matters: Type cleanup (7a.1) before strip (7b). For matters: any rule that depends on Type composition needs Type to be clean (it is, per audience's 7a.1 pass).

---

## 7. Prerequisite metafield (one-time setup)

Before running the matters pipeline, Mike needs to create one metafield in Shopify Admin:

| Namespace | Key | Type | Scope | Purpose |
|---|---|---|---|---|
| `custom` | `matters_rationale` | Multi-line text | Products | AI / rule rationale for matters tags |

`xdipx.matters_tags` (list.single_line_text_field) already exists.

---

## 8. Estimate

| Phase | Effort |
|---|---|
| Co-Work vocab alignment (sub-axes? collapse? new values?) | ½ day |
| Port pipeline scripts (~near-mechanical copy of audience) | 1–2 hours |
| Write M-rules from spec | 2–4 hours (depends on how many rules) |
| First pipeline run + distribution audit | 1 hour |
| Co-Work CSV review cycle | 1–3 cycles, ½ day per cycle |
| Apply + KV refresh | 30 min |
| **Total** | **~2 days, similar to audience** |

---

## 9. Files to reference

### Production code
- [app/lib/discovery.server.ts](../app/lib/discovery.server.ts) — catalog index, `getDiscoveryFacets`, `getDiscoveryRails`, scoring
- [app/lib/discovery-emma.ts](../app/lib/discovery-emma.ts) — pure scoring + rail title composition
- [app/types/discovery.ts](../app/types/discovery.ts) — type defs
- [app/components/store/AskEmmaRail.tsx](../app/components/store/AskEmmaRail.tsx) — chip rendering (matters chip group)
- [app/routes/admin.discovery.tsx](../app/routes/admin.discovery.tsx) — admin page with chip vocab + cache refresh button

### Audience scripts (template — copy and adapt)
- [scripts/_audience-rules.ts](../scripts/_audience-rules.ts)
- [scripts/build-audience-briefs.ts](../scripts/build-audience-briefs.ts)
- [scripts/chunk-audience-briefs.ts](../scripts/chunk-audience-briefs.ts)
- [scripts/merge-audience-chunks.ts](../scripts/merge-audience-chunks.ts)
- [scripts/format-audience-csv.ts](../scripts/format-audience-csv.ts)
- [scripts/apply-audience-to-shopify.ts](../scripts/apply-audience-to-shopify.ts)

### Operational reference
- [docs/audience-tagging-runbook.md](audience-tagging-runbook.md) — phase commands, subagent prompt, rollback per phase
- [/Users/mikebayard/Documents/xdipx.com/Nalpac Reports/taxonomy/TAXONOMY_SPEC_v2_audience_revision.md](../../../../Documents/xdipx.com/Nalpac%20Reports/taxonomy/TAXONOMY_SPEC_v2_audience_revision.md) — final spec used for audience (read for structure / Co-Work review pattern)

---

## 10. Likely first conversation with Mike

He'll probably say: *"Let's work on what matters most."*

Reasonable first move: run the dump script, share the 37-value distribution, and ask whether the vocab should stay flat or split into sub-axes. The 58% `body-safe-silicone` is the closest thing to a saturation problem (compared to audience's 90% `him`), but it's a legitimate material fact rather than a tagging bug.

From there, the pipeline pattern is identical to audience. Don't re-discover the lessons in §6.
