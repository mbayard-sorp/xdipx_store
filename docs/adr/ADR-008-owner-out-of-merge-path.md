# ADR-008: Getting the owner out of the merge path

**Date:** 2026-07-30
**Status:** Partially accepted. Step 1 is implemented in the same PR as this document. Steps 2, 3
and 4 are proposed and await an explicit owner decision, because each of them widens what can reach
production without him and that is his call to make, not the architect's.
**Owner:** tech-architect
**Implementation owner:** rr7-engineer cannot implement any of this: every file involved is a
protected path, and `routine-dev-daily.md` Step 2 requires R-DEV to block rather than code on those.
Protected-path work has no agent lane and has to be written in an owner-attended session, then
merged by the owner. That is a finding of this ADR, not an oversight in it.

**Implementation status**

| Step | State |
|---|---|
| 1. Widen the reconciliation sweep to `pr_open`/`in_review` | **Implemented** 2026-07-30 |
| 2. Auto-file a ticket for ticket-less eligible PRs | **Implemented** 2026-08-04 |
| 3. Self-service filing convention | **Implemented** 2026-08-04 |
| 4. Add `fix/` to the branch prefixes | **Implemented** 2026-08-04, and `pm/` with it |

**Status as of 2026-08-04: accepted in full.** The owner said yes to steps 2, 3 and 4 on
2026-08-04, five days after they were written. All three shipped in the same owner-attended session,
which is the only lane permitted to author the protected-path halves. See the addendum at the foot of
this document for what changed in the design between proposal and implementation.

---

## Context

The release engine (`app/lib/release-engine.server.ts`, `evaluatePullRequest`) is real, tested, and
`ON` in production (`release_engine_enabled=true`, cap 12/day). It is not the bottleneck. The
bottleneck is upstream: of the last 60 merged PRs, 18 (30%) were on branches the engine never even
looks at (`fix/`, `docs/`, `chore/`, `ci/`, a stray personal patch branch), and 35 (58%) were on
eligible branches (mostly `claude/*`, born in the owner's own interactive sessions) that carried no
linked ticket. Only 7 of 60 (12%) were engine candidates at all. All 60 were merged by hand.

The root cause is origin, not mechanics: work born in an interactive Claude Code session never
touches the ticket bus (`homepage_team_suggestions` / `suggestion_links`), so it can never acquire the
`verified` status `evaluatePullRequest` requires. Compounding this, the one reconciliation sweep that
exists (`app/lib/ticket-out-of-band-sweep.server.ts`, `sweepOutOfBandMerges`) only looks at tickets in
status `verified`. Tickets #291, #323, #441 are stuck at `pr_open` with their PRs (#413, #414, #420)
already merged days ago, because they were merged by hand *before* QA ever touched them, and the sweep
does not check `pr_open`/`in_review`. The bus's model of reality is wrong for exactly the PRs the owner
merged himself, which is the majority case today.

Protected paths are enforced by `classifyChangedFiles` in `app/lib/github.server.ts` against
`PROTECTED_GLOBS`, checked first and unconditionally in `evaluatePullRequest`. Nothing in this ADR
touches that list or that ordering.

> **Updated 2026-08-21.** When this ADR was written the list read: checkout, cart,
> `db/migrations/**`, `db/schema.ts`, auth/session, `app/lib/team.server.ts`,
> `app/lib/release-engine.server.ts`, `app/lib/github.server.ts`, `.github/**`, `vercel.json`,
> `package.json`, spend/valve files. It is cost-only now (owner direction 2026-08-19): the cost
> gate, the enforcement core, secrets, the checkout probe, the deploy-critical build steps, and
> `db/migrations/**` refined by content. Checkout and cart code, auth/session, `db/schema.ts`,
> `vercel.json`, and `package.json` no longer stop for the owner. See §4 of
> `docs/store-team/operating-system.md`. The ordering this ADR relies on is unchanged: the
> classifier still runs first and still overrides everything.

## Decision

Ship four changes, in this order. Each is additive, each keeps the protected-path gate first and
unconditional, and none of them let a protected-path PR merge without the owner.

### 1. Fix the reconciliation sweep to cover `pr_open`/`in_review`, not just `verified` (ship first)

**File:** `app/lib/ticket-out-of-band-sweep.server.ts`
**Function:** `findStrandedVerifiedTickets` — widen the status filter from
`eq(homepageTeamSuggestions.status, 'verified')` to
`sql`${homepageTeamSuggestions.status} IN ('pr_open','in_review','verified')`` (rename to
`findStrandedShippedTickets` since it's no longer verified-only).
**Function:** `sweepOutOfBandMerges` — when the recovered status is `pr_open` or `in_review`, write a
distinguishable note (`"merged out-of-band from pr_open — QA never reviewed this ticket"`) instead of
the current note, so the digest can tell "reconciled after QA" apart from "reconciled, QA skipped
entirely." Both still only fire when GitHub itself reports `pr.merged === true` — this can never mark
unmerged work as shipped.

**Schema change required:** `app/lib/team.server.ts`, the `ALLOWED` transition map. Today
`pr_open` and `in_review` have no edge to `applied` for actor `system` (only `agent:agent-editor` with
`AGENT_EDITOR_APPLY_KINDS`, a legacy docs-only path). Add:
```
pr_open:   [..., { to: 'applied', actors: ['system'] }],
in_review: [..., { to: 'applied', actors: ['system'] }],
```
with a comment restricting this edge to `sweepOutOfBandMerges` alone (the normal release-engine cycle
never calls `transitionSuggestion(..., 'applied')` from these two statuses itself).

**Why this is safe, not a gate weakening:** the ticket only ever moves to `applied` because GitHub
confirms the PR is *already merged into main* — which for a `pr_open`/`in_review` ticket only happens
today when the owner merged it by hand. A human merge is a strictly stronger gate than an agent QA
verdict. This closes the record to match reality; it does not let anything new ship.

**New failure mode:** a ticket can now reach `applied` having never been reviewed by QA at all. This is
already true in practice (that's literally what #291/#323/#441 are), so the change makes it *visible*
instead of silently wrong. Mitigate by keeping the distinguishable note above and, in the owner digest,
counting "reconciled without QA" separately from "reconciled after QA" so a rising QA-skip rate is
visible as a trend, not just individually silent.

**File to touch:** `app/lib/team.server.ts` is a protected path — this specific PR needs the owner's
one-time hand-merge (as does any protected-path change), which is appropriate: it's a change to the
state machine's trust boundary, not routine ticket traffic.

### 2. Auto-file a ticket for any ticket-less eligible PR, at PR-discovery time (the core fix, 58% of the gap)

**New file:** `app/lib/release-ticket-autofile.server.ts` (deliberately NOT inside
`release-engine.server.ts`, which is itself a protected path — keeping the tunable logic in a plain
file means future tuning goes through the normal release-engine merge lane instead of the owner's
queue every time).

**New function:** `autoFileTicketsForEligiblePrs(prs: PullRequestSummary[]): Promise<void>`. For each
PR: skip if `isRevertBranch`, skip if `draft`, skip if it already carries `NEEDS_OWNER_LABEL`, skip if
`classifyChangedFiles(...).protected` (a protected PR escalates regardless — filing a ticket for it
buys nothing and would be noise), skip if `isDocsOnly(paths) && requiresAllowlistCheck(headRef)` (the
existing docs carve-out already needs no ticket), skip if `resolveTicketForPr(pr)` already resolves one
(don't double-file), skip if the PR already carries an `auto-ticketed` label (idempotency across
10-minute cycles). Otherwise, call one new function in `app/lib/team.server.ts`:

**New function:** `fileTicketForOpenPr({ prNumber, prUrl, prTitle, headRef }): Promise<number>` — a raw
insert (same pattern as the existing `createSuggestionDetailed`, not a `transitionSuggestion` call,
since there is no prior status to transition from) that writes the row directly at
`status: 'pr_open'`, `kind: 'code'`, `decidedBy: 'auto'`, `assignee: 'owner'`, plus a
`suggestion_links` row `{ kind: 'pr', ref: prUrl, state: 'open' }` so `resolveTicketForPr`'s
authoritative (link-table) lookup finds it on the *next* engine cycle. `assignee: 'owner'` is what lets
the human close the loop for free later (see failure mode 3 below) — no new auth surface, `'owner'` is
already a valid `TicketActor`.

Call site: one new line inside the existing release-engine cycle, right after
`listOpenPullRequests(...)` and before the per-PR `evaluatePullRequest` loop —
`await autoFileTicketsForEligiblePrs(prs)`. This is the only line that touches the protected
`release-engine.server.ts` file; everything else lives in the new unprotected file.

**Why `pr_open` and not `proposed`/`approved`:** the work is already done and the PR already exists.
Routing it through `proposed → approved → in_progress` would be theatre — there is no claim to make,
no assignee to pick. `pr_open` is the literal truth: a PR is open, waiting on QA.

**New failure modes and mitigations:**

1. **QA queue burst.** R-QA (`docs/store-team/routine-qa-daily.md`) runs once a day with no documented
   per-run cap, unlike R-DEV's 3-tickets-per-pass. A burst of ad hoc PRs in one day could overrun one
   run's budget and leave a ticket stuck `in_review` (which the QA doc itself says "blocks the
   engine"). *Mitigation:* give R-QA the same per-run cap R-DEV has; overflow just waits a day, which
   is a throughput cost, not a safety regression, since `no-ticket`/`ticket-not-verified` PRs sit
   harmlessly unmerged.
2. **Abandoned-PR litter.** A PR opened, never merged, later closed — its auto-filed ticket sits at
   `pr_open` forever. *Mitigation:* a companion sweep, `dismissTicketsForClosedUnmergedPrs()` (same
   file), symmetric to the merge-reconciliation sweep: any auto-filed ticket whose PR is closed and
   `merged !== true` transitions to `dismissed` (actor `system` — needs one more `ALLOWED` edge from
   `pr_open`, guarded the same way).
3. **Bounce has no automated re-claimant.** If QA fails an auto-filed ticket, it returns to
   `in_progress` per the existing `in_review` rule. The only actor who can move `in_progress → pr_open`
   again is `assignee`, which is why step 2's `assignee: 'owner'` matters: the owner (with the team
   token, the same credential every agent already uses against `/api/team/suggestion`) can call
   `{"op":"transition","id":<id>,"to":"pr_open","actor":"owner"}` himself after pushing a fix. This is a
   *5-second API call*, not a merge — a strict reduction from today, but it is a new step that did not
   exist before. Worth a thin CLI wrapper (`scripts/requeue-ticket.ts <id>`) so it's one command, not a
   curl invocation.
4. **Untrusted PR metadata feeding a new write path.** PR title/branch name become opaque `suggestion`
   text on the new row (same pattern as everywhere else in the bus — never executed, only rendered
   through `escapeHtml` downstream). No new class of risk versus the existing title-ref parser, which
   is already documented as "can only ever ADD a requirement."

### 3. Self-service ticket filing as a convention, not new code (ship after step 2 is proven)

Update the worktree/PR-opening convention (`CLAUDE.md` merge-policy section, or the
`using-git-worktrees` skill) so an interactive session that opens a PR on an eligible branch files its
own ticket immediately via `POST /api/team/suggestion {op:"create", kind:"code", ...}` plus a `pr`
link, rather than waiting for the engine's autofile fallback. This gets better metadata (the session
knows the real priority/category; the autofile fallback has to guess) but changes no gate — step 2
remains the backstop for anyone who forgets, or who opens a PR with a bare `gh pr create`. No new file;
this is a documentation change, and it doesn't need to gate anything since step 2 already covers the
failure case.

### 4. Narrow the branch-prefix widening: add `fix/` only

**File:** `app/lib/release-engine.server.ts`
**Constant:** `AGENT_BRANCH_PREFIXES` — add `'fix/'`.

FACT 4's ineligible-branch bucket is `fix/`, `docs/`, `chore/`, `ci/`, and one stray personal patch
branch — 18 of 60, but not a systemic pattern the way `claude/*` is. Of those, `fix/` is the one Mike
actually uses repeatedly (`fix/pricing-audit-log-prune` is named in the diagnosis). `docs/`, `chore/`,
`ci/` are rare, and when they do fire they mostly touch already-protected globs
(`package.json`/`package-lock.json` for `chore/`, `.github/**` for `ci/`), so formalizing them buys
little. Do not widen to those three; revisit if the pattern recurs.

**New failure mode:** any `fix/*` branch — from anyone, not just the owner — becomes engine-visible,
and combined with step 2 becomes auto-ticketable and (once QA-verified or reconciled) auto-mergeable.
In a single-owner private repo this is low risk today; it should be named explicitly because it is the
one part of this design that widens *whose* branches the engine will look at, not just *how* a ticket
gets attached to them.

### Explicitly rejected as part of this problem

- **(f) Draining the 140-ticket suggestion backlog / raising R-DEV's claim cap.** That backlog is
  `instructions`/`campaign`/`config`-kind rows from the content/homepage/social/strategy teams — a
  throughput problem in `agent-editor`'s apply loop, unrelated to why the owner merges `claude/*` PRs
  by hand. Conflating it here would dilute both fixes. File it as its own ticket if it needs to move.
- **(b), widened further.** See above — `docs/`, `chore/`, `ci/` are deliberately left off
  `AGENT_BRANCH_PREFIXES` for now.
- **(d), as a new label.** Not needed as new work: `NEEDS_OWNER_LABEL` (`needs-owner`) already exists
  and is already checked first in `evaluatePullRequest` (`code: 'needs-owner-label'`). It is the
  correct *opt-out* — the owner can force any PR to wait for him by applying it — and nothing here
  needs a new opt-*in* marker, because step 2 makes "engine, this one is yours" the default for every
  eligible branch rather than something that has to be asked for.

## Is agent QA a real gate or theatre?

**Real, but narrow.** `qa-reviewer` (`docs/store-team/routine-qa-daily.md`) is structurally prevented
from merging — the `ALLOWED` transition map gives it no edge to `applied`, only to `verified` or a
bounce to `in_progress`. Its playbook requires it to *run* `npm run typecheck && npm test && npm run
build` itself rather than trust the PR body, and to fetch the rendered preview via `/api/team/pr
preview-fetch` and assert specific markers are present — that is closer to verification than a diff
read. PASS requires citing the specific checks and values observed; FAIL requires a concrete,
actionable `last_error`. That evidentiary requirement is a real (if soft) defense against a lazy
rubber-stamp.

**Its actual failure mode:** the "evidence" is self-reported prose from one LLM run, with nothing
downstream that re-executes or audits it. `evaluatePullRequest` checks `ticket.status === 'verified'`
and nothing else — it never inspects the note's content. A run that (prompt drift, a bad day, model
error) writes a fabricated PASS citing checks it did not actually run would sail straight through,
because nothing checks the checker. Separately, R-QA is gated by the same per-team run-cap/gate
machinery that has already caused a real incident elsewhere in this codebase (a silent same-day
skip) — a silent gate-skip means a ticket sits at `pr_open` with **no** review and no owner-visible
signal that review didn't happen, until something else (like this ADR's reconciliation sweep) surfaces
it.

**Does post-deploy smoke + auto-revert make an agent QA verdict sufficient?** Sufficient for "won't
brick the site," not for "is correct." `runReleaseSmoke` asserts home renders, `/discover` renders,
`renderTruth` markers are present, one resolvable PDP returns a variant id, and the checkout probe
passes. That is a strong mechanical backstop against exactly the failure class that has hurt this store
before (the 3-day homepage breakage the QA doc itself cites, the checkout-404 revenue blocker). It
asserts nothing about: a wrong metafield write, a pricing bug that still returns 200, a broken
admin-only screen, an SEO regression, analytics/GA4 breakage, or a voice-charter violation in customer
copy. For any of those, a wrong or fabricated QA verdict has nothing else standing behind it before
it's live and staying live. That is an acceptable trade for a solo-owner shop optimizing for owner-hours
— it should just be named, not assumed away. The cheap mitigation, consistent with how this file
already evolved (checkout-probe was added after the checkout-404 incident), is to widen `runReleaseSmoke`
opportunistically after each incident rather than trying to make the QA verdict itself unfalsifiable.

## Consequences

- After steps 1–2, the two largest buckets in FACT 4 and FACT 7 close: 58% of ineligible-by-ticket PRs
  get a ticket automatically, and the three known zombie tickets (#291/#323/#441) — and any future ones
  like them — get reconciled to `applied` instead of sitting as phantom review work.
- The owner's remaining touches are: (a) protected-path PRs, unchanged and correct; (b) the rare QA
  bounce on his own interactive-session work, now a single API call instead of a merge; (c) anything he
  chooses to label `needs-owner`.
- Two files that are permanently protected (`app/lib/team.server.ts`, `app/lib/release-engine.server.ts`)
  each need one small, owner-reviewed change to ship this. That is expected and correct — this ADR
  is changing the trust boundary itself, which is precisely what should never auto-merge.
- Follow-up, out of scope here: a per-run cap for R-QA (mirroring R-DEV's), a `requeue-ticket.ts` CLI
  wrapper for the bounce-reclaim step, and a separate look at the 140-ticket suggestion backlog.

## Alternatives considered

See the option list (a)–(f) above; (a)+(e) are the shipped core, (c) is a convention layered on top,
(b) is narrowed to one prefix, (d) and (f) are explicitly not built.

---

# Addendum, 2026-08-04: what five days of running taught us

Written after the owner asked, again, "is the code release automation working? I see a backlog of
PRs. I don't want to be the bottleneck." Steps 2, 3 and 4 above were still unshipped, having waited
five days for an owner decision that was never explicitly asked for as a decision. That delay is
itself the finding: **the fix for the owner being a bottleneck was blocked on the owner.** If nothing
else in this addendum is acted on, ask the question as a yes-or-no next time.

## The engine is working. Measured, not assumed.

Between 22:30 UTC 2026-08-03 and 01:31 UTC 2026-08-04 the engine merged seven PRs autonomously, one
every 30 minutes, with no owner involvement. `release_engine_enabled` is on and the merge lane is
healthy. The perceived backlog was three unrelated things read as one list. See
`operating-system.md` §10 for the drain-rate arithmetic, which is now written down so this question
has a standing answer.

## Three findings this ADR did not anticipate

**Finding A: the silent branch-prefix drop is worse than the ticket-less-PR problem.** ADR-008 treats
prefix ineligibility as a merge problem to be solved by widening the list. It is first an
*observability* problem. `listOpenPullRequests` filters by prefix before building any
`PullRequestFacts`, so an ineligible PR produces no label, no email, no decision-log line and no
digest row. Protected-path PRs escalate loudly and ticket-less PRs at least log; this bucket is
silent everywhere simultaneously. Silence is indistinguishable from "the automation is broken", which
is exactly the reading the owner arrived at. **Fix the signal before widening the list.** A PR the
engine has decided not to touch should say so somewhere the owner reads.

**Finding B: the program-manager tracker lane has never worked, and two playbooks said it did.**
`pm/tracker-<date>` is not an eligible prefix, and independently the allowlist regex
`docs/store-team/[^/]+\.md` does not cross into the `trackers/` subdirectory, so the lane is dead on
two counts. Zero tracker PRs have ever merged. `routine-weekly-strategy.md` and `program-manager.md`
both asserted the release engine merged them; both were corrected 2026-08-04. This is the failure
mode the operating-system honesty rule exists to prevent, reappearing in playbooks rather than in
that document. Worth noting what it cost: the tracker is how multi-week program status reaches the
owner, so the one surface that reports whether deferred scope is landing could not update itself.

**Finding C: R-QA's cadence does not match R-DEV's.** R-DEV runs at 14:00 and 20:00 UTC, R-QA only at
15:30. A `code` ticket cannot reach `verified` without QA, so the entire 20:00 dev pass waits about
19 hours. Pass two structurally cannot land same-day, and no gate is doing this, it is just a gap
between two cron expressions. This is the cheapest latency win available and it touches no protected
path: it is a trigger schedule, not code.

## What changed in the recommendation

**Step 2 (autofile) is still right, but size the claim down.** Since 2026-07-29, auto-approve and
`suggestion_apply_enabled` are on for all five teams and R-DEV self-claims `code` tickets onto
`ticket/<id>` branches, so more agent output now arrives pre-ticketed than when the 58% figure was
measured. The remaining gap is concentrated in the owner's own interactive `claude/*` sessions.
Re-measure before quoting 58% again.

**Step 4 changes shape.** Do not keep adding prefixes reactively one at a time. `pm/` is a second
instance of a bucket this ADR explicitly declined to solve broadly, which means the pattern recurred
and the reasoning for narrowing should be revisited. Add `pm/` and `fix/` for *visibility*, and treat
undrafting as a separate, narrower decision: `pm/` and `claude/` are owner-attended lanes where a
draft is plausibly deliberate work in progress, so leave them out of `autoReadyOnDraft`.

## Explicitly not recommended

**A fast lane that skips deploy and smoke for docs-only merges.** It would raise throughput and it is
a real weakening of the smoke gate's one clean invariant, which is that it runs on every merge with
no exceptions. That uniformity is itself a safety property. If the owner wants it, that is an
attended decision with the tradeoff stated, not a throughput tweak.

**Merging more than one PR per cycle, or shortening the cron.** Both increase production deploy
frequency and consume the two-rollback circuit breaker faster. A burst of merges against a flaky
smoke check would trip the breaker and disable the engine, which is the opposite of the goal.

**Widening `PROTECTED_GLOBS`, in either direction.** Nothing here needs it. (The list was in fact
narrowed on 2026-08-19, by separate owner direction, not by anything in this ADR.)
