# Routine — Apply Pass (agent-editor)

The playbook for the scheduled apply pass — the hands of the improvement loop. Entry agent:
`agent-editor`. Turns **owner-approved** instruction-kind suggestions into **one PR per target
file**, batching every approved row that edits the same file (Step 2); never merges its own PR and
never pushes to the default branch; never touches code,
schema, settings, or secrets. Gated by the `suggestion_apply_enabled` valve (default off) on top of
the strategy team's gate.

The PR is merged by the **release engine** (server-side cron, kill switch `release_engine_enabled`)
once CI is green and the `agent-allowlist` check confirms every changed file is inside the allowlist.
A PR that touches a protected path stops and emails the owner, who merges it by hand. With the engine
off, the PR waits for the owner exactly as it always did. See `docs/store-team/operating-system.md`.

Runs on the **Max subscription**. Recommended cadence: weekly, after the owner's suggestion-review
session (e.g. Monday afternoon).

## Step 0 — Valve + start + gate

1. If the `suggestion_apply_enabled` pipeline setting is not `true` → do not even start a run; stop.
2. `POST /api/team/run {"op":"start","team":"strategy","runType":"apply"}` → `$RUN_ID`.
3. `GET /api/team/gate?team=strategy&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 1 — Fetch work

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","status":"approved"}'
```

Yours: kind `instructions` | `agent-def` | `config` (doc-level only). Everything else is skipped
silently (kind `code` waits for a human + rr7-engineer; `campaign`/`promo`/`program` are the
owner's to execute).

## Step 1.5 — Hygiene pass (before implementing anything)

The bus accumulates rows no lane will ever execute. `kind` used to be write-once, so a row filed as
`process` when it was really instruction or code work could never reach the lane that would have
done it, and nothing could close a row in a kind with no automated executor. 52 approved `process`
rows built up that way with zero completions ever. Two ops fix it; use them first, capped at **25
rekinds and 25 retires per run**, and **work to the cap** the same way Step 2 tells you to work to
the 15-PR ceiling.

The cap was 10/10 until 2026-08-02 and had never once bound: run 134 did 8 rekinds and 8 retires
against it and stopped short of both. The constraint was caution, not the number. Raising it is the
cheapest lever on the whole bus, because this is the **only** drain that exists for
`process`/`strategy`/`program`, and because a rekind does not merely close a row, it moves the row
into a lane that has an executor (`process` → `instructions` for you, `process` → `code` for R-DEV).
It converts dead inventory into drainable inventory at roughly 20k tokens an op, with no PR, no CI,
and no deploy. If you hit 25 of either, say so in the run summary so the ceiling can be raised again
on evidence.

1. List the approved rows in the three kinds you may dispose of — `process`, `strategy`, `program`
   (`AGENT_RETIRE_KINDS` in `app/lib/team.server.ts`). One call per kind:
   ```bash
   -d '{"op":"list","status":"approved","kind":"process"}'
   ```
   Only `process` can be **rekinded** (`REKIND_FROM_KINDS`). A `strategy` or `program` row can be
   retired but not re-filed, so for those the choice is retire or leave.
2. **Re-file the misfiled.** A row asking for a playbook or agent-definition edit is `instructions`;
   one that needs code is `code` (it will then be claimed by R-DEV, not by you):
   ```bash
   -d '{"op":"rekind","id":123,"kind":"instructions","actor":"agent:agent-editor","note":"playbook edit, not an owner decision"}'
   ```
   Rekind is one-way (`process` → `instructions`|`code`) by design. You cannot rekind *into* a
   retirable kind, because that plus a retire would let you dismiss the instruction rows aimed at
   you.
3. **Retire what is genuinely finished or moot** — a run-observation that was only ever a note to
   nobody, a duplicate, or something superseded by shipped work:
   ```bash
   -d '{"op":"retire","id":124,"actor":"agent:agent-editor","note":"superseded by #131, which shipped 07-28"}'
   ```
   The note is required: a retirement with no stated reason is indistinguishable from a mistake, and
   every retire you make is listed in the next owner digest. When unsure, leave it — an aging row is
   cheap, a wrongly-closed one is invisible.
4. **Never retire** a row that names a live customer-facing defect (out-of-stock product in a live
   slot, a broken page, a money-path bug) even if it is old. Rekind those to `code` instead.

## Step 2 — Implement (batched by target file, max 15 PRs per run)

**Batch by target file, not one PR per suggestion.** This is the single biggest throughput change
available to this lane and it costs nothing. On 2026-08-02, 31 actionable homepage and content rows
resolved to just eight target files: `routine-daily-merchandise.md` alone was named by 13 rows,
`mission-brief.md` by 6, `routine-content-daily.md` by 5. One PR per row would have spent the entire
15-PR budget on two files and left the rest for the following week; batched, the same 31 rows are
about nine PRs and the queue actually drains.

How to batch safely:

1. Group the actionable rows by the file each one edits. A row naming two files belongs to both
   groups; see the half-applied rule below.
2. One branch and one PR per **target file**, named `agents/suggestion-<lowest-id>`, with every
   batched ticket id in the PR title and body.
3. `{"op":"mark","id":<each id>,"status":"pr_open","applyRef":"<the same PR URL>"}` for **every**
   row in the batch. Several tickets may link the same PR ref: `SWEEPABLE_STATUSES` in
   `app/lib/ticket-out-of-band-sweep.server.ts` includes `pr_open`, and the hourly sweep matches on
   `suggestion_links`, so all of them reconcile to `applied` when that one PR merges. This is
   verified behaviour, not an assumption.
4. Batch only rows that genuinely agree. Two rows proposing contradictory edits to the same
   paragraph do not go in one PR; implement the better one and leave the other approved with a
   `decision` event explaining the conflict.

**A half-applied row is a failed row.** When a suggestion names more than one file, either change
every file it names in that PR, or do not mark it `pr_open` at all. Tickets #120, #423 and #474 each
named two targets, shipped exactly the first, and stranded: two of them sat in `in_progress` with a
cleared assignee for days, invisible to both this pass and R-DEV, because `expireStaleClaims()`
compares `claim_expires_at < now()` and a NULL lease never satisfies that. If you can only do part
of a row, implement the part you can and leave the row **approved** with a `decision` event naming
the file still outstanding.

**The per-run PR cap is 15, and that is the only number.** It is not 5. Earlier runs stopped at 5
and wrote "run cap" next to it; there is no 5-PR rule anywhere, and stopping there left the lane
running at a third of capacity while the actionable backlog grew (18 → 38 → 65 in three weeks). You
are expected to work *to* the cap: keep opening one PR per actionable suggestion until you hit 15 or
the actionable queue is empty. A short run is legitimate only when the queue was genuinely small or
the remaining rows are all non-actionable (code, refusals, too-vague, already-satisfied) — never
because you decided to stop early. Wall-clock is not the constraint: past runs averaged ~2 minutes
per PR, so a full 15-PR run is ~30 minutes of Max.

1. Read the suggestion and the files it names. Too vague to implement faithfully → leave it
   approved, post a `decision` event saying what's missing.
2. Branch `agents/suggestion-<id>` from the default branch.
3. Minimal diff, allowlisted files only: **`.claude/agents/*.md`, `docs/store-team/*.md`,
   `docs/homepage-team/*.md`, and nothing else.** That is the literal regex in
   `.github/workflows/agent-allowlist.yml`, and it is depth-1 `.md` only. One file outside it fails
   the check for the *whole* PR, permanently — so a suggestion asking you to touch anything else is
   a suggestion you cannot execute on an `agents/` branch. Say so in a `decision` event and leave
   the row for the owner.
   Diff-before-write: already satisfied → mark `applied` with a note, no empty PR.
4. **Refuse and flag** any suggestion that would weaken a money valve, the Emma voice gate, MAP
   rules, propose-only discipline, or the improvement loop's own human gates. Post a `decision`
   event stating what it would have weakened, and **leave the row approved** for the owner.

   Do not try to retire or rekind it. Your apply queue is `instructions`/`agent-def`/`config`, and
   the bus rejects both ops on exactly those kinds: `AGENT_RETIRE_KINDS` is
   `process|strategy|program` and `REKIND_FROM_KINDS` is `process`, so either call returns 409. That
   fence is deliberate, and the code comment says why — being able to retire your own instruction
   rows is being able to dismiss the suggestions that constrain you. An earlier version of this step
   told you to dispose of the row anyway, which was an instruction the API could not honour.

   Yes, this means a refused row is re-listed on every future run. Re-reading it is cheap; the
   alternative is a hole in the only fence pointed at you. Skip it fast on sight of your own prior
   `decision` event.
5. Open the PR (never merge it yourself; the release engine does that once the gates pass): title
   `agents: apply suggestion #<id> — <summary>`; body quotes the
   suggestion verbatim + est. savings + cx_risk + rationale for the exact edit.

   **Then mark it ready for review, in the same step, before you move on:**

   ```bash
   gh pr ready <PR number>
   ```

   This is not optional and it is not the owner's job. A draft PR is invisible to the release
   engine: its gate returns `skip / code:'draft'` before it evaluates CI, the allowlist, or the
   ticket, so a drafted PR waits forever no matter how green it is. When you open a PR from a
   cloud session the harness creates it as a draft by default, which is how 15 fully-green
   suggestion PRs sat unmerged for a day on 2026-07-30. Confirm the PR reads "Open", not
   "Draft", before you mark the row `pr_open`.
6. Mark it:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"mark","id":<id>,"status":"pr_open","applyRef":"<PR URL>"}'
```

## Step 3 — Close the loop on earlier PRs

For rows still in `pr_open` whose PR has merged: `{"op":"mark","id":<id>,"status":"applied","applyRef":"<PR URL>"}`.
When the release engine is on it normally sets `applied` itself after the post-deploy smoke passes,
so most rows are already closed by the time you look. That is expected. PRs closed without merging →
post a `decision` event; the row stays `pr_open` for the owner to dismiss or re-decide.

## Step 4 — Spend + finish

Log tokens (`feature:'strategy-apply'`), then the final run update: table of suggestion id | files |
PR URL (or skipped + why), conflicts flagged.

**Honesty line (required).** The final run summary must state, in one line, three numbers:
**actionable-backlog-at-start**, **PRs-opened**, and **the cap (15)**. This makes a lane running
below capacity visible in the summary itself instead of buried in a parenthetical. If PRs-opened is
well under both the backlog and the cap, say why in the same line (queue drained, remaining rows
non-actionable, conflicts, or run cut short).
