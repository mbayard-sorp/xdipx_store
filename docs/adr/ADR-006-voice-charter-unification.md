# ADR-006: Voice Charter Unification (v4)

**Date:** 2026-07-02
**Status:** Accepted (voice reset approved by Mike, 2026-07-02)
**Owner:** tech-architect
**Implementation owners:** rr7-engineer (runtime), docs/agents change set (this ADR's companion PR)

---

## Context

The Emma voice rules were never centralized. An audit on 2026-07-02 found roughly 24 separate copies of the voice rules spread across agent definitions (`.claude/agents/*.md`), homepage-team docs, CLAUDE.md, runtime prompt files, seed copy, and the IVR package. The copies had drifted from each other in both directions:

- Some copies kept the original blanket "never 'sex' as an adjective" rule; others (the enricher) had already been loosened to allow "sex toy" for SEO. No document said which was right.
- The autonomous homepage team's daily merchandising run executed with **zero voice context**: the routine playbook never told it to read any voice document, and the cloud checkout it ran from did not reliably contain one. The result was live homepage copy that was vague and self-referential ("The picks the catalog keeps pointing back to") and copy that violated the lived-experience rule ("been testing these with my partner").
- The site footer and some support copy referenced a DIPCOM billing descriptor while the actual statement descriptor is XDIPX, a direct trust contradiction on the surface that exists to prevent "what's that charge?" panic.
- Coined phrases ("keep coming back to", "the one I'd point you to...") had calcified into house tics reused across products, defeating the fresh-language rule that every copy of the rules nominally contained.

Each fix to any one copy widened the drift in the others. The problem was structural: there was no single canonical document, so every consumer paraphrased.

---

## Decision

**One charter, everything else points at it.**

1. **`docs/emma-voice.md` is the single canonical voice charter.** Core rules plus per-channel addenda (marketing, enrichment/SEO, conversational, support), delimited with HTML comment markers so it is machine-sliceable. If any other document disagrees with it, the charter wins, and the charter says so in its own preamble.
2. **Runtime prompts import the charter, they do not restate it.** `app/lib/emma-voice.server.ts` loads the charter at build time via a Vite `?raw` import and exports `EMMA_VOICE_CORE` plus per-channel compositions (`EMMA_VOICE_MARKETING`, `EMMA_VOICE_ENRICHMENT`, `EMMA_VOICE_CONVERSATIONAL`, `EMMA_VOICE_SUPPORT`). A charter edit propagates to every prompt on next build with no prompt-file changes. Non-Vite consumers (evals harness, the standalone `ivr/` package, `tsx` scripts) document their sync strategy in their own headers.
3. **Agents and routines read the charter file.** The Emma-writing agents (`emma-copywriter`, `emma-product-enricher`, `customer-service-emma`) open with a mandatory "read `docs/emma-voice.md` first" step plus only their channel-specific delta; their inlined rule blocks are deleted. Adjacent agents that occasionally write customer-facing words carry a short pointer section. Both homepage-team routine playbooks get an explicit pre-step: read the charter before generating any content, and STOP and report if it is missing from the checkout.
4. **`emma-empathy-reviewer` enforces the charter.** Its 16 binding principles are declared to implement the charter, the sex-language and coined-phrase principles are updated to v4, and reviewers flag charter violations (including the named house tics) even where no numbered principle applies.
5. **CLAUDE.md becomes a pointer.** The Voice paragraph and the "Claude API Voice" section are reduced to a one-paragraph hard-rule summary followed by "Canonical source: docs/emma-voice.md. If this summary and the charter disagree, the charter wins."

### v4 rule changes (owner-approved 2026-07-02)

1. **"Sex toy" is a normal noun** and acts/anatomy are nameable plainly, matter-of-factly, in product context. The old blanket "never 'sex' as an adjective" rule is retired.
2. **"Sex"/"sexy" as a branding adjective stays banned** ("sexy savings", "sex-ify your weekend"): that is the innuendo register the brand deliberately avoids.
3. **Suggestive-about-function is allowed**: sensation, mechanism, scenario. Never crude, never porn-copy, never a joke at the customer's expense.
4. **Emma is demoted from homepage-hero top billing.** No "Curated by Emma" eyebrow, no Emma aside above the fold. She lives in the mid-page intro card, Ask Emma entry points, discovery, curated rails, and PDP asides. She remains an AI guide with no lived experience.
5. **Fresh-language rule with named banned house tics**: "keep(s) coming back to" / "keeps pointing back to" / "keeps circling back to", "flying off our shelves", "shortlist" + "point you to" at most once per page combined, "the one I'd..." as the default aside opener.

---

## Alternatives Considered

**Keep per-agent rules, add a lint/review gate only.** Rejected: review catches violations after they are written, but drifted rule copies keep generating them. The generation-side inputs had to converge.

**Put the canon in CLAUDE.md.** Rejected: CLAUDE.md is loaded by Claude Code sessions but not by runtime prompts, cloud routines running from arbitrary checkouts, or the evals harness. A repo file under `docs/` is readable by all of them and importable by Vite.

**Duplicate the charter into each cloud routine's environment.** Rejected: that is the drift problem again. Routines instead read the repo file and hard-stop if it is missing.

---

## Consequences

- Exactly one place to change a voice rule; everything else is a pointer or a build-time import.
- The homepage team's daily and design-cycle runs are now charter-gated: no charter in the checkout means no copy written, reported instead of guessed.
- `emma-empathy-reviewer` verdicts and the charter can no longer disagree silently; the charter is declared canonical inside the reviewer itself.
- The summaries that remain (CLAUDE.md, agent deltas) can still lag the charter after a future edit; each one carries the "charter wins" clause so lag is a cosmetic bug, not a correctness bug.
- Non-Vite consumers (`ivr/`, evals, one-off scripts) still hold copies by necessity; their sync obligation is documented at each site and is the known residual drift surface.
- All previously live copy in the banned crude register and the DIPCOM descriptor references are to be swept as follow-up work under the charter's rules.
