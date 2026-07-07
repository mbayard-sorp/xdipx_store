# Routine — Apply Pass (agent-editor)

The playbook for the scheduled apply pass — the hands of the improvement loop. Entry agent:
`agent-editor`. Turns **owner-approved** instruction-kind suggestions into **one PR per
suggestion**; never merges; never touches code, schema, settings, or secrets. Gated by the
`suggestion_apply_enabled` valve (default off) on top of the strategy team's gate.

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

## Step 2 — Implement (per suggestion, max 5 per run)

1. Read the suggestion and the files it names. Too vague to implement faithfully → leave it
   approved, post a `decision` event saying what's missing.
2. Branch `agents/suggestion-<id>` from the default branch.
3. Minimal diff, allowlisted files only (`.claude/agents/*.md`, `docs/store-team/*.md`,
   `docs/homepage-team/*.md`; `docs/ads-policy.md`/`docs/emma-voice.md` only when explicitly
   targeted and risk-approved). Diff-before-write: already satisfied → mark `applied` with a note,
   no empty PR.
4. **Refuse and flag** (decision event, row left approved) any suggestion that would weaken a money
   valve, the Emma voice gate, MAP rules, propose-only discipline, or the improvement loop's own
   human gates.
5. Open the PR (never merge): title `agents: apply suggestion #<id> — <summary>`; body quotes the
   suggestion verbatim + est. savings + cx_risk + rationale for the exact edit.
6. Mark it:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"mark","id":<id>,"status":"pr_open","applyRef":"<PR URL>"}'
```

## Step 3 — Close the loop on earlier PRs

For rows in `pr_open` whose PR has merged: `{"op":"mark","id":<id>,"status":"applied","applyRef":"<PR URL>"}`.
PRs closed without merging → post a `decision` event; the row stays `pr_open` for the owner to
dismiss or re-decide.

## Step 4 — Spend + finish

Log tokens (`feature:'strategy-apply'`), then the final run update: table of suggestion id | files |
PR URL (or skipped + why), conflicts flagged.
