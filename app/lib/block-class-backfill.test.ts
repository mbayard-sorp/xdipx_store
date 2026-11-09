/**
 * Ticket #20829. Every fixture below except the synthetic bracket-tag and
 * "no signal" cases is a real block note from the live 38-row backfill
 * target set, fetched read-only via `POST /api/team/suggestion {op:'get'}`
 * (never raw SQL) and verified against this exact classifier logic before
 * `scripts/backfill-block-class.ts` was written — see that script's and
 * `block-class-backfill.ts`'s doc comments. No PII: these are internal
 * engineering block-reason notes, not customer data.
 */
import { describe, expect, it } from 'vitest'
import { classifyBlockClass } from './block-class-backfill'

describe('classifyBlockClass', () => {
  it('prefers an explicit bracket tag over any phrase rule', () => {
    const result = classifyBlockClass({
      notes: ['[owner-env] needs SENTRY_AUTH_TOKEN in Vercel; this also mentions PROTECTED PATH in passing'],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('owner-env')
  })

  it('returns null when nothing matches (manual review, never a guess)', () => {
    const result = classifyBlockClass({
      notes: ['Recommend the next session with the right tool attempts a documented technique and logs the result.'],
      suggestion: 'irrelevant',
    })
    expect(result).toBeNull()
  })

  // Real row #3517: "Blocked: PROTECTED PATH. Both DONE WHEN clauses are
  // end-to-end through the CHECKOUT stage... matches the protected glob
  // **/checkout* — R-DEV must not edit it."
  it('classifies an explicit PROTECTED PATH note as protected-path', () => {
    const result = classifyBlockClass({
      notes: [
        'Blocked: PROTECTED PATH. Both DONE WHEN clauses are end-to-end through the CHECKOUT stage. '
        + 'The cart link is built in app/lib/sms-v2/stages/checkout.server.ts, which matches the protected '
        + 'glob **/checkout* — R-DEV must not edit it (needs an owner PR).',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('protected-path')
  })

  // Real row #10492: the ORIGINAL suggestion text explains a bug by literally
  // writing "PROTECTED PATH: .github/** is on the cost-only protected list",
  // but the row's own later notes conclude the premise was wrong and the real
  // remaining work is a docs-lane re-file. Notes must win over the filing text.
  it('prefers the block notes over the original suggestion text when they disagree', () => {
    const result = classifyBlockClass({
      notes: [
        'CORRECTION: THE PREMISE OF THIS TICKET IS WRONG and it should probably be dismissed rather than '
        + 'worked. The only remaining actionable item is deleting two stale reasons in '
        + '.claude/agents/program-manager.md and replacing them with the real remaining gate. '
        + '.claude/agents/*.md is agent-editor-only; re-file as kind:instructions on the agent-editor/docs lane.',
      ],
      suggestion:
        'The agent allowlist regex cannot see docs/store-team/trackers/... '
        + 'PROTECTED PATH: .github/** is on the cost-only protected list in CLAUDE.md, so this escalates to the owner.',
    })
    expect(result?.blockClass).toBe('no-code-work')
  })

  // Real row #626: "(1) DEPENDENCY UNMET ... depends on conv-p2-quality-rollup
  // (ticket #625) ... (2) PROTECTED PATH". Either class is a defensible read
  // of this row; protected-path is checked first and both are present, so
  // this fixture documents (not just asserts) that known ambiguity.
  it('picks protected-path when a note states both dependency and protected-path reasons', () => {
    const result = classifyBlockClass({
      notes: [
        'BLOCKED on two counts.\n(1) DEPENDENCY UNMET — this detector reads conversation_quality_daily, '
        + 'which does not exist. It explicitly depends on conv-p2-quality-rollup (ticket #625), which I '
        + 'blocked this same pass as protected-path (needs db/schema.ts + db/migrations/** + vercel.json).\n'
        + '(2) PROTECTED PATH',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('protected-path')
  })

  // Real row #448: "Cross-agent epic... not a single rr7-engineer PR... Scopes
  // 2-6 span multiple lanes."
  it('classifies a cross-agent-epic note as needs-split', () => {
    const result = classifyBlockClass({
      notes: [
        'Cross-agent epic, not a single rr7-engineer PR (the row body says so explicitly). Scopes 2-6 '
        + 'span multiple lanes and interdepend.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('needs-split')
  })

  // Real row #3893: starts with the literal [owner-env] tag.
  it('classifies an [owner-env]-tagged infra note as owner-env', () => {
    const result = classifyBlockClass({
      notes: [
        '[owner-env] ENOSPC on the video render path is an infra/owner-env fault, not a single-agent code PR.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('owner-env')
  })

  // Real row #4139: no bracket tag, but explicit environment-variable prose.
  it('classifies an untagged owner-only env-var note as owner-env', () => {
    const result = classifyBlockClass({
      notes: [
        'Owner-only, no code lane. Setting an environment secret in the cloud routine environment is '
        + 'owner-only one-time setup (operating-system.md section 7, "Vercel environment variables").',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('owner-env')
  })

  // Real row #5448: upstream CI break + an in-flight file overlap with
  // another ticket, no ticket number cited by #.
  it('classifies an upstream-CI-break note as dependency', () => {
    const result = classifyBlockClass({
      notes: [
        'BLOCKED on a verified upstream CI break plus an in-flight file overlap. migration-dry-run is '
        + 'structurally red for EVERY db/migrations PR right now.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('dependency')
  })

  // Real row #4944: explicitly names the row it duplicates.
  it('classifies an explicit "duplicate of #N" note as duplicate', () => {
    const result = classifyBlockClass({
      notes: [
        'Duplicate of #4889 (same GET /api/team/conversion-status 500). Root cause is NOT a route bug.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('duplicate')
  })

  // Real row #5061: "depends on 2)" refers to the ticket's OWN enumerated
  // list item 2, not ticket #2 — must not false-positive as dependency.
  it('does not treat a bare "depends on 2)" list reference as a ticket dependency', () => {
    const result = classifyBlockClass({
      notes: [
        'Scopes 2 (destination surface) + 6 (SEO guards on the new URL: depends on 2) span at least three '
        + 'lanes and interdepend — shipping scope 2 alone without the rest leaves a dangling link.',
      ],
      suggestion: 'irrelevant',
    })
    // No ticket-# dependency and no other rule fires on this snippet alone.
    expect(result).toBeNull()
  })

  // Real row #2048: repeats the exact phrase from three separate passes.
  it('classifies a repeated "No R-DEV code change to make" note as no-code-work', () => {
    const result = classifyBlockClass({
      notes: [
        'No R-DEV code change to make (verified for the third pass). The schema SOURCE already exists on '
        + 'main. The DONE WHEN is purely operational and outside a code PR: it needs a Sanity Studio deploy.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('no-code-work')
  })

  // Real row #4889/#5061 shape: "No code change is needed", the fix is an
  // owner-run migration.
  it('classifies a "no code change is needed, owner must run a migration" note as no-code-work', () => {
    const result = classifyBlockClass({
      notes: [
        'REMEDY is owner-gated (DB migration application, not a code change): run scripts/apply-migrations.ts '
        + 'against production to apply 082. No code change is needed; main already targets the new names.',
      ],
      suggestion: 'irrelevant',
    })
    expect(result?.blockClass).toBe('no-code-work')
  })

  it('falls back to lastError, then the suggestion text, only when no note matches', () => {
    const viaLastError = classifyBlockClass({
      notes: [],
      lastError: 'No R-DEV code change to make; this is a docs-only append.',
      suggestion: 'irrelevant',
    })
    expect(viaLastError?.blockClass).toBe('no-code-work')

    const viaSuggestion = classifyBlockClass({
      notes: [],
      lastError: null,
      suggestion: 'Duplicate of #123, same root cause.',
    })
    expect(viaSuggestion?.blockClass).toBe('duplicate')
  })
})
