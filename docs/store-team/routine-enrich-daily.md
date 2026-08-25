# Routine: Daily Product Enricher (R-ENRICH, Max transport)

The playbook for the scheduled enrichment drain when `import_enrich_transport` is `subagent`. The
routine session itself is the orchestrator: it claims imported-but-unenriched drafts from
`/api/team/enrich-queue`, dispatches one `emma-product-enricher` subagent per product to generate the
full ProductWrites payload, and posts each payload back. The server owns every rule downstream of
generation — the quality gate, the retry/park attempt cap, the Shopify + Sanity writes, and the
publish flip — so this routine changes **where tokens are billed**, never what ships.

Runs on the **Max subscription**: all generation happens in this session and its subagents, zero
Anthropic API spend. The site is for claiming briefs and submitting results only. Never call the
site's Anthropic-keyed endpoints. The batch-API path (`/cron/import-enrich` submit step) stays intact
and owns generation whenever the transport valve is `batch-api`; the two transports can never
double-generate because both claim through the same `enrich_batch_id` column.

Auth on every `/api/team/*` call goes through **`scripts/team-api.sh`**, never hand-rolled curl:

```bash
bash scripts/team-api.sh POST team/run '{"op":"start","team":"product","runType":"enrich"}'
bash scripts/team-api.sh GET  team/gate 'team=product&excludeRun=42'
```

It resolves the token itself (`$TEAM_TOKEN`, then `$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`),
keeps it off the command line and off disk, prints the response body, and exits non-zero on a
transport error (2 = no token, 3 = bad usage, 4 = HTTP >= 400 with the body still printed, because
the API answers a refusal like `over_run_cap` with a non-2xx and you need the reason to skip
honestly).

**Use the script, not curl.** On 2026-08-24 this routine's fire had no git source attached, so the
session started in `/home/user` instead of the repo, the repo's `.claude/settings.json` allowlist
never loaded, and the permission classifier blocked the hand-rolled
`curl -H "x-team-secret: ..."` three times. The run never started and nothing was enriched, two days
running. The script is one fixed, allowlisted command shape with no secret in it, so it does not
depend on that resolution going the right way.

Voice: the `emma-product-enricher` agent def is binding on output (it reads `docs/emma-voice.md`
first, charter core + "Product enrichment and SEO" addendum). This playbook never restates voice
rules; the charter wins.

## Step 0: Start

```bash
bash scripts/team-api.sh POST team/run '{"op":"start","team":"product","runType":"enrich"}'   # → $RUN_ID
```

If this POST returns a transport/connection error (not a clean HTTP 4xx), do not blind-retry:
reconcile first per `routine-schedule.md` §Run-start reconciliation (list `status:"running"` and
adopt an existing `enrich` row from the last few minutes rather than filing a duplicate that burns a
run-cap slot).

## Step 1: Gate

```bash
bash scripts/team-api.sh GET team/gate "team=product&excludeRun=$RUN_ID"
```

If `ok:false`: post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and **stop** — skip honestly, never work around the gate. Note `product_team_max_runs` must be at
least 3: the 09:00 product-manager run plus this run is the scheduled 2, and every run row (including
a skip) burns a slot (see routine-schedule.md §Run-cap requirements).

The enrichment valves are enforced **server-side** by the queue API, not read by you:
`import_enrich_enabled` off → every mutating op returns `403 {reason:'disabled'}`;
`import_enrich_transport` = `batch-api` → claim returns `409 {reason:'wrong_transport'}`. Either
response is an honest skip: post the reason as the run summary, finish `skipped`, stop. Never touch a
valve.

## Step 2: Claim

```bash
bash scripts/team-api.sh POST team/enrich-queue '{"op":"claim","leaseId":"run-'$RUN_ID'"}'
```

Response: `claims: [{candidateId, productId, sku?, brief}]`, `skippedNoBrief`, and `sharedContext`
(the mood/audience/matters vocab, dial registry, dial taxonomy — the same editorial context the batch
path embeds in its cached system prompt). Each claim call leases up to `import_enrich_batch_cap`
(default 10). Claimed rows are stamped `enrich_batch_id = 'subagent:run-<id>'`; a run that dies is
harmless — the 30-minute cron ages expired leases out after 26h through the normal retry path.

## Step 3: Generate (one subagent per product)

For each claim, dispatch the `emma-product-enricher` agent with the brief **plus** `sharedContext`
mapped into the `vocabularies` object its input contract expects (`moodVocab`, `audienceVocab`,
`mattersVocab`, `dialRegistryByType`, `dialTaxonomy`). `pairingCandidates` arrives empty by design —
pairings are deal-cycle artifacts; the agent should omit `pairingWhy`. Ask for ONLY the JSON object,
no fences.

Before submitting, self-check the payload against the acceptance rules the server will apply
(non-empty `descriptionHtml`, `tagline`, `seoMetaDescription` ≥ 100 chars, valid `productTypeDial`,
non-empty mood/audience/matters tags, and the sensation-dial spread rule: ≥5 values, ≥3 distinct,
≤1 five, ≤1 one). Fix locally (re-dispatch with the violation named) rather than burning a server-side
attempt: **every rejected `complete` counts against the same 2-attempt cap the batch path uses**, and
the second failure parks the product for manual review.

## Step 4: Submit

```bash
bash scripts/team-api.sh POST team/enrich-queue '{"op":"complete","candidateId":<id>,"writes":<ProductWrites JSON>}'
```

A `writes` payload is large and quote-heavy, so build it in a file and pass it with
`bash scripts/team-api.sh POST team/enrich-queue "$(cat payload.json)"` rather than inlining it.

- `{ok:true, result:'enriched'}` — done; the cron's publish step flips the draft live within 30 min.
- `{ok:false, result:'requeued', reason}` — the server gate rejected it and the candidate can be
  claimed once more. Re-claim it (a fresh `claim` call picks it up), regenerate with the reason
  quoted in the dispatch prompt, and resubmit — at most one such retry per product per run.
- `{ok:false, result:'parked', reason}` — attempt cap hit; leave it and count it for Step 6.
- `{ok:false, result:'not_claimable'}` — state changed under you (lease expired mid-run, valve
  flipped); log it and move on, never force.

A product whose subagent fails outright (unparseable JSON after one re-dispatch, agent error) gets
released so the attempt is honestly counted:

```bash
  -d '{"op":"release","candidateId":<id>,"reason":"<what failed>"}'
```

## Step 5: Loop

Repeat claim → generate → submit until a claim returns zero claims, or you have processed **30
products this run** (session-length bound; the rest keep until tomorrow — the stall watchdog only
alarms past 25 rows aged 6h+, so a one-day backlog under ~25 is quiet and expected). A `403 disabled`
mid-run means the owner pulled the kill switch: stop generating immediately, report what completed,
finish honestly.

## Step 6: Report + finish

Read `{"op":"status"}` for the funnel snapshot (pending / awaiting claim / in flight / parked /
enriched). Post one `decision` event under `$RUN_ID` (`agentRole:'emma-product-enricher'`): products
enriched / requeued / parked / released, gate-rejection reasons seen, funnel counts. If `parked > 0`,
file a suggestion at the product team (`kind:'process'`) naming the parked candidateIds so the daily
product run or the owner reviews them — parked rows re-enter the pipeline only by manual reset.

Log spend (`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"product-enrich",...}`
— the `product-` prefix is required or the budget gate reads 0; API cost is $0 on this transport,
report token counts honestly), then finish:

```bash
bash scripts/team-api.sh POST team/run '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<N enriched, N requeued, N parked, funnel>"}}'
```

`finished:true` is required, not decorative: `updateRun` only stamps `finished_at` when the update
carries it, and a run left without one reads as never-completed in every duration and liveness
report.

## What this routine never does

Never touches a valve. Never publishes (the cron owns draft→active). Never writes Shopify or Sanity
directly — everything lands through `op:'complete'`, behind the same quality gate as the batch path.
Never resets a parked row. Never calls Anthropic-keyed site endpoints. Never merges or pushes code.

## Appendix: Enablement runbook

The transport ships inert (`import_enrich_transport` unset = `batch-api`; the cron keeps working
exactly as today). To move enrichment to the Max subscription, in order:

1. **Confirm `product_team_max_runs` ≥ 3** (Product tab of `/admin/homepage-team`): product-manager
   09:00 + this run is the scheduled 2, and a retry or skip adds a third row.
2. **Flip the transport** on `/admin/imports`: "Enrichment transport" → Max subagent. From the next
   cron tick the submit step stops (`reason:'subagent_transport'`, quiet by design); collect, lease
   recovery, and publish keep running. `import_enrich_enabled` remains the kill switch for the whole
   lifecycle on both transports.
3. **Create the cloud trigger** (fresh session per fire) and add its row to
   `docs/store-team/routine-schedule.md`: suggested `0 12 * * *` UTC — after the 09:00
   product-manager drain has produced the day's drafts, clear of the product team's other cadence.
   Prompt follows the common skeleton, playbook `docs/store-team/routine-enrich-daily.md`, team
   `product`, feature `product-enrich`. No new connectors needed (repo + xdipx.com egress only).
4. **One supervised manual run:** fire by hand, watch the run row + events on
   `/admin/homepage-team?team=product`, confirm enriched drafts flip live on the next cron tick and
   `/admin/imports` lifecycle badges advance Queued → Enriching → Enriched → Live.
5. **Watch the first week's parked count.** The batch path's historical gate-failure rate is the
   baseline; if the subagent transport parks noticeably more, compare the rejection reasons in the
   run events before touching anything.

**Rollback:** flip the transport back to `batch-api` on `/admin/imports`. In-flight subagent leases
either complete normally or age out within 26h, after which the cron's submit step resumes claiming
those rows. Nothing else to undo.

**Kill-switch drill:** `import_enrich_enabled` off → the queue API 403s every mutating op and the
routine degrades to report-only mid-run; `product_team_enabled` off → the run stops at the gate.
