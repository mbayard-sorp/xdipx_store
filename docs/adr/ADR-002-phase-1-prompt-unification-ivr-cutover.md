# ADR-002: Phase 1 — Prompt Unification + IVR Cutover

**Date:** 2026-05-04
**Status:** Implemented by PR #100 (`dcb3707`, 2026-05-07)
**Owner:** tech-architect
**Implementation owners:** rr7-engineer (Vercel side), ivr-ops (Fly side)
**Empathy review required:** Yes — entire new prompt module, voice channel adapter strings, any new IVR fallback strings
**Gate dependency:** Phase 0 must be live and soaking for at least 7 days before Phase 1 implementation begins

---

## Implementation notes

This ADR was proposed 2026-05-04 and **implemented by PR #100** (`dcb3707 Emma v2: SMS engine cutover + cross-channel state, Phases 7–10`, squash-merged 2026-05-07).

Key landing points in current `main`:

- **Prompt unification:** the Vercel + Fly prompt drift described in this ADR no longer exists. The single canonical prompt now lives in `app/lib/sms-v2/conversation-agent.server.ts` (948 lines, unified across SMS/IVR/web channels).
- **IVR cutover:** the Fly v1 agent loop in `ivr/src/claude.ts` was retired. IVR traffic now routes through the Vercel v2 engine via the same dispatcher used by SMS and web chat. The `app/lib/sms-v2/adapters/voice.server.ts` adapter (485 lines in main) handles voice-channel rendering.
- **Channel-aware behavior:** per-channel rules now live in `app/lib/sms-v2/sms-config.server.ts` and the conversation-agent's channel-tuning blocks rather than two separately maintained prompt files.

Document retained as a historical record of the architectural decision and reasoning.

## Context

### What is broken today

**Problem 1 — Two prompt files, one "keep in sync manually" comment that has rotted.**

`app/lib/ai-agent/prompt.ts:1-6` carries an explicit comment acknowledging the drift:
> "The IVR loads this via its own copy in ivr/src/prompts.ts (Fly can't import RR-side files); keep the two in sync manually."

The Fly-side prompt at `ivr/src/prompts.ts` is architecturally different from the Vercel-side. The Vercel prompt is a flat string export (`BRAND_VOICE`) concatenated with a channel addendum. The Fly prompt is a function (`buildSystemPrompt(brandVoice, collections, goodbye)`) that composes `IDENTITY_HEADER + brandVoice + CHANNEL_RULES`. The two share the brand identity sentence but the SPIN sales methodology, voice rules, compliance rules, and product-discovery rules have diverged organically. There is no CI check that catches further drift.

**Problem 2 — IVR is still running the Fly v1 agent loop.**

`ivr/src/claude.ts` is the live production path for voice today. It calls Haiku (`claude-haiku-4-5-20251001`), not Sonnet. It runs its own tool loop (MAX_TOOL_HOPS = 20, much higher than the SMS v2 agent's 3-hop budget). It has its own send-intent detection regex, its own forced-tool-use retry, and its own barge-in/AbortController pattern. None of Phase 0's memory improvements (rolling summary, slot injection, softened stage TTL, tool-result pitched-handle detection) reach callers until the IVR traffic is cut to the v2 engine.

`app/lib/sms-v2/ivr-pipeline-flag.server.ts:54` defaults to `'v1'` explicitly. The comment says "Phase 9 does NOT flip the IVR default — that is a Phase 10 / operations decision." Phase 1 is that operations decision.

**Problem 3 — SMS_MODE is 96 lines of reactive patches; CHAT_MODE is 58 lines.**

`app/lib/ai-agent/prompt.ts:23-118` (SMS_MODE) and lines 121-179 (CHAT_MODE) are not architected sections — they are accumulated patches, each added after an observed failure mode. Many rules exist only because there was no eval harness to prove they weren't needed. The eval harness now exists (Phase 0). Phase 1 is the first moment we can delete rules with confidence.

**Problem 4 — Phase 0's memory improvements are not fully exploited by the prompt module.**

The two-block cache structure (`conversation-agent.server.ts:566-576`) separates stable rules (Block 1, cache_control) from dynamic `<known_about_customer>` context (Block 2, no cache_control). Phase 0 implemented this correctly. But the stable block (Block 1) is still constructed by concatenating the flat strings from `app/lib/ai-agent/prompt.ts` at call time. There is no typed structure that enforces which sections belong in Block 1 (stable, cacheable) vs. Block 2 (per-turn dynamic). Phase 1 formalizes this.

**Problem 5 — The 13 binding principles exist as prose in `.claude/agents/emma-empathy-reviewer.md` but are not codified as data.**

The eval harness introduced in Phase 0 seeds the judge prompt with the principles, but it does so by including a prose description. The principles are not addressable by ID, not versioned separately from the agent file, and not machine-readable in a way that lets the eval target "did this reply violate principle 3?" directly.

---

## Decision

### Sub-decision 1: Single prompt source of truth — Strategy (c): Build-time generation with SHA assertion in CI

**Chosen strategy: (c).**

The three options from the plan:
- **(a) Move IVR into the same monorepo.** Best long-term. `ivr/package.json` is a standalone Node package with its own `tsconfig.json`, `Dockerfile`, and `fly.toml`. The `package.json` at the repo root has no `workspaces` field — IVR is not a workspace today. Merging it would require adding workspace tooling, updating the root TypeScript project references, modifying the Fly deploy pipeline to build from a monorepo root, and resolving the `@react-router/express` imports that `app/` uses but `ivr/src/` must not import. This is the right long-term state but is not a prerequisite for Phase 1 correctness. It is a separate effort.
- **(b) Publish `@xdipx/voice-prompt` npm package.** Introduces a release cycle: every prompt edit requires a version bump, an `npm publish`, and an `npm install` in both repos. For a string we expect to edit frequently, this is operational friction that will cause drift again through laziness. Rejected.
- **(c) Build-time generation + CI SHA assertion.** The canonical source stays in `app/lib/ai-agent/voice.ts` (new file, see Sub-decision 3). A build script generates `ivr/src/generated/brand-voice.ts` from the canonical source, including a SHA-256 hash of the canonical content embedded as a comment. CI runs the generator and asserts the committed `ivr/src/generated/brand-voice.ts` SHA matches the canonical source. If they diverge, the build fails. This is the fastest path to zero-drift without structural repo changes.

**Rationale over (a):** (a) is architecturally superior but is a multi-day infrastructure task that should be a named Phase 5 cleanup item, not a prerequisite for cutting IVR to v2. Prompt drift is the risk being mitigated; strategy (c) mitigates it fully with a single CI check.

**Rationale over (b):** (b) imposes more ongoing discipline than (c) while providing less safety. The SHA assertion is automatic; a version bump is manual.

**What the assertion looks like in CI:**

```bash
# scripts/assert-ivr-prompt-sync.ts
# Regenerate ivr/src/generated/brand-voice.ts from canonical source.
# Exit 1 if the result differs from the committed file.
npx tsx scripts/generate-ivr-prompt.ts
git diff --exit-code ivr/src/generated/brand-voice.ts
```

The check runs in `.github/workflows/ci.yml` (or equivalent) on every PR that touches `app/lib/ai-agent/voice.ts` or `ivr/src/generated/brand-voice.ts`. The generator is the only file with write access to the generated output.

**Migration note for the Fly side:**

`ivr/src/prompts.ts` currently exports `buildSystemPrompt(brandVoice, collections, goodbye)`. After Phase 1:
- `ivr/src/prompts.ts` is refactored to import `BRAND_VOICE` and `CHANNEL_ADDENDA.voice` from `ivr/src/generated/brand-voice.ts`.
- The `buildSystemPrompt` function is retained as an assembly shim (it still needs to inject `collections` and `goodbye` at runtime), but the prose it assembles comes from the generated file, not from `DEFAULT_BRAND_VOICE` in `ivr/src/settings.ts`.
- `ivr/src/settings.ts`'s `DEFAULT_BRAND_VOICE` constant is deprecated and replaced by the generated import.

This is `ivr-ops`'s task on the Fly side.

---

### Sub-decision 2: IVR cutover — phased with canary allowlist, 7-day soak, then global flip

**Phase plan:**

**Stage A — Dark-launch canary (days 1-3 of implementation week):**
Add your own phone number(s) and one or two test lines to `IVR_V2_PHONES`. The `pickIvrPipelineVersion` function in `app/lib/sms-v2/ivr-pipeline-flag.server.ts:69` already supports this allowlist. No changes to the flag module needed. Confirm v2 voice calls work end-to-end: intent classification, stage dispatch, SSML generation, outbound SMS for PDP links, checkout link delivery.

**Stage B — Global flip (after canary passes):**
Set `IVR_PIPELINE_VERSION=v2` in Vercel environment (production + preview). The comment at `ivr-pipeline-flag.server.ts:54` explicitly documents this as the Phase 1 / operations decision.

**Stage C — 7-day soak:**
After global flip, keep the Fly v1 code path intact and `IVR_PIPELINE_VERSION` documented. `log-monitor` watches `smsTurns` where `channel='voice'` for: error rate, intent classification failures, tool-budget-exhausted flags, latency outliers (>5s). You gate runs during this window: call the number, verify Emma sounds like Emma, verify the PDP link texting flow works, verify checkout links deliver.

**Stage D — v1 code removal (Phase 5):**
After the soak bakes, `ivr/src/claude.ts`, `ivr/src/v2-bridge.ts`, and `ivr/src/settings.ts` (`DEFAULT_BRAND_VOICE`) are deletion candidates. This is a Phase 5 item, not Phase 1. Do not delete them during Phase 1.

**Rollback criteria:**
If at any point during Stage C, any of the following occur, immediately revert to `IVR_PIPELINE_VERSION=v1`:
- Error rate on `channel='voice'` turns exceeds 5% (baseline from v1 logs).
- Three or more caller complaints about voice quality within 48h.
- SSML-to-speech failures (Twilio ConversationRelay drops to fallback TwiML).
- `tool_budget_exhausted` rate on voice turns exceeds 10% of calls.

Revert procedure: set `IVR_PIPELINE_VERSION=v1` in Vercel env, redeploy. Rollback is a 2-minute operation. No code changes needed because v1 code path is preserved through Stage C.

**After soak (Stage D entry gate):**
v1 code can be deleted only after: 7-day soak passes, you-gate confirms voice quality, log-monitor shows no regressions. The deletion list is a Phase 5 ADR item.

---

### Sub-decision 3: Prompt module structure — new `app/lib/ai-agent/voice.ts`

**Rename and restructure, do not edit in place.**

The current `app/lib/ai-agent/prompt.ts` is the load-bearing module. Editing it in-place during a refactor risks breaking its importers mid-flight. The correct approach: create a new file, migrate importers, then delete the old file in a single PR.

New file: `app/lib/ai-agent/voice.ts`

Typed exports:

```ts
// Stable section — goes into Block 1 (cache_control: ephemeral)
export const BRAND_VOICE: string           // ~20 lines: identity + SPIN + voice rules
export const CONVERSATION_RULES_CORE: string // principles baked into prose, no em-dashes
export const CHANNEL_ADDENDA: {
  sms:   string   // SMS-specific rules, target <40 lines post-compression
  voice: string   // IVR-specific rules, mirrors CHANNEL_RULES from ivr/src/prompts.ts
  web:   string   // CHAT-specific rules, target <40 lines post-compression
}

// Optional: structured principles (see Sub-decision 6)
export const PRINCIPLES?: PrincipleRecord[]

// Convenience assemblers
export function buildSmsSystemPrompt(): string    // BRAND_VOICE + sms addendum
export function buildVoiceSystemPrompt(opts: { collections?: string[], goodbye?: string }): string
export function buildWebSystemPrompt(): string
```

**What does NOT change:** the two-block structure in `conversation-agent.server.ts`. Block 1 (stable, cached) receives `BRAND_VOICE + CONVERSATION_RULES_CORE + stageAddendum + channelAddendum`. Block 2 (dynamic, no cache) receives the `<known_about_customer>` block. This split was established in Phase 0 Task 0.5 and must be preserved. Any refactor that flattens the two blocks back into one undoes the cache hit economics established in Phase 0.

**Importers to update after the new file is ready:**
- `app/lib/sms-v2/conversation-agent.server.ts` (currently imports `BRAND_VOICE` from `prompt.ts`)
- `app/routes/api.generate-copy.tsx` (if it imports from `prompt.ts` — verify)
- `app/routes/api.twilio.sms.tsx` (verify)
- Any other file under `app/` that imports from `app/lib/ai-agent/prompt.ts`

The old `app/lib/ai-agent/prompt.ts` is deleted only after all importers are updated and typechecks pass. `rr7-engineer` owns this migration.

**The Fly-side generated file:**

`ivr/src/generated/brand-voice.ts` is machine-generated by `scripts/generate-ivr-prompt.ts`. It exports the subset of `voice.ts` that the Fly runtime needs:
- `BRAND_VOICE` (same string)
- `CHANNEL_ADDENDA.voice` (the IVR addendum)

It does NOT export `sms` or `web` addenda. It does NOT import from `app/`. It is a self-contained generated module.

---

### Sub-decision 4: SMS_MODE / CHAT_MODE compression — eval-driven deletion

**Method, not a list.**

The Phase 0 eval harness runs 30 golden conversations against the current prompt. Any rule in `SMS_MODE` or `CHAT_MODE` was added because some behavior was observed in production. The question for each rule is: does removing it cause any of the 30 goldens to regress?

Procedure for `rr7-engineer`:

1. Check out the Phase 1 prompt-refactor branch.
2. For each identifiable rule block in `SMS_MODE` (there are approximately 8 distinct rule sections between lines 23-118), create a test variant that removes that block.
3. Run `npm run eval:emma` against the variant. If no golden scores below 3, the rule is a deletion candidate. If any golden regresses, the rule stays.
4. Document deletions with a comment: `// removed: eval-confirmed not needed, NNNN-rule-name, 2026-05-xx`.
5. Target: SMS addendum under 40 lines, CHAT addendum under 40 lines. These are targets, not hard caps. If the eval requires keeping more, keep it.

**What is likely safe to compress:**

Rules that duplicate the model's default behavior (e.g., "do not markdown in SMS" — Sonnet 4 is already markdown-conservative in terse contexts), rules that are now enforced by memory injection (e.g., repetition guards that exist because the agent forgot prior turns — Phase 0's slot injection makes some of these redundant), and rules that were added as patches for a specific observed failure but whose regression is now covered by a golden fixture.

**What must stay:**

The commit flow rules (TURN A, TURN B, BUNDLE COMMIT in SMS_MODE) are complex and load-bearing — they encode exact tool sequences. Do not delete these without a dedicated golden fixture for each branch. The URL-on-its-own-line rule (iMessage preview) has its own golden fixture (020-url-format-sms-own-line.json). Keep it.

**Target line counts post-compression:**

| Section | Current | Target |
|---|---|---|
| BRAND_VOICE | ~15 lines | ~15 lines (unchanged) |
| SMS_MODE | 96 lines | <40 lines |
| CHAT_MODE | 58 lines | <40 lines |
| VOICE addendum (new) | 65 lines (CHANNEL_RULES) | ~40 lines |

---

### Sub-decision 5: CI eval gate — required check on every prompt PR

**Already prototyped in Phase 0. Phase 1 makes it required.**

Add a GitHub Actions workflow (or equivalent CI trigger) that runs `npm run eval:emma` on every PR that touches:
- `app/lib/ai-agent/voice.ts` (new file)
- `app/lib/ai-agent/prompt.ts` (during migration; delete after)
- `app/lib/sms-v2/conversation-agent.server.ts`
- `app/lib/sms-v2/**` (any file)
- `ivr/src/generated/brand-voice.ts`

The workflow requires `ANTHROPIC_API_KEY` as a CI secret. The eval runner uses real Anthropic API calls (Sonnet as judge); this costs approximately $0.03 per run at 30 fixtures. Acceptable.

The check is required — PRs that touch the above paths cannot merge with a failing eval. The SHA assertion check (`assert-ivr-prompt-sync.ts`) also runs as a required check on every PR touching either the canonical source or the generated Fly file.

**Exit codes:**
- `npm run eval:emma` exits 1 if any fixture scores below 3 on any dimension. This is already the spec from ADR-001.
- `scripts/assert-ivr-prompt-sync.ts` exits 1 if the generated file and canonical source are out of sync.

---

### Sub-decision 6: Empathy reviewer scope expansion — RECOMMENDED, not required

**Recommendation: expand the reviewer's scope to all system-prompt strings in Phase 1.**

The `.claude/agents/emma-empathy-reviewer.md` currently lists its scope as template banks (`app/lib/sms-v2/templates/`) and `app/lib/ai-agent/prompt.ts`. The 13 principles are framed as applying to "every templated string."

Phase 1 is the first time the full prompt module is being deliberately refactored as a unit. It is the right moment to apply the reviewer to:
- `BRAND_VOICE` (the identity and SPIN methodology prose)
- `CONVERSATION_RULES_CORE` (if it becomes a distinct named export)
- `CHANNEL_ADDENDA.voice` (the IVR rules — never reviewed before)
- `CHANNEL_ADDENDA.sms` (the SMS addendum post-compression)
- `CHANNEL_ADDENDA.web` (the web addendum post-compression)

**The em-dash issue:** the Phase 0 empathy review found approximately 10 em-dashes in `CONVERSATION_RULES_CORE` rule prose. They were allowed because Principle 12 was being applied to Emma-voice strings (strings the model generates) rather than instructional rule prose (strings the developer writes to direct the model). Phase 1 is the moment to decide: does Principle 12 apply to all strings in the system prompt, or only to the generated output?

**Architect's recommendation:** apply Principle 12 to all strings in the system prompt. The model reads em-dashes in instructional prose and may produce em-dashes in output as a result. The cost of removing them from rule prose is zero; the risk of keeping them is subtle voice drift. Remove them from all system-prompt strings in the Phase 1 refactor.

This is a judgment call for the user, not a technical constraint. Flag it to `emma-empathy-reviewer` explicitly when submitting the new prompt module for review.

**Optional: codify principles as data.**

The 13 principles currently live as prose in `.claude/agents/emma-empathy-reviewer.md`. Making them a typed array in `voice.ts`:

```ts
export const PRINCIPLES: Array<{
  id: number
  name: string
  prose: string
}> = [...]
```

...would let the eval harness address them programmatically (`evalDimensions: ['principle-3', 'principle-7']`), enable admin-side display, and version the principles alongside the prompt. This is optional for Phase 1. If included, `rr7-engineer` creates the array; `emma-empathy-reviewer` approves the prose before it ships.

---

## Consequences

### What gets better

- Prompt drift between IVR and SMS is eliminated permanently. The SHA assertion in CI makes it impossible to ship a prompt change to one side without the other.
- All three channels (SMS, voice, IVR) benefit from Phase 0's memory improvements the moment `IVR_PIPELINE_VERSION=v2` is set.
- SMS_MODE and CHAT_MODE shrink. Smaller prompts mean faster token processing and fewer conflicting rules.
- The Phase 0 eval harness becomes a required gate, not an optional tool. Prompt regressions are caught at PR time.
- `ivr/src/claude.ts`, `ivr/src/v2-bridge.ts` become deletion candidates after the soak. Phase 5 ships a smaller codebase.

### Costs

**Strategy (c) vs (a):** The SHA assertion approach preserves the Fly/Vercel repo split, which means two deploy pipelines to coordinate on future IVR changes. This is the known cost of not merging the repos. The build-time generator adds one new script (`generate-ivr-prompt.ts`) and one CI step.

**IVR cutover risk is real.** Voice quality regression during the 7-day soak is customer-facing. The fallback path (`IVR_PIPELINE_VERSION=v1`) mitigates it, but if the v2 engine has a latency spike (cold-start Vercel function on an inbound call), the caller may hear silence before the greeting. The Fly bridge's hard timeout (`HARD_TIMEOUT_MS = 5_000` in `v2-bridge.ts:29`) provides the circuit-breaker, but a 5-second pause on a phone call is poor UX.

**Prompt compression risk.** Deleting rules that "pass the eval" is only as safe as the eval's coverage. If a rule protects against a failure mode not covered by any of the 30 goldens, deleting it restores that failure mode. Mitigation: before deleting any rule, add a golden fixture that specifically tests the behavior the rule was added to prevent.

**CI eval cost.** At ~$0.03 per run with a required check, a team generating 30 PRs/week touching prompt files incurs ~$0.90/week in eval API costs. Negligible.

---

## Alternatives Considered

### For Sub-decision 1 (import problem)

**(a) Monorepo merge:** architecturally cleanest. Rejected for Phase 1 because it is a multi-day infrastructure task orthogonal to the prompt-drift fix. Moved to Phase 5 scope as a named candidate.

**(b) npm package:** rejected because version-bump friction is the failure mode that produced the drift in the first place. A package requires intentional release discipline; a CI assertion is automatic.

**(c) Build-time generation:** chosen. Fast, safe, no new release infrastructure.

### For Sub-decision 2 (IVR cutover)

**Hard cutover on day 1:** rejected. Voice is customer-facing and there is no precedent for the v2 voice path handling real call volume. The canary allowlist exists for exactly this. Use it.

**Canary only, no global flip:** rejected. The goal is full v2 traffic. Canary is a gate, not the destination.

### For Sub-decision 3 (prompt module)

**Edit `prompt.ts` in place:** rejected. Load-bearing file. Edit in a new file, migrate importers, delete the old file. Single destructive commit.

**Separate files per channel:** considered (`sms-prompt.ts`, `voice-prompt.ts`, `web-prompt.ts`). Rejected because it recreates the drift problem — three separate files can diverge. A single `voice.ts` with `CHANNEL_ADDENDA` as an object keeps the shared sections explicitly colocated with the per-channel sections.

### For Sub-decision 6 (principles as data)

**Keep principles as agent prose only:** acceptable. The eval harness can still target them by name in the judge prompt. The structured array is a quality-of-life improvement, not a correctness requirement. Made optional.

---

## Migration Notes

### If Strategy (c) is confirmed

New files:
- `app/lib/ai-agent/voice.ts` — canonical prompt module (replaces `prompt.ts`)
- `scripts/generate-ivr-prompt.ts` — reads `voice.ts`, writes `ivr/src/generated/brand-voice.ts`
- `scripts/assert-ivr-prompt-sync.ts` — regenerates and diffs, exits 1 on mismatch
- `ivr/src/generated/brand-voice.ts` — generated, committed, not hand-edited (add a `// @generated` header)
- `ivr/src/generated/.gitignore-note` — or a comment in the file reminding contributors it is generated

Modified files:
- `ivr/src/prompts.ts` — import `BRAND_VOICE` and `CHANNEL_ADDENDA.voice` from `./generated/brand-voice`; retain `buildSystemPrompt` as an assembly shim; deprecate `DEFAULT_BRAND_VOICE` in `settings.ts`
- `ivr/src/claude.ts` — no changes in Phase 1 (preserved for rollback)
- `app/lib/sms-v2/conversation-agent.server.ts` — update import from `prompt.ts` to `voice.ts`
- `app/lib/sms-v2/ivr-pipeline-flag.server.ts` — no changes needed; the module already supports `IVR_PIPELINE_VERSION=v2`
- All other `app/` importers of `prompt.ts`

Deleted files (Phase 1, after migration is confirmed):
- `app/lib/ai-agent/prompt.ts` — only after all importers point to `voice.ts` and typecheck passes

Deleted files (Phase 5, after 7-day soak):
- `ivr/src/claude.ts`
- `ivr/src/v2-bridge.ts`

### CI workflow addition

`.github/workflows/prompt-sync.yml` (or equivalent):

```yaml
name: Prompt sync assertion
on:
  pull_request:
    paths:
      - 'app/lib/ai-agent/voice.ts'
      - 'ivr/src/generated/brand-voice.ts'

jobs:
  assert-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npx tsx scripts/assert-ivr-prompt-sync.ts
```

The eval harness CI check is a separate workflow (already scoped in Phase 0 ADR-001; Phase 1 makes it required).

---

## Oxygen-Seam Impact

**No violation of the Oxygen migration seam.**

Voice traffic after the cutover flows: Twilio → Fly WebSocket → Vercel `/api/emma-engine/turn` → `processVoiceMessageV2` (in `app/lib/sms-v2/adapters/voice.server.ts`) → `conversation-agent.server.ts`. All of this is inside `app/lib/sms-v2/`, which is already the correct location for RR-side conversation logic.

CLAUDE.md states: "Keep all Vercel-specific code in `server/index.ts` — never import `@vercel/kv` or similar inside `app/`." The voice adapter imports nothing Vercel-specific. It imports from `app/lib/db.server.ts`, `app/lib/twilio.server`, and the sms-v2 module — all clean.

The `app/lib/ai-agent/voice.ts` file will not import from `@vercel/kv`, `server/`, or any other Vercel-specific dependency. It is a pure TypeScript module with string exports and assembler functions.

The Fly server (`ivr/`) reads from the generated file and does not import from `app/` at runtime. The build-time generation runs in the developer's environment (or CI), not at Fly runtime.

**Oxygen migration implications:** When migrating to Shopify Oxygen, the seam is `app/lib/shopify.server.ts` (single swap point). The prompt module (`voice.ts`) has no Shopify dependency. The voice adapter (`adapters/voice.server.ts`) will need its Twilio SMS send calls (`sendSms`) rerouted, but that is a Phase N+1 concern. No new seam violations are introduced.

---

## Coupling Analysis

**What reads from `ivr/src/prompts.ts` today:**
- `ivr/src/claude.ts:14` — imports `buildSystemPrompt`
- `ivr/src/claude.ts:194` — calls it with `DEFAULT_BRAND_VOICE` as fallback

**What reads from `app/lib/ai-agent/prompt.ts` today:**
- `app/lib/sms-v2/conversation-agent.server.ts` — imports `BRAND_VOICE`, `SMS_MODE` or the assembled system prompt
- Any route under `app/routes/` that generates copy prompts (verify with `grep -r "from.*ai-agent/prompt"`)

**Post-refactor coupling (what reads from `app/lib/ai-agent/voice.ts`):**
- `app/lib/sms-v2/conversation-agent.server.ts` (Block 1 assembly)
- `ivr/src/generated/brand-voice.ts` (generated from it, not an import — one-way dependency)
- `ivr/src/prompts.ts` (imports from generated file)
- Any route previously importing from `prompt.ts`

**What reads from `ivr/src/generated/brand-voice.ts`:**
- `ivr/src/prompts.ts` only — the generated file is not imported anywhere else in the Fly codebase

**Blast radius if the canonical source is edited without running the generator:**
The SHA assertion in CI catches this on the next PR. Between the edit and the PR, `ivr/src/generated/brand-voice.ts` is stale. The Fly deployment (which runs `fly deploy` from the IVR directory) reads from the committed generated file — so if the generated file is not updated and committed, the Fly IVR runs the old prompt. This is the same failure mode as today, but now it is caught by CI rather than being invisible. The assertion must run before merge, not just after deploy.

---

## Rollback Plan

**IVR cutover rollback:**
`IVR_PIPELINE_VERSION=v1` in Vercel env + redeploy. Immediate. No code change. Available for the entire 7-day soak window. After Phase 5 deletes `ivr/src/claude.ts`, rollback becomes: `git revert <deletion-commit> + fly deploy`.

**Prompt module rollback (if the new `voice.ts` is bad):**
The old `prompt.ts` is not deleted until the migration is verified and typechecks pass. During the migration PR, both files exist simultaneously. Rolling back is `git revert` of the migration PR.

**Generated file rollback:**
If `ivr/src/generated/brand-voice.ts` is committed with a bad value, `git revert` of that commit + `fly deploy`. The generator script is the only thing that writes to it; a revert is clean.

---

## What Could Go Wrong

**Risk 1 — IVR latency spike causes silent pause on inbound calls (highest concern).**

The current Fly v1 path runs the Anthropic API call locally on the Fly machine. The v2 path adds a Vercel HTTP round-trip: Fly WebSocket → `callEngineV2` → Vercel function cold start (can be 1-3 seconds on first request) → engine → response. On a live phone call, a 2-second pause after the greeting is audible and alarming.

Mitigation: the `v2-bridge.ts` hard timeout is 5 seconds. More importantly, the Vercel function for `/api/emma-engine/turn` should be warmed before the global flip. Consider adding a health-ping from the Fly server to the Vercel endpoint every 5 minutes to prevent cold starts during business hours. This is an `ivr-ops` task.

The canary allowlist stage (Stage A) surfaces this latency profile before it hits real customers.

**Risk 2 — Prompt compression deletes a rule covering a production failure not in the 30 goldens.**

The eval harness has 30 fixtures. Production has had many more failure modes. A rule added after a customer complaint may not have a corresponding golden. Deleting it restores the failure mode.

Mitigation: before deleting any rule, the engineer must identify the commit that added it and the incident that prompted it. If there is no corresponding golden fixture, add one first. The golden fixture is the proof that the rule is safe to delete. No rule is deleted without a corresponding fixture.

**Risk 3 — The `buildSystemPrompt` assembler on the Fly side produces a different string than the Vercel side.**

Strategy (c) generates and commits the `BRAND_VOICE` and `CHANNEL_ADDENDA.voice` strings. But `ivr/src/prompts.ts` still has its own `buildSystemPrompt` function that adds `collections` and `goodbye` at runtime. If the assembler logic diverges (e.g., different whitespace, different section ordering), the resulting system prompt on the Fly side may not match what was tested on the Vercel side.

Mitigation: `buildVoiceSystemPrompt` in `voice.ts` and `buildSystemPrompt` in `ivr/src/prompts.ts` should produce identical output for identical inputs. Add a test that calls both with the same arguments and asserts string equality. This test lives in `ivr/` and runs in the Fly build.

**Risk 4 (lower concern) — The empathy review of the full prompt module surfaces a BLOCK on a load-bearing rule.**

If `emma-empathy-reviewer` issues a BLOCK on part of the IVR channel rules (e.g., a rule about how to handle an order lookup contains an em-dash or a conditional that violates principle 2), the rule must be rewritten before Phase 1 ships. This could extend the timeline.

Mitigation: submit the full prompt module for empathy review early in the Phase 1 implementation cycle, not at the end. `rr7-engineer` and `ivr-ops` should route the draft module through the reviewer before writing the generated file.

---

## Open Questions for the User

**Q1 — Fly repo merge: is it in scope for any near-term phase?**

The codebase shows `ivr/` has its own `package.json`, `Dockerfile`, `fly.toml`, and TypeScript config. It is a standalone Node app with no monorepo workspace linkage to the root `package.json`. Moving it into the monorepo requires: adding workspace tooling at the root, reconfiguring the Fly build to reference the monorepo root's `node_modules`, and updating TypeScript project references. This is 1-2 days of infrastructure work with no functional change. Is this something you want to schedule for Phase 5 alongside the other cleanup, or is it explicitly out of scope?

The answer affects whether strategy (c)'s generated file is a permanent fixture or a temporary bridge.

**Q2 — Soak period length: 7 days or shorter?**

This ADR recommends 7 days before deleting the v1 code path. The plan document says "24-hour rollback option, then delete it." The shorter window reduces the time callers have the option of accidentally routing to a stale v1 path, but it also compresses the window for detecting slow regressions (e.g., a failure mode that only surfaces on long calls or on specific intents). The architect recommends 7 days, not 24 hours, given that IVR is customer-facing and call volume may be low enough that 24 hours provides insufficient sample size. Confirm the soak length.

**Q3 — Eval-in-CI tooling: GitHub Actions assumed. Confirm the CI provider.**

The assertion script and eval harness are written assuming a GitHub Actions workflow file. If the CI runs elsewhere (e.g., Vercel CI, a separate service), the workflow YAML will differ. Confirm the CI target before `rr7-engineer` writes the workflow file.

**Q4 — Principles as data: do you want them in `voice.ts` for Phase 1, or is agent-prose sufficient?**

This is a judgment call. Making them a typed array in `voice.ts` lets the eval target them by ID and lets the admin dashboard display them. It adds ~30 lines to `voice.ts`. The agent-prose approach is simpler and sufficient. Your call.

---

## Verdict

**APPROVE WITH CONDITIONS.**

The five Phase 1 outcomes are technically sound and the dependencies on Phase 0 are correctly sequenced. Strategy (c) for the import problem is a pragmatic call — it solves the drift problem permanently without requiring infrastructure work that would delay the IVR cutover.

**Conditions before implementation begins:**

1. **Phase 0 soak gate.** `DISCOVERY_AGENT_VERSION=v2-agent` must be live in production and have generated at least 7 days of conversation data before Phase 1 implementation starts. Phase 0's eval pass rate and funnel data must be reviewed. If Phase 0 shows regressions, Phase 1 does not start until they are resolved.

2. **Empathy review of the full prompt module.** `emma-empathy-reviewer` must review `BRAND_VOICE`, `CONVERSATION_RULES_CORE`, and all three channel addenda before the Phase 1 branch merges. This review must be submitted early (before the generated file is committed), not as a last gate.

3. **Q1 and Q2 answered before ivr-ops begins work.** The soak period length and Fly repo merge decision affect the shape of the IVR cutover task. `ivr-ops` cannot size the work without these answers.

4. **A golden fixture for every rule being deleted.** No rule compression ships without a corresponding fixture in the eval harness that proves the rule's behavior is covered. The fixture must be added in the same PR as the rule deletion.

5. **Latency profiling before global flip.** Before setting `IVR_PIPELINE_VERSION=v2` globally, measure the p50/p95 Vercel round-trip time from the Fly bridge on the canary phones under normal business-hours load. If p95 exceeds 3 seconds, investigate warm-up strategy before the global flip.

6. **No em-dashes in any string in `voice.ts`.** The new canonical module is the clean-slate moment. Apply Principle 12 to all strings, not just Emma-voice output strings. `rr7-engineer` must grep for `—` (U+2014) before submitting for empathy review.
