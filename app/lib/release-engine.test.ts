/**
 * Decision-logic tests for the release engine.
 *
 * The database here is PRODUCTION and the GitHub token is a real one, so this
 * file reaches neither: db.server, kv.server, and every network module are
 * mocked at import time, and every assertion is on a pure function. Nothing in
 * here can merge, deploy, promote, or write a row. Same discipline as
 * team-tickets.test.ts.
 *
 * What is asserted, in priority order:
 *   1. Protected classification wins over every other signal, and comes only
 *      from the changed-file list.
 *   2. Gate evaluation: CI, allowlist, the docs carve-out, ticket verdicts.
 *   3. Attempt accounting and the bounce/block boundary.
 *   4. The circuit breaker and the daily cap.
 */

import { describe, expect, it, vi } from 'vitest'

// Mock everything with a side effect before importing the module under test.
vi.mock('~/lib/db.server', () => ({ db: {} }))
vi.mock('~/lib/kv.server', () => ({
  KV_KEYS: { liveDealHandle: 'live-deal:handle' },
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  kvSetNX: vi.fn(async () => true),
  kvDel: vi.fn(async () => undefined),
  kvIncr: vi.fn(async () => 1),
}))
vi.mock('~/lib/homepage-healthcheck.server', () => ({
  checkPageOnce: vi.fn(),
  renderTruth: vi.fn(),
}))
vi.mock('~/lib/checkout-probe.server', () => ({ checkUrl: vi.fn(), runCheckoutProbe: vi.fn() }))
vi.mock('~/lib/feed-processor.server', () => ({ getPipelineSetting: vi.fn(async () => null) }))
vi.mock('~/lib/owner-alerts.server', () => ({
  sendOwnerEmail: vi.fn(async () => ({ sent: false })),
  escapeHtml: (s: string) => s,
}))
vi.mock('~/lib/team.server', () => ({
  transitionSuggestion: vi.fn(),
  getTicket: vi.fn(),
  runWithOutOfBandReconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
// ADR-008 step 2. Mocked here because this file is about the engine's decision
// logic; the autofile module's own behaviour is tested in
// release-ticket-autofile.test.ts.
vi.mock('~/lib/release-ticket-autofile.server', () => ({
  autoFileTicketForPr: vi.fn(async () => null),
  dismissTicketsForClosedUnmergedPrs: vi.fn(async () => ({ checked: 0, dismissed: 0, errors: [] })),
}))

import { classifyChangedFiles } from '~/lib/github.server'
import {
  AGENT_EDITOR_ALLOWLIST_RE,
  CI_ABSENT_GRACE_MS,
  MAX_CI_RETRIGGERS_PER_PR,
  CONDITIONAL_UNDRAFT_MIN_AGE_MS,
  CONDITIONAL_UNDRAFT_PREFIXES,
  DEFAULT_MAX_MERGES_PER_DAY,
  MAX_TICKET_ATTEMPTS,
  NEEDS_OWNER_LABEL,
  REQUIRED_CHECK,
  ROLLBACK_CIRCUIT_LIMIT,
  ageMsFromTimestamp,
  autoReadyOnDraft,
  hasWipMarker,
  isConditionalUndraftLane,
  checkState,
  dailyCapReached,
  evaluatePullRequest,
  isAgentBranch,
  isDocsOnly,
  isEligibleBranch,
  isRevertBranch,
  parseDailyCap,
  parseTicketRefFromTitle,
  prNumberFromRef,
  requiresAllowlistCheck,
  shouldBlockForAttempts,
  shouldTripCircuit,
  summarizeSmoke,
  type PullRequestFacts,
  type TicketFacts,
} from '~/lib/release-engine.server'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CODE_FILES = ['app/lib/storefront-home.server.ts', 'app/components/store/Hero.tsx']
const DOCS_FILES = ['docs/homepage-team/mission-brief.md', '.claude/agents/design-critic.md']

const verifiedTicket: TicketFacts = { id: 41, status: 'verified', kind: 'code', attemptCount: 0 }

/** An agent-editor docs branch. `agents/*` is the only namespace the allowlist
 *  workflow runs on, so every allowlist assertion below names it explicitly. */
const DOCS_BRANCH = 'agents/suggestion-9'

/** The default fixture is an R-DEV code PR, which lives on `ticket/*` precisely
 *  so the docs allowlist does not apply to it. */
function facts(over: Partial<PullRequestFacts> = {}): PullRequestFacts {
  const changedPaths = over.changedPaths ?? CODE_FILES
  return {
    number: 100,
    headRef: 'ticket/41',
    title: 'fix the rail anchor',
    // Fresh activity by default, so the conditional undraft (which requires 30
    // idle minutes) never fires unless a test opts in with an explicit ageMs.
    ageMs: 0,
    draft: false,
    mergeable: true,
    mergeableState: 'clean',
    labels: [],
    classification: over.classification ?? classifyChangedFiles(changedPaths),
    changedPaths,
    checks: { [REQUIRED_CHECK]: 'success' },
    ticket: verifiedTicket,
    // No re-triggers spent by default, so a test that wants the exhausted
    // branch has to say so explicitly.
    ciRetriggers: 0,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Branch predicates
// ---------------------------------------------------------------------------

describe('branch predicates', () => {
  it('recognises every agent branch prefix and nothing else', () => {
    for (const ref of [
      'agents/suggestion-1', 'ticket/43', 'claude/foo', 'phase1/release-engine', 'tonight/hotfix',
      // ADR-008 step 4, 2026-08-04.
      'fix/pricing-audit-log-prune', 'pm/tracker-2026-08-03',
    ]) {
      expect(isAgentBranch(ref)).toBe(true)
    }
    for (const ref of ['main', 'feature/x', 'agent/typo', 'ticketing/x', 'renovate/deps', 'fixture/x', 'pmx/y']) {
      expect(isAgentBranch(ref)).toBe(false)
    }
  })

  // The whole point of ADR-008 step 4 is visibility, not permission. A widened
  // prefix must not pick up the docs carve-out, which would let a tracker PR
  // merge with no ticket and no QA.
  it('widens what the engine looks at without widening any gate', () => {
    for (const ref of ['fix/pricing-audit-log-prune', 'pm/tracker-2026-08-03']) {
      expect(isEligibleBranch(ref)).toBe(true)
      expect(requiresAllowlistCheck(ref)).toBe(false)
      expect(autoReadyOnDraft(ref)).toBe(false)
    }
  })

  it('treats revert branches as eligible but not as agent branches', () => {
    expect(isRevertBranch('revert/pr-123')).toBe(true)
    expect(isAgentBranch('revert/pr-123')).toBe(false)
    expect(isEligibleBranch('revert/pr-123')).toBe(true)
    expect(isEligibleBranch('main')).toBe(false)
  })

  it('requires the allowlist check only on agents/*, matching the workflow trigger', () => {
    expect(requiresAllowlistCheck('agents/suggestion-1')).toBe(true)
    expect(requiresAllowlistCheck('claude/foo')).toBe(false)
    expect(requiresAllowlistCheck('revert/pr-9')).toBe(false)
  })

  // Regression: code tickets used to branch as `agents/ticket-<id>`, which put
  // every R-DEV code fix under a docs-only allowlist it could never satisfy.
  // The namespaces are split now, and must stay split.
  it('does not gate a code ticket branch on the docs allowlist', () => {
    expect(isAgentBranch('ticket/43')).toBe(true)
    expect(requiresAllowlistCheck('ticket/43')).toBe(false)
  })

  // Auto-undraft is deliberately narrower than isAgentBranch: it covers the two
  // machine lanes whose only terminal state is an open PR, and nothing an owner
  // might have drafted on purpose.
  it('auto-undrafts only the machine lanes', () => {
    for (const ref of ['agents/suggestion-1', 'ticket/43']) {
      expect(autoReadyOnDraft(ref)).toBe(true)
    }
    for (const ref of [
      'claude/foo', 'phase1/x', 'tonight/hotfix', 'revert/pr-9', 'main', 'agent/typo',
      // Added to AGENT_BRANCH_PREFIXES by ADR-008 step 4 and deliberately NOT
      // here: both are owner-attended lanes where a draft is plausibly WIP.
      'fix/wip', 'pm/tracker-2026-08-03',
    ]) {
      expect(autoReadyOnDraft(ref)).toBe(false)
    }
  })

  it('never auto-undrafts a branch the engine would not consider at all', () => {
    for (const ref of ['main', 'feature/x', 'renovate/deps', 'ticketing/x']) {
      expect(autoReadyOnDraft(ref) && !isEligibleBranch(ref)).toBe(false)
    }
  })
})

describe('isDocsOnly', () => {
  it('accepts exactly the three allowlisted docs folders', () => {
    expect(isDocsOnly(DOCS_FILES)).toBe(true)
    expect(isDocsOnly(['docs/store-team/improvement-loop.md'])).toBe(true)
  })

  it('rejects a mixed diff, so one code file removes the carve-out', () => {
    expect(isDocsOnly([...DOCS_FILES, 'app/lib/storefront-home.server.ts'])).toBe(false)
  })

  it('rejects nested paths, because a single * never crosses a directory', () => {
    expect(isDocsOnly(['docs/homepage-team/sub/thing.md'])).toBe(false)
    expect(isDocsOnly(['.claude/agents/nested/a.md'])).toBe(false)
    expect(AGENT_EDITOR_ALLOWLIST_RE.test('docs/audits/x.md')).toBe(false)
  })

  it('rejects an empty diff rather than treating it as a docs change', () => {
    expect(isDocsOnly([])).toBe(false)
  })

  it('normalises before matching, so odd path forms cannot dodge or fake it', () => {
    expect(isDocsOnly(['./docs/store-team/x.md'])).toBe(true)
    expect(isDocsOnly(['docs/store-team/../../app/root.tsx'])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Check state
// ---------------------------------------------------------------------------

describe('checkState', () => {
  it('reports absent when the check never ran, which is not a pass', () => {
    expect(checkState({}, ['check'])).toBe('absent')
  })

  it('reports pending for a reported-but-unfinished check', () => {
    expect(checkState({ check: null }, ['check'])).toBe('pending')
  })

  it('treats every failing conclusion as failing', () => {
    for (const c of ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']) {
      expect(checkState({ check: c }, ['check'])).toBe('failing')
    }
  })

  it('lets a failure from any accepted alias win over a success from another', () => {
    expect(checkState({ allowlist: 'success', 'agent-allowlist': 'failure' }, ['allowlist', 'agent-allowlist'])).toBe('failing')
  })

  it('accepts either allowlist name so a job rename cannot silently open the gate', () => {
    expect(checkState({ 'agent-allowlist': 'success' }, ['allowlist', 'agent-allowlist'])).toBe('success')
    expect(checkState({ allowlist: 'success' }, ['allowlist', 'agent-allowlist'])).toBe('success')
  })

  it('does not read a neutral or skipped conclusion as success', () => {
    expect(checkState({ check: 'neutral' }, ['check'])).toBe('pending')
    expect(checkState({ check: 'skipped' }, ['check'])).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// Protected classification routing (the property that matters most)
// ---------------------------------------------------------------------------

describe('protected classification routing', () => {
  const protectedCases: Array<[string, string]> = [
    ['app/lib/emma-cart.server.ts', 'cart'],
    ['app/routes/_layout.checkout-extras.tsx', 'checkout route'],
    ['db/migrations/072_thing.sql', 'migration'],
    ['db/schema.ts', 'schema'],
    ['app/lib/session.server.ts', 'session'],
    ['app/lib/team.server.ts', 'team valves'],
    ['app/lib/team-keys.ts', 'team keys'],
    ['.github/workflows/ci.yml', 'CI config'],
    ['vercel.json', 'deploy config'],
    ['package.json', 'dependencies'],
    ['app/lib/release-engine.server.ts', 'the engine itself'],
    ['app/lib/github.server.ts', 'the classifier itself'],
  ]

  for (const [file, label] of protectedCases) {
    it(`escalates rather than merges when the diff touches ${label}`, () => {
      const d = evaluatePullRequest(facts({ changedPaths: [file], classification: classifyChangedFiles([file]) }))
      expect(d.action).toBe('escalate-protected')
      expect(d.code).toBe('protected')
      expect(d.protectedFiles).toContain(file)
    })
  }

  it('escalates even when CI is green, the ticket is verified, and the diff is one file', () => {
    const d = evaluatePullRequest(
      facts({
        changedPaths: ['db/schema.ts'],
        classification: classifyChangedFiles(['db/schema.ts']),
        checks: { check: 'success', allowlist: 'success' },
        ticket: verifiedTicket,
      }),
    )
    expect(d.action).toBe('escalate-protected')
  })

  it('escalates before it even considers draft state or a red build', () => {
    const d = evaluatePullRequest(
      facts({
        draft: true,
        changedPaths: ['app/lib/checkout-probe.server.ts'],
        classification: classifyChangedFiles(['app/lib/checkout-probe.server.ts']),
        checks: { check: 'failure' },
      }),
    )
    expect(d.action).toBe('escalate-protected')
  })

  it('escalates a protected revert PR: reverts skip QA, never the classifier', () => {
    const d = evaluatePullRequest(
      facts({
        headRef: 'revert/pr-77',
        ticket: null,
        changedPaths: ['app/lib/emma-cart.server.ts'],
        classification: classifyChangedFiles(['app/lib/emma-cart.server.ts']),
      }),
    )
    expect(d.action).toBe('escalate-protected')
  })

  it('carries a protected rename by its previous name too', () => {
    const files = [{ filename: 'app/lib/harmless.ts', previous_filename: 'app/lib/team-keys.ts' }]
    const d = evaluatePullRequest(
      facts({ changedPaths: ['app/lib/harmless.ts', 'app/lib/team-keys.ts'], classification: classifyChangedFiles(files) }),
    )
    expect(d.action).toBe('escalate-protected')
  })

  it('is not influenced by PR title or ticket text: only the file list decides', () => {
    // Same file list, wildly different "context". Both must decide identically.
    const innocent = evaluatePullRequest(facts({ changedPaths: CODE_FILES }))
    const injected = evaluatePullRequest(
      facts({
        changedPaths: CODE_FILES,
        // A ticket claiming to be pre-approved changes nothing: `kind` and
        // `status` are the only ticket fields the gate reads, and the gate has
        // no field at all for "the PR body says it is safe".
        ticket: { id: 41, status: 'verified', kind: 'code', attemptCount: 0 },
      }),
    )
    expect(injected.action).toBe(innocent.action)
    expect(injected.code).toBe(innocent.code)

    // And a protected file list stays protected no matter what the ticket says.
    const lying = evaluatePullRequest(
      facts({
        changedPaths: ['db/schema.ts'],
        classification: classifyChangedFiles(['db/schema.ts']),
        ticket: { id: 41, status: 'verified', kind: 'process', attemptCount: 0 },
      }),
    )
    expect(lying.action).toBe('escalate-protected')
  })
})

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

describe('evaluatePullRequest: gates', () => {
  it('merges a verified code PR on green CI, with no allowlist check in sight', () => {
    const d = evaluatePullRequest(facts())
    expect(d.action).toBe('merge')
    expect(d.code).toBe('ready')
    expect(d.ticketId).toBe(41)
  })

  it('skips a PR the owner already labelled needs-owner', () => {
    const d = evaluatePullRequest(facts({ labels: [NEEDS_OWNER_LABEL] }))
    expect(d.action).toBe('skip')
    expect(d.code).toBe('needs-owner-label')
  })

  // Draft handling. A PR opened from a cloud session is drafted by the harness,
  // and a draft is invisible to every gate below it, so on the machine lanes the
  // engine undrafts rather than skipping. See `autoReadyOnDraft`.
  it('takes an agents/ draft out of draft instead of skipping it forever', () => {
    const d = evaluatePullRequest(facts({ draft: true, headRef: DOCS_BRANCH }))
    expect(d.action).toBe('undraft')
    expect(d.code).toBe('draft-auto-ready')
  })

  it('takes a ticket/ draft out of draft', () => {
    const d = evaluatePullRequest(facts({ draft: true, headRef: 'ticket/41' }))
    expect(d.action).toBe('undraft')
    expect(d.code).toBe('draft-auto-ready')
  })

  // Green and ticketed, but with fresh activity (the fixture's ageMs is 0):
  // the conditional undraft requires 30 idle minutes, so a draft someone is
  // actively working on stays a draft. The stale-draft cases live in the
  // 'conditional undraft' describe below.
  it('still skips a fresh draft on an owner-attended lane', () => {
    for (const headRef of ['claude/some-session', 'phase1/thing', 'tonight/thing']) {
      const d = evaluatePullRequest(facts({ draft: true, headRef }))
      expect(d.action).toBe('skip')
      expect(d.code).toBe('draft')
    }
  })

  it('never merges in the same decision that undrafts, however green the PR is', () => {
    // Identical facts to the default green fixture except for the draft flag:
    // the only difference in outcome must be undraft-instead-of-merge, so the
    // merge can only happen on a later cycle against freshly read facts.
    expect(evaluatePullRequest(facts({})).action).toBe('merge')
    expect(evaluatePullRequest(facts({ draft: true })).action).toBe('undraft')
  })

  it('leaves a drafted protected PR to the owner rather than undrafting it', () => {
    const d = evaluatePullRequest(
      facts({ draft: true, headRef: DOCS_BRANCH, changedPaths: ['db/schema.ts'] }),
    )
    expect(d.action).toBe('escalate-protected')
  })

  it('does not undraft a PR the owner already claimed with the needs-owner label', () => {
    const d = evaluatePullRequest(
      facts({ draft: true, headRef: DOCS_BRANCH, labels: [NEEDS_OWNER_LABEL] }),
    )
    expect(d.action).toBe('skip')
    expect(d.code).toBe('needs-owner-label')
  })

  it('skips a PR that conflicts with the base branch', () => {
    expect(evaluatePullRequest(facts({ mergeableState: 'dirty' })).code).toBe('conflict')
  })

  it('waits while CI is still running instead of merging optimistically', () => {
    const d = evaluatePullRequest(facts({ checks: { check: null } }))
    expect(d.action).toBe('wait')
    expect(d.code).toBe('ci-pending')
  })

  it('waits when CI never reported at all: no news is not good news', () => {
    const d = evaluatePullRequest(facts({ checks: {} }))
    expect(d.action).toBe('wait')
    expect(d.code).toBe('ci-pending')
  })

  it('bounces a verified ticket when CI is red, spending a fix attempt', () => {
    const d = evaluatePullRequest(facts({ checks: { check: 'failure' } }))
    expect(d.action).toBe('bounce')
    expect(d.code).toBe('ci-red')
    expect(d.lastError).toContain('failed')
    expect(d.ticketId).toBe(41)
  })

  it('does not bounce a ticket that is not verified: a red build there is QA business', () => {
    const d = evaluatePullRequest(
      facts({
        checks: { check: 'failure' },
        ticket: { id: 41, status: 'pr_open', kind: 'code', attemptCount: 0 },
      }),
    )
    expect(d.action).toBe('skip')
    expect(d.code).toBe('ci-red')
  })

  it('never merges over a red build, not even a docs-only PR', () => {
    const d = evaluatePullRequest(
      facts({
        headRef: DOCS_BRANCH,
        changedPaths: DOCS_FILES,
        checks: { check: 'failure', allowlist: 'success' },
        ticket: null,
      }),
    )
    expect(d.action).not.toBe('merge')
    expect(d.code).toBe('ci-red')
  })

  it('waits when the allowlist check has not reported on an agents/* branch', () => {
    const d = evaluatePullRequest(
      facts({ headRef: DOCS_BRANCH, changedPaths: DOCS_FILES, checks: { check: 'success' }, ticket: null }),
    )
    expect(d.action).toBe('wait')
    expect(d.code).toBe('allowlist-pending')
  })

  it('blocks on a red allowlist even when CI is green', () => {
    // An agents/* PR carrying code: exactly what the workflow exists to catch.
    const d = evaluatePullRequest(
      facts({ headRef: DOCS_BRANCH, checks: { check: 'success', allowlist: 'failure' } }),
    )
    expect(d.code).toBe('allowlist-red')
    expect(d.action).toBe('bounce')
  })

  it('does not require the allowlist on a non-agents branch', () => {
    const d = evaluatePullRequest(facts({ headRef: 'claude/fix-thing', checks: { check: 'success' } }))
    expect(d.action).toBe('merge')
  })

  // The bug this split fixes: a code fix on the old `agents/ticket-<id>` branch
  // tripped a docs allowlist it could never pass, and no amount of green CI or
  // QA verification could get it merged.
  it('merges a code ticket PR without ever consulting the allowlist', () => {
    const d = evaluatePullRequest(facts({ headRef: 'ticket/43', checks: { check: 'success' } }))
    expect(d.action).toBe('merge')
    expect(d.code).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// The dropped-trigger class
//
// GitHub declines to create `pull_request` workflow runs often enough that this
// was the single largest cause of an agent PR sitting open: `check` is a
// required context on main, so a PR whose run was never built can never merge,
// and before these paths existed nothing detected it, retried it, or reported
// it. The owner merged those by hand, every day.
// ---------------------------------------------------------------------------

describe('evaluatePullRequest: missing and no-verdict checks', () => {
  const OLD = CI_ABSENT_GRACE_MS + 60_000

  it('waits, not re-triggers, while a missing check is still inside the grace window', () => {
    const d = evaluatePullRequest(facts({ checks: {}, ageMs: CI_ABSENT_GRACE_MS - 1 }))
    expect(d.action).toBe('wait')
    expect(d.code).toBe('ci-pending')
  })

  it('re-triggers once a required check has been absent past the grace window', () => {
    const d = evaluatePullRequest(facts({ checks: {}, ageMs: OLD }))
    expect(d.action).toBe('retrigger-ci')
    expect(d.code).toBe('ci-absent')
  })

  it('escalates to the owner once the re-trigger budget is spent', () => {
    const d = evaluatePullRequest(
      facts({ checks: {}, ageMs: OLD, ciRetriggers: MAX_CI_RETRIGGERS_PER_PR }),
    )
    expect(d.action).toBe('escalate-ci')
    expect(d.code).toBe('ci-stuck')
  })

  // A hosted runner that was never acquired reports `cancelled`, which is
  // indistinguishable from a real failure in the checks API even though not one
  // step executed. Re-running is how a verdict is obtained; it is not a way
  // around one.
  it('re-runs a check that concluded without executing rather than calling it red', () => {
    for (const conclusion of ['cancelled', 'stale']) {
      const d = evaluatePullRequest(facts({ checks: { [REQUIRED_CHECK]: conclusion } }))
      expect(d.action).toBe('retrigger-ci')
      expect(d.code).toBe('ci-no-verdict')
    }
  })

  it('escalates a no-verdict check once the re-trigger budget is spent', () => {
    const d = evaluatePullRequest(
      facts({ checks: { [REQUIRED_CHECK]: 'cancelled' }, ciRetriggers: MAX_CI_RETRIGGERS_PER_PR }),
    )
    expect(d.action).toBe('escalate-ci')
    expect(d.code).toBe('ci-stuck')
  })

  // The gate this whole path must not weaken. A build that ran and failed is
  // red forever, no re-runs, no matter how old the PR is.
  it('never re-triggers a check that genuinely ran and failed', () => {
    for (const conclusion of ['failure', 'timed_out', 'action_required', 'startup_failure']) {
      const d = evaluatePullRequest(
        facts({ checks: { [REQUIRED_CHECK]: conclusion }, ageMs: OLD, ticket: null }),
      )
      expect(d.action).toBe('skip')
      expect(d.code).toBe('ci-red')
    }
  })

  it('re-triggers a missing allowlist run on the docs lane', () => {
    const d = evaluatePullRequest(
      facts({ headRef: DOCS_BRANCH, changedPaths: DOCS_FILES, ticket: null, checks: {}, ageMs: OLD }),
    )
    expect(d.action).toBe('retrigger-ci')
    expect(d.code).toBe('ci-absent')
  })

  // Protected paths still win. A stuck check must never become a route around
  // the one gate that has no override.
  it('still escalates a protected path ahead of any re-trigger', () => {
    const d = evaluatePullRequest(
      facts({ changedPaths: ['db/schema.ts'], checks: {}, ageMs: OLD }),
    )
    expect(d.action).toBe('escalate-protected')
    expect(d.code).toBe('protected')
  })
})

describe('evaluatePullRequest: ticket linkage', () => {
  it('refuses to merge a code PR with no linked ticket', () => {
    const d = evaluatePullRequest(facts({ ticket: null }))
    expect(d.action).toBe('skip')
    expect(d.code).toBe('no-ticket')
  })

  it('refuses to merge a code PR whose ticket is not verified', () => {
    for (const status of ['proposed', 'approved', 'in_progress', 'pr_open', 'in_review', 'blocked'] as const) {
      const d = evaluatePullRequest(facts({ ticket: { id: 7, status, kind: 'code', attemptCount: 0 } }))
      expect(d.action).toBe('skip')
      expect(d.code).toBe('ticket-not-verified')
    }
  })

  // The carve-out covers a SLOW `check` (a run exists and has not concluded),
  // which is what it was written for. It deliberately does not cover an ABSENT
  // one: `check` is a required context on main, so a merge attempted while no
  // run exists is one GitHub refuses, and the engine would burn all three merge
  // attempts on refusals before escalating a PR whose only problem was a
  // missing trigger. That case is the re-trigger path instead.
  it('applies the docs-only carve-out: allowlist green is enough, no ticket needed', () => {
    const d = evaluatePullRequest(
      facts({
        headRef: DOCS_BRANCH,
        changedPaths: DOCS_FILES,
        ticket: null,
        checks: { allowlist: 'success', [REQUIRED_CHECK]: null },
      }),
    )
    expect(d.action).toBe('merge')
    expect(d.docsOnly).toBe(true)
  })

  it('withholds the docs carve-out while no `check` run exists at all', () => {
    const d = evaluatePullRequest(
      facts({ headRef: DOCS_BRANCH, changedPaths: DOCS_FILES, ticket: null, checks: { allowlist: 'success' } }),
    )
    expect(d.action).toBe('wait')
    expect(d.code).toBe('ci-pending')
  })

  // A docs-only diff on a code branch is still a code PR: the carve-out belongs
  // to agent-editor's namespace, and `ticket/*` never gets it.
  it('does not extend the docs carve-out to a ticket/* branch', () => {
    const d = evaluatePullRequest(
      facts({ headRef: 'ticket/43', changedPaths: DOCS_FILES, ticket: null, checks: { check: 'success' } }),
    )
    expect(d.action).toBe('skip')
    expect(d.code).toBe('no-ticket')
  })

  it('does not extend the docs carve-out to a non-agents branch', () => {
    const d = evaluatePullRequest(
      facts({ headRef: 'claude/docs-tweak', changedPaths: DOCS_FILES, ticket: null, checks: { check: 'success' } }),
    )
    expect(d.action).toBe('skip')
    expect(d.code).toBe('no-ticket')
  })

  it('lets a revert PR merge on CI alone, with no ticket and no QA verdict', () => {
    const d = evaluatePullRequest(
      facts({ headRef: 'revert/pr-77', ticket: null, checks: { check: 'success' } }),
    )
    expect(d.action).toBe('merge')
    expect(d.isRevert).toBe(true)
  })

  it('still holds a revert PR on a red build', () => {
    const d = evaluatePullRequest(facts({ headRef: 'revert/pr-77', ticket: null, checks: { check: 'failure' } }))
    expect(d.action).toBe('skip')
    expect(d.code).toBe('ci-red')
    expect(d.isRevert).toBe(true)
  })
})

describe('evaluatePullRequest: mergeability', () => {
  it('waits while GitHub is still computing mergeability', () => {
    const d = evaluatePullRequest(facts({ mergeable: null }))
    expect(d.action).toBe('wait')
    expect(d.code).toBe('mergeability-unknown')
  })

  it('skips when GitHub says it is not mergeable', () => {
    const d = evaluatePullRequest(facts({ mergeable: false, mergeableState: 'blocked' }))
    expect(d.action).toBe('skip')
    expect(d.code).toBe('not-mergeable')
  })
})

// ---------------------------------------------------------------------------
// Ticket reference parsing
// ---------------------------------------------------------------------------

describe('ticket reference parsing', () => {
  it('pulls the id out of the conventional agent PR title', () => {
    expect(parseTicketRefFromTitle('agents: ticket #41: fix the rail')).toBe(41)
    expect(parseTicketRefFromTitle('fix(rail): restore the anchor (#7)')).toBe(7)
  })

  it('returns null when there is no reference', () => {
    expect(parseTicketRefFromTitle('fix the rail')).toBeNull()
    expect(parseTicketRefFromTitle('bump #')).toBeNull()
  })

  it('reads a PR number out of a URL or a hash ref', () => {
    expect(prNumberFromRef('https://github.com/o/r/pull/348')).toBe(348)
    expect(prNumberFromRef('#348')).toBe(348)
    expect(prNumberFromRef('https://github.com/o/r/issues/348')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Attempt accounting, circuit breaker, cap
// ---------------------------------------------------------------------------

describe('attempt accounting', () => {
  it('blocks only once the ticket has burned MAX_TICKET_ATTEMPTS', () => {
    expect(MAX_TICKET_ATTEMPTS).toBe(3)
    expect(shouldBlockForAttempts(1)).toBe(false)
    expect(shouldBlockForAttempts(2)).toBe(false)
    expect(shouldBlockForAttempts(3)).toBe(true)
    expect(shouldBlockForAttempts(4)).toBe(true)
  })
})

describe('circuit breaker', () => {
  it('trips at two rollbacks in a day and stays tripped', () => {
    expect(ROLLBACK_CIRCUIT_LIMIT).toBe(2)
    expect(shouldTripCircuit(0)).toBe(false)
    expect(shouldTripCircuit(1)).toBe(false)
    expect(shouldTripCircuit(2)).toBe(true)
    expect(shouldTripCircuit(9)).toBe(true)
  })
})

describe('daily cap', () => {
  it('defaults to 6 when the setting is missing or unparseable', () => {
    expect(parseDailyCap(null)).toBe(DEFAULT_MAX_MERGES_PER_DAY)
    expect(parseDailyCap(undefined)).toBe(DEFAULT_MAX_MERGES_PER_DAY)
    expect(parseDailyCap('six')).toBe(DEFAULT_MAX_MERGES_PER_DAY)
    expect(parseDailyCap('')).toBe(DEFAULT_MAX_MERGES_PER_DAY)
  })

  it('honours 0 as "merge nothing today" but refuses a negative', () => {
    expect(parseDailyCap('0')).toBe(0)
    expect(dailyCapReached(0, 0)).toBe(true)
    expect(parseDailyCap('-3')).toBe(DEFAULT_MAX_MERGES_PER_DAY)
  })

  it('clamps an absurd cap rather than trusting a typo', () => {
    expect(parseDailyCap('100000')).toBe(100)
  })

  it('stops merging once the count reaches the cap', () => {
    expect(dailyCapReached(5, 6)).toBe(false)
    expect(dailyCapReached(6, 6)).toBe(true)
    expect(dailyCapReached(7, 6)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Smoke summary
// ---------------------------------------------------------------------------

describe('summarizeSmoke', () => {
  it('passes only when every check passed', () => {
    const r = summarizeSmoke([
      { name: 'home', ok: true },
      { name: 'discover', ok: true },
    ])
    expect(r.ok).toBe(true)
    expect(r.evidence).toContain('smoke passed')
  })

  it('names every failing check in the evidence written to last_error', () => {
    const r = summarizeSmoke([
      { name: 'home', ok: true },
      { name: 'render-truth', ok: false, detail: 'missing: Emma edit' },
      { name: 'checkout-probe', ok: false, detail: 'failed at step "cart"' },
    ])
    expect(r.ok).toBe(false)
    expect(r.evidence).toContain('render-truth')
    expect(r.evidence).toContain('checkout-probe')
    expect(r.evidence).toContain('missing: Emma edit')
  })

  it('treats an empty check list as a pass only vacuously, and the caller never sends one', () => {
    expect(summarizeSmoke([]).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Conditional undraft (owner-attended lanes)
// ---------------------------------------------------------------------------

describe('conditional undraft on owner-attended lanes', () => {
  /** Every eligibility condition satisfied at once. */
  const eligible = () =>
    facts({
      draft: true,
      headRef: 'claude/stale-session',
      ageMs: CONDITIONAL_UNDRAFT_MIN_AGE_MS,
      checks: { [REQUIRED_CHECK]: 'success' },
      ticket: verifiedTicket,
      title: 'fix the rail anchor',
      labels: [],
    })

  it('covers exactly the five owner-attended prefixes', () => {
    expect(CONDITIONAL_UNDRAFT_PREFIXES).toEqual(['claude/', 'phase1/', 'tonight/', 'fix/', 'pm/'])
    for (const p of CONDITIONAL_UNDRAFT_PREFIXES) {
      expect(isConditionalUndraftLane(`${p}thing`)).toBe(true)
      // No overlap with the unconditional machine-lane undraft.
      expect(autoReadyOnDraft(`${p}thing`)).toBe(false)
    }
    for (const ref of ['agents/suggestion-1', 'ticket/43', 'revert/pr-9', 'main', 'claudette/x', 'fixture/x']) {
      expect(isConditionalUndraftLane(ref)).toBe(false)
    }
  })

  it('undrafts a stale, green, ticketed, unmarked draft on every covered lane', () => {
    for (const p of CONDITIONAL_UNDRAFT_PREFIXES) {
      const d = evaluatePullRequest({ ...eligible(), headRef: `${p}thing` })
      expect(d.action).toBe('undraft')
      expect(d.code).toBe('draft-auto-ready')
    }
  })

  // The eligibility matrix: knocking out any single condition keeps the draft.
  const ineligible: Array<[string, Partial<PullRequestFacts>]> = [
    ['CI is red', { checks: { [REQUIRED_CHECK]: 'failure' } }],
    ['CI is still pending', { checks: { [REQUIRED_CHECK]: null } }],
    ['CI never reported', { checks: {} }],
    ['no pr-linked ticket exists', { ticket: null }],
    ['the PR is younger than 30 minutes', { ageMs: CONDITIONAL_UNDRAFT_MIN_AGE_MS - 1 }],
    ['the timestamp was unparseable (ageMs 0)', { ageMs: 0 }],
    ['the title says WIP', { title: 'WIP: fix the rail anchor' }],
    ['the title says [wip]', { title: '[wip] rail anchor' }],
    ['a wip label is set', { labels: ['wip'] }],
    ['a WIP label is set in another case', { labels: ['WIP'] }],
  ]
  for (const [why, over] of ineligible) {
    it(`keeps the draft when ${why}`, () => {
      const d = evaluatePullRequest({ ...eligible(), ...over })
      expect(d.action).toBe('skip')
      expect(d.code).toBe('draft')
    })
  }

  it('does not require the ticket to be verified, only to exist', () => {
    const d = evaluatePullRequest({
      ...eligible(),
      ticket: { id: 9, status: 'pr_open', kind: 'code', attemptCount: 0 },
    })
    expect(d.action).toBe('undraft')
  })

  it('accepts a ticket in any status: undrafting is visibility, not approval', () => {
    for (const status of ['proposed', 'approved', 'in_progress', 'in_review', 'blocked'] as const) {
      const d = evaluatePullRequest({
        ...eligible(),
        ticket: { id: 9, status, kind: 'code', attemptCount: 0 },
      })
      expect(d.action).toBe('undraft')
    }
  })

  it('never fires on the machine lanes, which have their own unconditional rule', () => {
    // A ticket/ draft undrafts even when the conditional test would refuse it.
    const d = evaluatePullRequest({ ...eligible(), headRef: 'ticket/41', ageMs: 0, checks: {} })
    expect(d.action).toBe('undraft')
  })

  it('still lets protected classification and the needs-owner label win', () => {
    const protectedDraft = evaluatePullRequest({
      ...eligible(),
      changedPaths: ['db/schema.ts'],
      classification: classifyChangedFiles(['db/schema.ts']),
    })
    expect(protectedDraft.action).toBe('escalate-protected')

    const claimed = evaluatePullRequest({ ...eligible(), labels: [NEEDS_OWNER_LABEL] })
    expect(claimed.action).toBe('skip')
    expect(claimed.code).toBe('needs-owner-label')
  })

  it('never merges in the decision that undrafts, same as the machine lanes', () => {
    expect(evaluatePullRequest({ ...eligible(), draft: false }).action).toBe('merge')
    expect(evaluatePullRequest(eligible()).action).toBe('undraft')
  })
})

describe('hasWipMarker', () => {
  it('matches the word wip in any case, in title or labels', () => {
    expect(hasWipMarker('WIP: thing', [])).toBe(true)
    expect(hasWipMarker('[wip] thing', [])).toBe(true)
    expect(hasWipMarker('thing (WIP)', [])).toBe(true)
    expect(hasWipMarker('thing', ['wip'])).toBe(true)
    expect(hasWipMarker('thing', ['WIP'])).toBe(true)
  })

  it('does not match wip inside another word, or a label that merely contains it', () => {
    expect(hasWipMarker('add swipe gesture', [])).toBe(false)
    expect(hasWipMarker('fix wiper blade config', [])).toBe(false)
    expect(hasWipMarker('thing', ['wip-adjacent'])).toBe(false)
  })
})

describe('ageMsFromTimestamp', () => {
  it('computes age from an ISO timestamp', () => {
    const now = Date.parse('2026-08-05T12:00:00Z')
    expect(ageMsFromTimestamp('2026-08-05T11:00:00Z', now)).toBe(3600_000)
  })

  it('clamps a future timestamp to 0 rather than going negative', () => {
    const now = Date.parse('2026-08-05T12:00:00Z')
    expect(ageMsFromTimestamp('2026-08-05T13:00:00Z', now)).toBe(0)
  })

  it('returns 0 (never eligible) for garbage, failing closed', () => {
    expect(ageMsFromTimestamp('', Date.now())).toBe(0)
    expect(ageMsFromTimestamp('not a date', Date.now())).toBe(0)
  })
})
