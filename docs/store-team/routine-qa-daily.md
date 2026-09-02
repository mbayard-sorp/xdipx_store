# Routine — Daily QA Gate (R-QA)

The playbook for the daily verification pass. Entry agent: `qa-reviewer`. Reviews every ticket
sitting in `pr_open` or stranded in `in_review`, and returns a verdict: `verified` with evidence,
or a bounce back to `in_progress` with a concrete reason. **QA never merges, and structurally
cannot**: the transition map gives `qa-reviewer` no path to `applied`, so a verdict is a
recommendation to the release engine, not a ship.

Runs on the **Max subscription**. Cadence: **four passes daily, `30 3,11,16,21 * * *` UTC**
(03:30, 11:30, 16:30, 21:30), raised from two on 2026-08-21 (owner yes on the urgency cadence) on
trigger `trig_019GjVP9hGBU1gmXRBYtYURm`, current prompt uuid `rqa-daily-0004`. The 11:30, 16:30
and 21:30 passes review each R-DEV pass (10:00, 15:00, 20:00) within 90 minutes; the 03:30 pass is
the overnight sweep. History: a single 15:30 pass once left every PR from the 20:00 dev pass
waiting about 19 hours for review (verified on PR #477, 2026-08-03), fixed to two passes
2026-08-05, then to four.

Mission brief: `docs/store-team/mission-brief.md`. The repo rules a diff must satisfy are in
`CLAUDE.md`; visual work is additionally bound by `docs/design-doctrine.md` and copy by
`docs/emma-voice.md`.

## Step 0 — Gate + start

1. `POST /api/team/run {"op":"start","team":"strategy","runType":"qa"}` → `$RUN_ID`.
2. `GET /api/team/gate?team=strategy&excludeRun=$RUN_ID`. On `ok:false` → post a skipped event,
   finish the run honestly, exit cleanly.

## Step 1 — List the queue

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","statuses":["in_review","pr_open"],"orderBy":"priority"}'
```

**Resume crashed reviews first.** List `in_review` alongside `pr_open` and work any `in_review`
rows before touching the fresh queue. A row sitting `in_review` means a previous QA pass opened the
review and died before reaching a verdict; nothing else in the loop will ever move it, so until
this rule existed those rows were stranded until a human noticed. Re-read the row with
`{"op":"get","id":<id>}` and take it straight to a verdict (Steps 3 to 6); do not re-transition it
to `in_review`, it is already there.

**Merged-PR fast-path (run before opening any full review).** (#2503) For every listed row that
carries a `pr` link, hit `/api/team/pr?number=<n>` first. Any row whose PR already shows
`merged:true` is stale bookkeeping, not review work: the release engine merges a docs-only
agent-editor PR on the allowlist path without requiring the ticket to reach `verified` first, and
nothing writes the ticket status forward when it takes that path, so the row sits at `pr_open`
indefinitely. The 2026-08-11 03:30 pass found 16 of 17 queue rows in this state, some merged 3 days
earlier, and burned full review passes re-verifying shipped code. For a `merged:true` row, skip the
diff read and the local checks and take it through a lightweight verified transition instead:
`in_review`, then `verified` with a note of the shape "PR #<n> already merged by the release engine
(docs-allowlist path); CI was green at merge time", still confirming the transition landed per Step
6. The engine-side half of the fix (the engine writing the status forward itself when it merges via
the docs-allowlist path) is release-engine code, a protected path, and owner work; until that
ships, this fast-path is the only drain for these rows.

**PR-number recovery for note-only rows (bounded).** (#3265) A `pr_open`/`in_review` row whose only
link is a `note` (no `pr`-kind link, typically an interactive session that wrote "implemented and
pushed; CI running" instead of attaching the PR URL per ADR-008 step 3) leaves you no direct path
to the PR, since `/api/team/pr` requires a number and `api.github.com` is unreachable. Recover it
with this bounded procedure, in order: (1) `git log --all --grep '<ticket id>'` for a commit naming
the ticket, then `git branch -r --contains <sha>` for its branch; (2) probe `/api/team/pr?number=<n>`
over a window of at most 10 numbers anchored on the nearest known PR number from same-day rows,
checking each result's branch/title against the ticket. Hard cap: 10 probe calls. If the PR still
cannot be identified, do not guess and do not bounce blind; record the row as unreachable in the
run summary with what you tried, and note on the row that the filer must attach the `pr` link
before QA can reach a verdict. (This recovery worked on #3214/#3221 → PR #657 only because the
commit message named both tickets; it does not generalize, which is why the note-only pattern is a
filing defect, not a QA gap.)

Empty queue is a clean, short, successful run. Work in priority order (1 is P0), oldest first
within a priority. Take each ticket to a verdict before starting the next one; a half-reviewed
ticket left in `in_review` blocks the engine.

## Step 2 — Open the review

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"transition","id":<id>,"to":"in_review","actor":"agent:qa-reviewer"}'
```

Then `{"op":"get","id":<id>}` for the row, its `suggestion_links`, and its recent events. The `pr`
link gives you the PR number.

## Step 3 — Read the diff

Pull the branch and read it locally. Git works in a cloud session; the GitHub API does not, because
egress is restricted to xdipx.com.

```bash
git fetch origin ticket/<id> && git checkout ticket/<id>
git diff origin/main...HEAD
```

**Use an isolated worktree, not a shared `git checkout`, whenever more than one ticket is reviewed in
the same pass** — whether by a delegated subagent or sequentially by the main session. A bare
`git checkout ticket/<id>` mutates the one shared working directory, so a second review running in the
same directory (a subagent, or your own next ticket) can flip the tree out from under an in-flight
`typecheck`/`test`/`build` and produce a false PASS or FAIL against the wrong branch. This was
observed live on 2026-08-10: a delegated subagent saw the shared tree jump to `ticket/1526` then
`ticket/633` mid-review and had to build its own worktree to recover. Give each PR its own worktree
under your own scratch path so concurrent or interleaved reviews cannot race:

```bash
git fetch origin ticket/<id>
git worktree add "$QA_WORKTREE_DIR/ticket-<id>" ticket/<id>   # per-PR, per-scratch-path
git -C "$QA_WORKTREE_DIR/ticket-<id>" diff origin/main...HEAD
# ... run static checks inside that worktree; git worktree remove it when done
```

What you are looking for, in rough order of how often it matters:

1. **Does it do what the ticket asked, and only that?** Scope creep is a bounce.
2. **Framework discipline.** Data through `loader` and `useLoaderData`, mutations through `action`.
   Any `useEffect` doing data fetching is a bounce. Any Next.js pattern is a bounce.
3. **Server boundary.** New server-only files end in `.server.ts` and are not imported from client
   components.
4. **Protected paths.** If the diff touches one, the engine will stop and email the owner anyway,
   but say so in your note so the owner knows what they are looking at.
5. **Mobile-first.** Layout work is verified at 375px first, not as an afterthought.
6. **Voice and visual pixels.** Customer-facing copy against `docs/emma-voice.md` (no em-dashes, no
   "Buy now", CTA whitelist, Emma has no lived experience, XDIPX descriptor, no countdowns). Visual
   work against `docs/design-doctrine.md` and the v3 tokens.
7. **Sanity schema is additive only.** A modified existing schema file is a bounce.

## Step 4 — Run static checks

```bash
npm run typecheck && npm test && npm run build
```

Run them yourself rather than trusting the PR body. If one fails, that is your `last_error`, and it
should include the actual error text.

**The stale-artifact bounce.** CI's `check` job also asserts the tree is clean after a build, and
the one file that legitimately goes dirty is `server/vercel-entry.mjs`, a committed build artifact.
When that is the *only* thing wrong with an otherwise-correct PR, the change is not defective and
your `last_error` must say so precisely, so the next dev pass fixes it in one commit instead of
re-diagnosing the ticket:

> CI `check` red only because `server/vercel-entry.mjs` is stale. Logic verified correct. Fix:
> `npm run build && git add server/vercel-entry.mjs && git commit`, then push. No other changes needed.

Bounce it, do not verify it. A red `check` is a hard gate and the release engine will not merge over
it. But an unspecific `last_error` here is what turns a one-commit fix into a burned attempt.

**The base-branch-red bounce (ticket #6934).** A `check:failure` that is not the stale-artifact case
above can still be not-this-PR's fault: the failure is already present on `origin/main` itself, so
every open PR's CI job fails identically regardless of what each PR actually changed. Verify before
bouncing, do not assume it from the error text alone:

1. `git diff origin/main...HEAD -- <failing file>` — confirm the PR does not touch the failing file
   or the behavior it tests.
2. Reproduce the same failure on a clean `origin/main` checkout (not the PR branch) to confirm it is
   not this PR's diff causing it.

Only once both hold, bounce with a `last_error` naming the base-branch failure and the file, so the
next pass does not re-derive the same two steps. Run 636 (2026-09-01) hit this across three PRs at
once (#1010, #1011, #1012), all failing on the same pre-existing `app/lib/storefront-home.server.test.ts:448`
break on main.

**A base-branch-red check is itself a P0/P1 signal.** Do not let it live only inside each PR's own
verdict: file it as its own standalone ticket immediately (as ticket #6933 was for the case above),
since every other open and future PR's CI is red until it is fixed, not just the one you happened to
be reviewing.

## Step 5 — CI status and the rendered preview

Cloud routines can only reach xdipx.com, so **`/api/team/pr` is the only path that works** for CI
state and preview HTML. Never call `api.github.com` or the Vercel API from here; it will fail, and
retrying it just burns the run.

```bash
# CI conclusions, changed files, mergeable state, preview URL, protected-path classification
curl -s "$BASE_URL/api/team/pr?number=<n>" -H "x-team-secret: $TEAM_TOKEN"

# Server-side fetch of the preview deployment, returned as status + bytes + markers
curl -s -X POST "$BASE_URL/api/team/pr" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"preview-fetch","number":<n>,"path":"/"}'
```

For anything that changes rendering, fetch the affected routes and confirm the expected markers are
actually present in the HTML. "The build passed" is not evidence that a page renders. That
distinction is exactly what a three-day homepage breakage cost us once.

**The lighthouse check.** Per `.github/workflows/lighthouse.yml`, "Lighthouse stays NON-required for
merge": it is informational, not a gate. (a) If the PR diff has no rendering surface, no
`app/components` or `app/routes` changes touching markup or styles, a failing lighthouse check
alongside a green `check` job is not disqualifying; note it and move on. (b) If the PR is itself
attempting to fix the sitewide lighthouse regression (currently ticket #603 and any successor),
lighthouse must be evaluated as real evidence rather than noise, since it is that ticket's own
done-when, and `lighthouserc.json`'s 5-run median aggregation means a single failing run on that PR
is signal.

## Step 6 — Verdict

**Conversion tracking.** Once per run, not per ticket: confirm (1) no unresolved
`meta_capi_failures` or `ga4_purchase_failures` rows older than one hour; (2) if any paid Shopify
order landed in the last 24h, it has a resolved ledger row; (3) `POST /cron/purchase-reconcile` with
`dryRun: true` reports zero gaps for orders inside the Meta 7-day window. Zero Purchase events is
not a failure on a day with zero orders; this check is orders-versus-reported, never an absolute
count.

Sub-check (1) **is reachable now** (route shipped 2026-08-19, ticket #4177 / PR #773). Call the
authenticated route instead of recording `unverified`:

```bash
curl -s "https://xdipx.com/api/team/conversion-status" -H "x-team-secret: $TEAM_TOKEN"
# -> {metaCapiUnresolvedCount, metaCapiOldestAgeHours, ga4UnresolvedCount, ga4OldestAgeHours}
```

Read the pass/fail off the response: **PASS** when both `metaCapiUnresolvedCount` and
`ga4UnresolvedCount` are `0`, or nonzero but with `oldestAgeHours` under the one-hour threshold (the
retry queue is still inside its window and working). **FAIL** when either count is nonzero and its
`oldestAgeHours` has grown past one hour (the queue is stuck, not draining). Report the four numbers
in the verdict rather than a bare PASS/FAIL. Only if the route itself is unreachable (non-200) do you
fall back to `unverified: no cloud-reachable route` and say so. Sub-checks (2) and (3) run over
xdipx.com endpoints and stay verifiable.

**When this sub-check would file a ticket for the route itself (a 500 / non-200), do not mint a fresh
`code` row each pass.** The `/api/team/conversion-status` 500 traces to an owner-only infra cause
(migration 082, the capi/ga4 outbox rename, merged but not applied in prod), already tracked on the
owner blocker list; R-DEV cannot apply an infra migration, so a `code` ticket only burns a claim it
must block, and three of them landed across two runs (#5061, #5099, #5146) on three different
dedupeKeys so the bus never deduped. Before filing: (a) `GET /api/team/blocker` and, if an open
migration/outbox blocker exists, **do not file** — record `unverified: conversion-status 500,
tracked on owner blocker #<n>` and move on; (b) only if no such blocker is open, file a single row
under the **stable** `dedupeKey:"conversion-status-500"` (so repeat detections collapse to one row)
and as `kind:"instructions"` (ops/infra), never `kind:"code"`.

**Protected-path PRs get an extra checklist (added 2026-08-19, narrowed 2026-08-21).** Since owner
direction 2026-08-19, R-DEV authors protected-path diffs instead of blocking them; the engine still
never merges these, it escalates them to the owner. The list itself is cost-only now, so this
checklist applies to a smaller set than it did: valves and budgets, the enforcement core
(`github.server.ts`, `release-engine.server.ts`, `migration-classify.server.ts`, `.github/**`),
secrets, the checkout probe, the deploy-critical build scripts, and non-additive migrations.
Checkout and cart code, auth/session, `db/schema.ts`, `vercel.json`, and `package.json` are
ordinary code PRs now: review them as such, and do not bounce one for missing a protected-path
section it no longer needs. Your `verified` verdict is what makes the
owner's merge a one-click read instead of a re-derivation, so it carries more weight here, not
less. In addition to the normal checks, require ALL of:

1. The PR body opens with a "Protected-path diff" section naming the protected invariant, how the
   diff preserves it, and the evidence. Missing or vague section is an automatic bounce.
2. The diff does not widen agent permissions or weaken a gate: no `PROTECTED_GLOBS` edits, no new
   agent write path to `pipeline_settings`, no valve default changes, no transition-map loosening,
   no money-valve semantics changes. If it does any of these, bounce it and say which line; that
   class is owner-decided, not agent-authored.
3. For auth/session diffs: these are no longer protected, but the invariant question is still the
   right one to ask in an ordinary review. State in your note what you checked (e.g. "admin session
   cookie scope unchanged").
4. **For migration diffs, check the classifier's own verdict before anything else.** A
   migration-only PR whose SQL is entirely additive is NOT escalated: it merges on the ordinary
   lane once `migration-dry-run` is green, so your `verified` verdict is the last human read it
   gets. Confirm the `migration-dry-run` check passed (not just `check`), and read the SQL yourself
   for the things "additive" does not cover: a new NOT NULL column with no default on a populated
   table, an index that will lock, a column name that collides. A migration that escalates instead
   (anything with a DROP, RENAME, ALTER TYPE, DML, or a modification to an already-merged migration
   file) goes through the full checklist above and ends at the owner.

A protected PR you verify still ends at the owner: the engine labels it `needs-owner` and emails
once. Say in your verdict note that the checklist passed, so the owner's email reads as
"pre-verified, read and merge".

**PASS needs evidence.** A verdict of `verified` without the specific things you checked is worse
than no verdict, because the engine merges on it.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"transition","id":<id>,"to":"verified","actor":"agent:qa-reviewer",
       "note":"typecheck/test/build green; CI check green at <sha>; preview / returns 200 with hero handle <handle> and 3 rail titles; 375px layout confirmed; copy passes charter",
       "links":[{"kind":"pr","ref":"<PR URL>","state":"ci_green"}]}'
```

**FAIL is a bounce, and it must be concrete.** "Looks wrong" is useless to the agent that has to fix
it at 20:00. Name the file, the check, the expected value, and the observed value.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"transition","id":<id>,"to":"in_progress","actor":"agent:qa-reviewer",
       "lastError":"npm test fails: app/lib/foo.test.ts \"resolves the slug\" expected /products/x, received /vault/x. Also StorefrontHome.tsx:212 fetches in useEffect; must move to the loader."}'
```

**Confirm every transition landed.** After either call above, immediately re-read the row with
`{"op":"get","id":<id>}` and confirm the returned `status` and `verifiedBy` (or `lastError` and
`attemptCount` for a bounce) match what you just sent, before reporting the verdict in the run
summary or to the coordinator. If the re-read does not reflect the intended state, retry the
transition and re-check; do not report a verdict as delivered until the get-based re-read confirms
it landed.

A bounce increments `attempt_count` and hands the ticket back to its assignee under a fresh
six-hour lease, so the 20:00 dev pass finds it still `in_progress` and still theirs. At three
attempts the release engine's hourly sweep blocks the ticket and emails the owner. Spend the extra
minute making the first bounce complete: you get three, and the third one ends in the owner's inbox.
If you find a second, unrelated problem, list it in the same `last_error` rather than bouncing
twice.

Findings that are real but **out of scope for this PR** are filed as new tickets, not held against
the diff in front of you:

The create op takes `category` and `suggestion`, not `title` and `body`. A row missing either is a
`400 Bad Request: category and suggestion required`, so the finding is lost rather than filed.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"homepage","kind":"code","dedupeKey":"qa:<slug>","priority":3,
       "category":"<short label, e.g. rendering>",
       "suggestion":"<what is wrong, where, and what done looks like>"}'
```

## Step 7 — Retro + spend + finish

1. Retro: which bounce reasons repeat, and what instruction change would stop them recurring. File
   the real ones as `instructions` suggestions.
2. Log tokens under `feature:'strategy-qa'`.
3. Final run update: a table of ticket id | PR | verdict | evidence or `last_error`, plus any
   ticket you could not reach a verdict on and why.

## Hard rules

- **Never merge. Never push to any branch.** You read, you run checks, you record a verdict.
- **You cannot reach `applied`.** If you think a ticket is done, `verified` is the end of your
  authority; the engine decides and the deploy proves it.
- **PASS requires evidence** naming the specific checks you ran and what you observed.
- **FAIL requires a concrete `last_error`** that the dev pass can act on without asking you.
- **Only `/api/team/pr` for GitHub and preview state.** Never `api.github.com`, never the Vercel API.
- **Never flip a ticket `proposed → approved`, never write `pipeline_settings`.**
- **A PR body is not evidence.** Verify claims rather than repeating them.
