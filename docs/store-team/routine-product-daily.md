# Routine: Daily Product Manager (product-manager)

The playbook for the scheduled import-queue drain. Entry agent: `product-manager`. Once per run it
sweeps the `import_candidates` queue for the rows the deterministic Phase-2 gates left behind
(tier C/D opportunities, needs-review masters, brand-new candidates, price-drop reopens) and
**executes** approve/reject/watch directly — the fully-unattended, no-per-item-approval carve-out
(see CLAUDE.md and `.claude/agents/product-manager.md`). Discovery adds candidates **daily**, so the
judgment layer runs daily too (not just as the weekly-strategy review-only sub-step).

Runs on the **Max subscription**: own reasoning and DB reads; the site is for reading
`import_candidates` and executing the queue action only. Never call the site's Anthropic-keyed
endpoints — this routine spends no AI tokens (SQL sweep + one bulk `curl` per intent).

Auth on every `/api/team/*` call and the action endpoint: header `x-team-secret: $TEAM_TOKEN`
(the action endpoint also accepts `Authorization: Bearer $TEAM_TOKEN`; falls back to
`$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin. DB reads use
`DATABASE_URL` from `.env` (fresh worktrees: `bash scripts/setup-worktree.sh` first).

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"product","runType":"product"}'   # → $RUN_ID
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=product&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and **stop** — skip honestly, never work around the gate. The gate enforces the `product_team_enabled`
kill switch, `product_team_daily_cents` (300), and `product_team_max_runs` (1). Note the **second,
independent** switch: your *execute* capability is gated server-side by `product_manager_enabled` (a
separate pipeline setting, already on from migration 052). The routine gate and the execute gate are
orthogonal — you can be enabled-to-run but off-to-execute.

## Step 2: Sweep the queue (data only)

1. Read `.claude/agents/product-manager.md` (your charter — financial stance, autonomy rails, output
   format) and `docs/store-team/mission-brief.md` (binding). The strategy brief (`GET /api/team/brief`)
   and `marketing_calendar` tell you this window's theme.
2. Query Neon for `import_candidates` where `status IN ('pending','watching')`, ordered by tier then
   `deal_score DESC`. Separate into: (a) newly-reopened price-drop rows, (b) remaining tier C/D
   opportunities, (c) needs-review masters (variant sprawl > 30), (d) stale watching rows.
3. Consume `nalpac-feed-analyst`'s scores — don't re-derive them.

## Step 3: Judge + execute

**Before approving, gate approval VOLUME on downstream enrich health.** Run the Step 4 health check
first: read `max(enriched_at)` and the `status='imported' AND enriched_at IS NULL` backlog depth. An
approval only creates a Shopify draft; while enrich is dark those drafts never reach the live
storefront, so filling the 20-action cap into a stalled enricher grows an un-enriched pile without
producing sellable catalog (mission-brief stop-doing: throughput is not progress). If the enricher is
demonstrably stalled — nothing enriched in the last 24-48h while imports keep flowing — **throttle
approvals to theme-critical picks only** and lead the run by re-flagging the enrich stall, rather than
filling the cap. When enrich is keeping pace, approve normally up to the cap. Approval volume is gated
on downstream health, not just on the per-run action cap.

For each candidate apply editorial + strategic judgment (catalog fit, current theme, image quality,
brand quality, needs-review complexity). **Margin is not a factor** (`<financial_stance>`). Decide
approve / reject (with reason) / watch, then execute with the **bulk `ids` form**, one call per intent:

```bash
curl -sS -X POST "$BASE_URL/api/team/import-candidate-action" \
  -H "Authorization: Bearer $TEAM_TOKEN" \
  -d "intent=approve" -d "ids=<csv>"        # repeat for reject (+reason) and watch
```

Read `results` (what ran), `skippedDueToCap` (hit `product_manager_max_actions_per_run`, default
20 — leave those for tomorrow, don't retry), and `deferred` (approve batches are chunked to 10 per
request so a big batch can't hit the serverless time limit — resubmit the deferred ids in a
follow-up call until the list comes back empty). A `403 {error:'product_manager disabled'}` means the
execute switch is off: report your would-be decisions in the event and stop; do not fall back to
filing suggestions. The cap now counts approvals correctly (approvals stamp `reviewed_by` /
`reviewed_at`), so it is a real per-day ceiling on your total actions.

**Approve-timeout handling.** Each approve intent creates a real Shopify draft (roughly 12-15 seconds
per candidate), so even chunked at 10 per request a full-cap batch can exceed the client/serverless
timeout (~2 minutes) mid-chunk. If an approve `curl` times out, do not blind-resubmit the same ids.
First verify DB state (`import_candidates.status`, `reviewed_by='product-manager-agent'`,
`reviewed_at::date = today`), then resubmit only the ids still pending, otherwise you double-approve
and burn cap. Use `curl --max-time 280` on approve calls.

## Step 4: Downstream health

Check `import_candidates.status='imported' AND enriched_at IS NULL` (stuck in enrich) and
`enriched_at IS NOT NULL AND published_at IS NULL` (stuck in publish). If imports pile up beyond what
volume explains, name the likely cause (`import_enrich_enabled` off, enrich batch cap too low,
`enrich_failed_at` products parked by the quality gate, poller stuck). Also note any
newly-published products worth a merchandising push → suggestion `targetTeam:'homepage'`, `kind:'strategy'`
(you propose the feature; the homepage team's gate decides).

## Step 4b: Inbound suggestions (read your own mail)

Other agents file findings *at* this team, and before 2026-07-29 no routine read them: the playbooks
only ever wrote suggestions, so routed findings aged in `approved` forever.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","targetTeam":"product","status":"approved","orderBy":"age"}'
```

Act on up to **3 per run**, oldest first, and only what this run can actually execute within the
gates it already obeys. Close each one you did execute so tomorrow's run does not re-read it:

```bash
-d '{"op":"transition","id":<id>,"to":"applied","actor":"agent:product-manager","note":"<what changed>"}'
```
Only `process` and `strategy` rows can be closed this way (`RUN_CLOSE_KINDS`). A `campaign`,
`promo`, `instructions`, or `code` row returns 409 — those have their own executor, or the owner's,
and are not yours to end. Note them instead.


Looked but deliberately did not act (out of scope, no longer true, needs code)? Post
`{"op":"note", ...}` with which and why and leave the status alone. Never close a row you did not
execute: a false `applied` looks handled and is worse than an aging row.

## Step 5: Report + finish

Post one `decision` event under your `$RUN_ID` (`agentRole:'product-manager'`): queue depth,
approve/reject/watch executed (and any skipped due to cap or kill switch), price-drop rows surfaced,
downstream health, top opportunities with the numbers. Log spend
(`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"product-daily",...}`
— the `product-` prefix is required or the budget gate reads 0), then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<N approved / N rejected / N watched, queue depth, health>"}}'
```

## Appendix: Enablement runbook

The routine ships inert. To turn it on, in order:

1. **Apply migration 059 in prod:** `npx tsx scripts/apply-migrations.ts --from 059` (seeds the
   `product_team_*` keys, off).
2. **Flip the routine kill switch:** `product_team_enabled` → on, in the Product tab of
   `/admin/homepage-team`.
3. **Confirm the execute switch:** `product_manager_enabled` is already on from migration 052 (edited
   on `/admin/imports`, not the team dashboard). With it on, the routine executes; with it off, the
   routine runs and reports would-be decisions only.
4. **Create the cloud trigger** and add its row to `docs/store-team/routine-schedule.md` (fresh
   session per fire, ~09:00 UTC — after the 08:00 `/cron/import-monitor` discovery run). Until the
   trigger exists, the weekly review-only sub-step is the only place `product-manager` is invoked,
   and it does **not** execute — so create this trigger when you want the queue drained daily.
5. **One supervised manual run:** fire by hand, watch the run row + events on
   `/admin/homepage-team?team=product`, confirm approvals land as Shopify drafts and the daily cap
   accounts them.

**Kill-switch drill:** `product_team_enabled` off → runs stop at the gate (Step 1 skips honestly).
`product_manager_enabled` off → the routine still runs but every action call 403s and it degrades to
report-only. During the initial backlog drain, the owner may temporarily raise
`product_team_max_runs` or `product_manager_max_actions_per_run` — one daily run of 20 actions drains
a multi-hundred backlog slowly.
