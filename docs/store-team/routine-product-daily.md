## Step 3: Judge + execute

**Feed-health pre-check, before any approve call (ticket #8393).** Read the latest two
`import_monitor_runs` rows. If both show `candidates_found=0`, or the owner blocker with dedupeKey
`nalpac-main-feed-brand-column-empty` is currently open, the queue is feed-blocked: every approve
this run would return `master-no-longer-in-feed` and burn 0 cap while stamping nothing (seen on runs
582 and 771, up to 20 doomed calls before noticing). Skip the approve loop entirely, post a `decision`
event stating imports are held on the upstream feed outage (queue depth + downstream health from Step
4), and finish the run honestly. Resume normal approve behavior automatically once discovery reports
`candidates_found>0` again — this is a per-run check, not a standing state to remember.

**Before approving, gate approval VOLUME on downstream enrich health.** Run the Step 4 health check
first: read `max(enriched_at)` and the `status='imported' AND enriched_at IS NULL` backlog depth. An
approval only creates a Shopify draft; while enrich is dark those drafts never reach the live
storefront, so filling the 20-action cap into a stalled enricher grows an un-enriched pile without
producing sellable catalog (mission-brief stop-doing: throughput is not progress). If the enricher is
demonstrably stalled — nothing enriched in the last 24-48h while imports keep flowing — **throttle
approvals to theme-critical picks only** and lead the run by re-flagging the enrich stall, rather than
filling the cap. When enrich is keeping pace, approve normally up to the cap. Approval volume is gated
on downstream health, not just on the per-run action cap.

**Also gate approval volume on publish-time buyable share (owner blocker #588,
nalpac-inventory-sync).** Products that publish ACTIVE have recently been reading Shopify inventory 0
at both the Nalpac and Entrenue locations despite healthy feed stock (as much as ~71% of recent
publishes unbuyable; see the weekly brief of 2026-10-12). Enrich can be perfectly healthy while every
new draft publishes unsellable, so this is a separate, additional check, not a substitute for the
enrich-health gate above. Sample live Shopify `totalInventory` (Admin API, the Step 4 check already
in-session) of products published since the last run. If buyable share is materially depressed, or
owner blocker #588 is still open, throttle approvals to theme-critical picks only and lead the run by
re-flagging the sync defect, exactly as the enrich-stall branch above does.

For each candidate apply editorial + strategic judgment (catalog fit, current theme, image quality,
brand quality, needs-review complexity). **Margin is not a factor** (`<financial_stance>`). Decide
approve / reject (with reason) / watch, then execute with the **bulk `ids` form**, one call per intent:

**Costume/Halloween/mask-tagged candidates, 2026-10-01 through 10-31 only.** The standing default
rejects these as off-catalog filler for a wellness store (precedent: Bijoux Indiscrets Dalila Decal
Eye Mask, rejected under the August Reset theme). For the duration of the Costume, Mask & Lingerie
Search Push (marketing-calendar row 42, 10-01 to 10-31), judge these candidates on fit against that
active campaign theme instead of auto-rejecting as filler: GSC shows 31 sub-position-6 queries are
almost all costume/cosplay demand this window is meant to capture. The default reasserts itself once
the window closes.

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