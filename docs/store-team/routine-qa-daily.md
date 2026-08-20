# Routine — Daily QA Gate (R-QA)

The playbook for the daily verification pass. Entry agent: `qa-reviewer`. Reviews every ticket
sitting in `pr_open` or stranded in `in_review`, and returns a verdict: `verified` with evidence,
or a bounce back to `in_progress` with a concrete reason. **QA never merges, and structurally
cannot**: the transition map gives `qa-reviewer` no path to `applied`, so a verdict is a
recommendation to the release engine, not a ship.

Runs on the **Max subscription**. Cadence: **two passes daily, `30 3,15 * * *` UTC** (03:30 and
15:30), changed 2026-08-05 on trigger `trig_019GjVP9hGBU1gmXRBYtYURm` (prompt uuid
`rqa-daily-0002`). The 15:30 pass reviews the 14:00 dev pass's PRs within 90 minutes; the 03:30
pass exists because a single 15:30 pass left every PR from the 20:00 dev pass waiting about 19
hours for review, so pass two structurally could not land same-day (verified on PR #477,
2026-08-03).

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

Sub-check (1) is **not reachable from a cloud session today**: there is no `/api/team/*` route that
exposes `meta_capi_failures` / `ga4_purchase_failures`, and a direct `psql` to `DATABASE_URL` from a
cloud routine hangs and times out because egress is restricted to xdipx.com. When you cannot reach the
tables, **record sub-check (1) as `unverified` and say why — never guess PASS/FAIL on it.** The fix is
a code ticket (a small authenticated `GET /api/team/conversion-status` returning the unresolved-count
and oldest-age for both tables); until it ships, an honest "unverified: no cloud-reachable route" is
the correct verdict on this sub-check. Sub-checks (2) and (3) run over xdipx.com endpoints and stay
verifiable.

**Protected-path PRs get an extra checklist (added 2026-08-19).** Since owner direction 2026-08-19,
R-DEV authors protected-path diffs (except the DB carve-out) instead of blocking them; the engine
still never merges these, it escalates them to the owner. Your `verified` verdict is what makes the
owner's merge a one-click read instead of a re-derivation, so it carries more weight here, not
less. In addition to the normal checks, require ALL of:

1. The PR body opens with a "Protected-path diff" section naming the protected invariant, how the
   diff preserves it, and the evidence. Missing or vague section is an automatic bounce.
2. The diff does not widen agent permissions or weaken a gate: no `PROTECTED_GLOBS` edits, no new
   agent write path to `pipeline_settings`, no valve default changes, no transition-map loosening,
   no money-valve semantics changes. If it does any of these, bounce it and say which line; that
   class is owner-decided, not agent-authored.
3. For auth/session diffs: the body states the specific invariant preserved (e.g. "admin session
   cookie scope unchanged") and you confirmed it against the diff.
4. For migration diffs (only after the DB carve-out lifts): dry-run evidence against a scratch
   Postgres is present in the body or CI.

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
