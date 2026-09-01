# Tracker — Automation Audit Roadmap (July 2026)

Program: Close the gaps from the full store audit (automation plumbing, answer layer, product-data coverage, PDP/PLP/discovery conversion)
Source plan: docs/audits/2026-07-full-store-audit.md §7
Started: 2026-07-13   Target end: 2026-10-04 (P0 wks 1–2, P1 wks 3–6, P2 wks 7–12)
Overall: RED

Week anchors: W1 = 2026-07-13, W2 = 2026-07-20, W3 = 2026-07-27, W6 = 2026-08-17, W7 = 2026-08-24, W12 = 2026-09-28.

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
|---|---|---|---|---|---|---|---|---|---|
| p0-1-email | Klaviyo campaign execution client + approval-gated send | P0 | rr7-engineer + email-marketing-manager | 2026-07-20 | in-progress | AMBER | a Klaviyo campaign client exists in `app/lib/` (`.server.ts`) AND an approval-gated send action is reachable from the admin dashboard AND one approved test send is logged | 2026-08-17 | owner approves each campaign; agent briefs become executable. Audit 2026-08-17: real progress found — `app/lib/klaviyo-campaigns.server.ts` (parse/decide/build/push, fail-closed) executed via `scripts/push-approved-campaigns.ts` against approved `kind:campaign,team:email` suggestion rows, with an owner-review email on every push. First AND-half now genuinely passes. Probe still fails overall: no admin-dashboard action (it's a CLI script, not a UI surface), `email_campaign_push_enabled` is unset (defaults off), and zero email-team campaign rows have ever reached `approved` (checked: only `proposed`/`dismissed`), so zero test sends are logged. RED→AMBER. Suggestion #57 stays blocked/non-terminal; not refiled. Audit 2026-08-24: further partial movement — two email-team campaign rows (#4117 Wand Week, #4118 Air Pulsation) now sit `approved` for the first time ever (previously only `proposed`/`dismissed`), so last audit's "zero campaign rows ever approved" is no longer true. Still fails the probe: `email_campaign_push_enabled` remains unset (off), `scripts/push-approved-campaigns.ts` exits at the valve check without touching Klaviyo, and no `suggestion_links` note references a Klaviyo draft for either row — zero sends logged. AMBER, unchanged. Audit 2026-08-31: two more email-team campaign rows (#5394, #5395) reached `approved` 2026-08-25, bringing the lifetime total to 4 approved (up from 2 last audit). Still fails the probe outright: `email_campaign_push_enabled` is confirmed absent from `pipeline_settings` (direct query returns zero rows for that key, defaults off) and `scripts/push-approved-campaigns.ts` still exits at that valve check — zero sends logged. AMBER, unchanged.
| p0-2-restock | Back-in-stock webhook fires Klaviyo events for waitlist signups | P0 | rr7-engineer + shopify-ops | 2026-07-20 | done | GREEN | `handleInventoryUpdate` in `server/webhooks.ts` no longer early-returns on restock AND a Klaviyo back-in-stock event path exists | 2026-08-10 | pure leakage fix on captured intent. Audit 2026-08-10: PR #471 merged (via suggestion #55, applied); `server/webhooks.ts` now has `isRestockCrossing` firing on the genuine sold-out→in-stock crossing, and `app/lib/klaviyo.server.ts` exports `triggerBackInStock`, called from the webhook. QA-verified 2026-08-03 (typecheck/tests/build green, deploy smoke passed). Both probe halves confirmed on `main`. RED→GREEN. |
| p0-3-enrich | Enrichment batch drained: draft cohort + mood/audience/matters tag coverage | P0 | emma-product-enricher + media-manager | 2026-07-27 | in-progress | AMBER | `import_candidates.enriched_at`/`published_at` show a healthy live-draining cohort (this run's probe; supersedes the retired `batch_jobs` mechanism) AND `mood_tags` coverage on non-archived products approaches saturation | 2026-08-10 | gates p2-1-pseo; improves discovery rails + PLP facets. RE-AUDIT 2026-08-10: the RED-on-`batch_jobs`-is-dead premise carried for ~3 briefs does not hold anymore (flagged by product-team suggestions #1623/#1784/#2156) — the enrichment mechanism changed (cheaper single-call enrichment replaced the batch path; `batch_jobs` now sits empty/unused, the original probe was written against a retired mechanism). Real evidence: max enriched/published both 2026-08-10, 108 enriched + 108 published in the last 7 days, only 24 stuck (down from 289 stuck for weeks), 0 stuck on the publish half. Catalog-wide: tagline 99.1%, FAQs 98.9%, sensation dial 98.9%, but `moodTags` only 49.3% — a real, already-tracked gap (approved suggestion #1278). RED→AMBER: the dead-chain half is resolved, the tag-coverage half is not. Do not carry the stale dead verdict forward. Audit 2026-08-24: Shopify-blind this session (no Shopify creds in sandbox), so the `moodTags` catalog-coverage half is unverified again this run — capped at AMBER per README, not guessed. The live-draining-cohort half stays healthy (enriched_7d 79, published_7d 79 per this run's evidence), but `enrich_stuck` doubled week over week (26→52) and `enrich_failed`(parked) nearly tripled (~10→28) — a real, growing risk worth a closer look even though it hasn't broken the tracked AND-condition yet. AMBER, unchanged. Audit 2026-08-31: Shopify-blind again this session (confirmed via a direct `.env*` check: only `.env.example` present, no real credentials), so `moodTags` coverage stays unverified, capped at AMBER. The live-draining-cohort half stays healthy on this week's officially captured numbers (enriched_7d 130, published_7d 130). `enrich_stuck` ticked up again (52→53) and quality-gate-parked held flat at 28 — the same growing-but-not-accelerating risk flagged the last two audits, still not worth a suggestion on its own. AMBER, unchanged. |
| p0-4-reviews | Review corpus live: invite flow verified, real approved reviews, `reviews_pdp_enabled` on | P0 | shopify-ops + owner | 2026-07-27 | not-started | RED | `pipeline_settings.reviews_pdp_enabled='true'` AND ≥1 approved review row AND aggregateRating present in a live PDP page source | 2026-08-31 | valve must not flip before real reviews exist (055 comment / Google policy). Audit 2026-07-27: target week reached, `reviews_pdp_enabled=false` (correctly off), `review_invites` still 0 rows ever sent, raw `reviews` ~1 row. No movement at target. AMBER→RED. Suggestion #114 filed. Audit 2026-08-31: still 0 review invites ever (`review_invites` re-confirmed empty), `reviews_pdp_enabled` correctly `false`. New context this run: Shopify confirms the store's first-ever non-owner order, #1003 (2026-08-20, $28.11, "Rayette Zerbel") — 3 lifetime orders, 1 real customer, and zero invites sent against any of them. The root blocker (the review-invite pipeline itself not firing) is already covered by suggestion #5233 (`review-invite-pipeline-not-firing-2026-08`, blocked, non-terminal, targets strategy); not refiled. RED, unchanged. |
| p0-5-content-cron | content-writer moved off desktop scheduling to cloud trigger or Vercel cron | P0 | rr7-engineer + content-writer | 2026-07-20 | done | GREEN | `docs/store-team/routine-schedule.md` row 9 carries a cloud trigger id (not the desktop task id) AND ≥2 published posts in a week | 2026-07-20 | fixes the zero-posts-published gap. Audit: cloud trigger id present since 2026-07-13; 4 posts published live this week (Jul 14/16/17/18, `homepage_team_runs` 34/42/45/48). Probe passes. |
| p0-6-alerting | Bidirectional owner alerting + read-only valve-state snapshot endpoint | P0 | rr7-engineer | 2026-07-20 | done | GREEN | a push/email digest path exists in code (not just GitHub issues) AND an authenticated read-only valve snapshot route exists | 2026-07-27 | fixes §4.6 auditability gap. Audit 2026-07-27: PR #282 shipped `owner-alerts.server.ts` + `owner-digest.server.ts` (Zoho SMTP/Twilio owner digest) and the authenticated read-only valve-snapshot route `api.team.status.tsx`. Probe passes. RED→GREEN. |
| p0-7-valves | §3 live-state checklist resolved (052 state, GSC env, SEO valves, stock indicator) | P0 | owner + shopify-ops | 2026-07-20 | not-started | RED | checklist L1–L9 answers recorded in this tracker's status log AND stock indicator un-commented on the PDP | 2026-08-31 | answers may re-scope other milestones. Audit: L1–L9 never recorded in this log; PDP stock indicator still commented out (`app/routes/_layout.products.$slug.tsx` L61, L867-868). Suggestion #58 filed. Audit 2026-08-31: L1–L9 checklist still never recorded in this log, now 6 weeks past the 2026-07-20 target. PDP stock-indicator half remains the only part of the probe that passes. RED, unchanged — cheapest unblock in the roadmap, unmoved for 6 straight audits. |
| p0-8-links | Legacy homepage For-Him/For-Her carousel links fixed (no 301 hops) | P0 | rr7-engineer | 2026-07-20 | dropped | GREEN | `_layout._index.tsx` contains no links to `/for-him` or `/for-her` | 2026-08-10 | also carried the 1-line `dateModified` Product JSON-LD fix from Appendix A. Audit 2026-08-10: code still literally contains `ctaLink="/for-him"`/`"/for-her"`, but confirmed those hardcoded links live inside the legacy-variant render branch (`variant !== 'a'/'b'`), unreachable now that `HOME_VARIANT` defaults to `b` and daily deals were retired 2026-08-03. Owner dismissed suggestion #56 as moot 2026-08-06 for exactly this reason (`app/routes/_layout._index.tsx:691,699` sits inside the dead legacy branch). RED→dropped: not worth carrying a RED against code nobody will ever render. |
| p1-1-guides | Answer-layer sprint: ≥10 guides/FAQ posts published and indexed | P1 | content-writer + seo-curator | 2026-08-17 | done | GREEN | ≥10 live notebook posts of kind guide/comparison AND GSC snapshot shows them indexed | 2026-08-17 | YMYL-adjacent claims get human review. Audit 2026-08-17: 15 live `blogPost` docs carry category guides/comparisons (Sanity-confirmed, ≥10 required). `gsc_snapshots` captured today (2026-08-17) shows `/notebook/do-kegel-exercisers-work` with live impressions — direct evidence at least one guide is indexed and serving in search. Both probe halves pass on target week (today).
| p1-2-compare | `/compare/x-vs-y` route + Sanity comparison doc type + 3–5 seed comparisons | P1 | rr7-engineer + sanity-content-builder | 2026-08-10 | not-started | RED | a compare route exists in `app/routes/` AND ≥3 comparison docs live with ItemList/FAQ schema + `.md` twins | 2026-08-31 | Sanity schema additive only. Audit 2026-08-17: infra half now shipped (suggestion #2389, applied) — `app/routes/_layout.compare.$slug.tsx`, `_layout.compare._index.tsx`, and both `.md` twins (`compare[.md].tsx`, `compare.$slug[.md].tsx`) exist, plus a real `comparison` Sanity doc type (`studio/schemas/comparison.js`, ItemList/FAQ-shaped). But `count(*[_type=="comparison"])` is 0 in Sanity, confirmed live — zero comparison docs have ever been published. Still RED: the code exists, the content doesn't. Suggestion #3892 filed (instructions, content) for a comparison-doc production quota; #2389 is terminal (applied) and doesn't cover this remaining content gap. Audit 2026-08-31: no Sanity API access this session (only `.env.example` present, confirmed via direct check), so `count(*[_type=="comparison"])` can't be re-run — unverifiable, stays capped, not flipped. Worth flagging regardless: this week's content run (590, 2026-08-30) published `/notebook/air-pulse-vs-clitoral-suction` under `blogPost.category:'comparisons'` as part of #3892's production quota — real comparisons content is now shipping, but as a Notebook `blogPost`, not the dedicated `comparison` Sanity document type this milestone's literal probe checks for (confirmed via `studio/schemas/comparison.js` vs. `blogPost.js`'s separate `category` field). Same definitional-drift shape as p1-7-frontdoor below: worth an owner/tech-architect call on whether Notebook comparisons content satisfies this milestone's intent, or whether the dedicated `/compare/` route + doc type remains the real target. RED, unchanged.
| p1-3-plp-copy | Unique intro copy + FAQs on every indexable collection | P1 | emma-copywriter + seo-curator | 2026-08-10 | done | GREEN | all live collections have `collectionPage.introCopy` in Sanity (no generic fallback) | 2026-08-17 | Audit 2026-08-17: Sanity query access available this run — confirmed 172/172 `collectionPage` docs carry `introCopy`, and a 5-doc spot-check shows genuinely unique, brand/category-specific copy (Pipedream, Silicone-Based Lubricants, NS Novelties, Anal Lubes, Magic Silk all distinct, no boilerplate). AMBER→GREEN, probe passes.
| p1-4-plp-filter | Server-side PLP filtering across full collections + quick-add | P1 | rr7-engineer + qa-reviewer | 2026-08-17 | done | GREEN | collection loader accepts facet params and filters at query level (not client-side over 24 items) AND cards have quick-add | 2026-08-24 | wait for p1-7 front-door decision. Audit 2026-08-17: target week reached; the probe fails on the exact anti-pattern it names. `app/routes/_layout.collections.$handle.tsx` reads `FACET_PARAMS` only for canonical/noindex logic (`filtersApplied`); the real filtering is `useMemo(() => deals.filter(matchesAskEmmaFilters...))`, client-side over the single fetched page (`PAGE_SIZE = 24` from `getCollectionDeals`), never a server-side facet query across the full collection. No quick-add control found on the grid cards. GREEN(not-due)→RED. Suggestion #3889 filed (code, homepage), `dedupeKey:tracker:p1-4-plp-filter`. Audit 2026-08-24: suggestion #3889 (applied) genuinely fixed it. `_layout.collections.$handle.tsx`'s `loadCollectionDeals` now branches on `filtersApplied`: with any facet param present it calls `getCollectionAllDeals` (KV-cached whole-collection fetch) and filters + paginates server-side before the response leaves the loader; unfiltered requests keep the fast per-page cursor fetch. `VaultCard` (rendered on this route) carries a real quick-add button wired to `/api/cart` via `useFetcher`. Both AND-halves pass on `main`. RED→done.
| p1-5-discounts | Discount-code minting, approval-gated, MAP-guarded | P1 | rr7-engineer + promo-manager + pricing-ops | 2026-08-17 | done | GREEN | a discount-minting server path exists with a hard MAP check AND codes only mint from owner-approved proposals | 2026-08-17 | enables offers inside p0-1 campaigns. Audit 2026-08-17: `app/lib/shopify-discounts.server.ts` — `decidePromo()` is a real fail-closed hard MAP gate (refuses on any `detectMapConflict` line; refuses to mint unless `detectMapClean` is explicitly stated, never on mere absence of a conflict word), executed via `scripts/execute-approved-promos.ts` only against `approved` suggestion rows. Both probe halves pass. GREEN(not-due)→done.
| p1-6-llms | llms.txt slimmed + llms-full.txt added | P1 | seo-curator + rr7-engineer | 2026-08-10 | done | GREEN | `[llms.txt].tsx` emits curated described sections (no bare full-catalog dump) AND an `llms-full.txt` route exists | 2026-08-17 | Audit 2026-08-17: `app/routes/[llms-full.txt].tsx` now exists, inlining FAQ/About/Notebook content via the same markdown serializers as the `.md` twins, bounded by `MAX_INLINE` so it can't grow unbounded. Combined with the already-confirmed curated `[llms.txt].tsx`, both probe halves pass. AMBER→GREEN. Suggestion #2391 applied.
| p1-7-frontdoor | Discovery front-door consolidated (one winner, losers 301, ADR written) | P1 | tech-architect + rr7-engineer | 2026-08-10 | in-progress | AMBER | an ADR names the winning variant AND `home-variant.server.ts` reflects it AND losing routes 301 | 2026-08-31 | informed by L9 + GA4. Audit 2026-08-10: target week reached with partial evidence. `home-variant.server.ts` documents the code-level default-to-`b` decision in detail (owner direction 2026-07-20, PR #273, design-critic gate) as a de facto decision record, but no formal ADR names the winning variant, and no losing route 301s — by design `/discover` deliberately keeps serving variant `a` standalone (see CLAUDE.md), so a literal single-winner-with-301-losers reading may be superseded by the actual product decision to run both. GREEN→AMBER; flagged as an owner/tech-architect judgment call (does this milestone need a formal ADR, or should its definition change to match the keep-both decision already live?) rather than a mechanical suggestion. Re-checked 2026-08-31: no change — still the same ADR-vs-keep-both judgment call, no formal ADR filed. AMBER, unchanged. |
| p1-8-pdp | PDP: MAP treatment, editorial links, enrichment-coverage admin dashboard | P1 | rr7-engineer + emma-copywriter | 2026-08-17 | done | GREEN | PDP has a MAP-restricted price path AND an admin route reports per-product enrichment coverage | 2026-08-24 | dashboard protects p0-3 from regressing. Audit 2026-08-17: MAP-restricted price path confirmed live on the PDP (`mapAllowsDiscountDisplay` gate in `_layout.products.$slug.tsx`) — first half passes. Admin half only partial: `admin.imports.tsx` reports coarse enriched/awaiting/live timestamp counts, not per-field (tagline/FAQ/sensation-dial/mood-audience-matters tags) coverage — the exact gap already tracked as moodTags 49% under approved #1278. GREEN(not-due)→AMBER. Suggestion #3891 filed (code, product), `dedupeKey:tracker:p1-8-pdp`. Audit 2026-08-24: suggestion #3891 (applied) shipped the missing half. `app/lib/enrichment-coverage.server.ts` walks live (`status:active`) Shopify products for the named enrichment metafield set and tallies per-field coverage — source of truth is Shopify itself, not the generation cache — and `admin.imports.tsx` renders it via a `CoveragePanel` with a Refresh action (KV-cached 6h). Combined with the already-confirmed MAP-restricted price path, both AND-halves pass. AMBER→done.
| p1-9-monitoring | GSC anomaly alerting + JSON-LD regression check in CI | P1 | rr7-engineer + log-monitor | 2026-08-17 | done | GREEN | an alerting job reads `gsc_snapshots` week-over-week AND CI validates structured data on PRs | 2026-08-24 | includes Appendix A dateModified + empty-ItemList fixes if not shipped earlier. Audit 2026-08-17: GSC anomaly alerting confirmed real — `app/lib/seo-daily.server.ts` reads `gsc_snapshots` week-over-week against named thresholds (`INDEXED_DROP_PCT`, `NEWLY_DROPPED_MAX`, `SERVER_ERROR_MAX`) with owner alerts wired. No CI workflow validates JSON-LD/structured data on PRs (grepped `.github/workflows`, zero matches). GREEN(not-due)→AMBER. Suggestion #3890 filed (code, strategy), `dedupeKey:tracker:p1-9-monitoring`. Audit 2026-08-24: suggestion #3890 (applied) shipped the missing half as `app/components/seo/structured-data.contract.test.tsx`, a vitest test inside the existing required `npm test` step of `ci.yml` (deliberately test-only, zero `.github/**` diff so it never touched a protected path): a contract layer asserts every structured-data component emits a well-formed, JSON-parseable ld+json block with the right `@type`, plus a route-wiring layer statically confirms each is referenced from its route. Combined with the already-confirmed GSC week-over-week alerting, both AND-halves pass. Correction to last audit: that probe only grepped `.github/workflows/` for JSON-LD keywords and missed that CI validation can live inside the standard test step of an existing workflow, not just a dedicated one. AMBER→done.
| p2-1-pseo | Programmatic landing pages from mood/audience/matters × product_type_dial | P2 | rr7-engineer + seo-curator | 2026-09-14 | not-started | GREEN | a pSEO route template exists with ItemList/FAQ schema + `.md` twins AND pages index only past the quality bar | — | blocked by p0-3-enrich |
| p2-2-referral | Referral/loyalty execution: codes, rewards on `referrals` rows | P2 | loyalty-referral-manager + rr7-engineer | 2026-09-21 | not-started | GREEN | code generation + reward issuance paths exist against the `referrals` table | — | |
| p2-3-social | IG/TikTok posting plumbing (approval-gated, voice-gated) | P2 | social-media-manager + rr7-engineer | 2026-09-21 | not-started | GREEN | posting API clients exist for IG/TikTok, gated like X's double valve | — | |
| p2-4-support | Inbound support-email loop for customer-service-emma (draft-first) | P2 | customer-service-emma + rr7-engineer | 2026-09-28 | not-started | GREEN | an inbound email pipeline exists routing to the agent, replies draft-only until owner graduates | — | |
| p2-5-eeat | Human expert reviewer byline + review workflow on health-adjacent content | P2 | owner + content-writer | 2026-09-28 | not-started | GREEN | reviewer identity + workflow documented AND rendered on health-adjacent posts | — | |
| p2-6-design | Design-elevation Phase 1 kicked off | P2 | homepage team | 2026-09-14 | done | GREEN | first milestone in `trackers/design-elevation.md` flips to done | 2026-07-27 | tracked in its own tracker; mirrored here for sequencing only. Housekeeping flip: p1-doctrine in that tracker has been done since 07-13; this mirror row was never updated. p1-stack there remains RED. |
| p2-7-cwv | CWV field data (RUM) + automated LLM-citation tracking | P2 | rr7-engineer + aeo-geo-auditor | 2026-09-28 | not-started | GREEN | a RUM beacon reports CWV AND a scheduled citation check replaces the manual 20-query tracker | — | |
| p2-8-docs | Doc reconciliation: import-monitor runbook Phase-2 drift; routine smoke test recorded | P2 | program-manager + process-optimizer | 2026-09-28 | not-started | GREEN | runbook §6 matches `autoImportPhase2` code thresholds AND routine-schedule.md smoke test marked done | — | docs-only PR |
| p2-9-pricing-converge | Pricing-engine v1→v2 convergence (ADR-007 decision 4) | P2 | tech-architect + rr7-engineer + pricing-ops | 2026-09-28 | not-started | GREEN | no `decideAndApply` callers remain AND the Nalpac cost-change webhook calls `recomputeVariant` AND `pricing_changes` is retired/migrated into `pricing_audit_log` | — | ADR-007; product-mgmt bridge shipped "contain now"; tracked in issue #255 |
| p2-10-tierc-trust-review | Tier-C vendor-trust review (carried-brand/allowlist condition?) | P1 | owner + product-manager | 2026-08-17 | not-started | RED | a dated decision is recorded in this status log re: whether to add a carried-brand/allowlist condition to Tier-C `autoImportPhase2` | 2026-08-31 | owner accepted "admit all vendors" 2026-07-13; revisit ~+30d (~2026-08-12); issue #255. Audit 2026-08-17: target week reached (revisit date ~08-12 already ~1wk overdue coming into this audit); no dated owner decision recorded in this log. GREEN(not-due)→RED. Owner-only policy call, not code/instructions-executable — flagged as an explicit owner ask in the weekly brief rather than filed as a suggestion row. Audit 2026-08-31: still no dated owner decision in this log. Revisit target was ~2026-08-12; today is 19 days past that, ~2.7 weeks overdue — correcting last audit's "~6 weeks overdue" note, which mis-measured against p0-7-valves' target rather than this milestone's own ~08-12 revisit date. RED, unchanged.

Program gates (checked by program-manager in the weekly audit):
W2 — email plumbing live, enrichment queue drained, alerting live. W6 — ≥10 posts indexed, reviews valve on with real reviews, PLP filtering + comparison route shipped. W12 — pSEO indexing, referral MVP live, store-strategist assesses $2k/mo run-rate trajectory.

## Status log

### 2026-08-31 (program-manager, run 603). Overall stays RED. No milestone RAG changes; incremental evidence on two, corrections on two.

Re-probed all 25 milestones against files on `main`, Neon (`pipeline_settings`, `review_invites`,
`homepage_team_suggestions`), and `homepage_team_runs`/`_events`. No Sanity or Shopify credentials
were available in this session's `.env*` (only `.env.example` present) — same constraint as the
2026-08-24 audit — so the Sanity- and Shopify-gated probe halves (p1-2-compare's comparison-doc
count, p0-3-enrich's `moodTags` coverage) stay unverified and capped, not guessed. All seven `done`
rows spot-checked for regression (file existence on `main`); none flagged.

**No RAG flips.** Real movement within unchanged RAGs:

- **p0-1-email (AMBER, unchanged).** Two more email-team campaign rows (#5394, #5395) reached
  `approved` 2026-08-25, bringing the lifetime total to 4 approved (up from 2 last audit). Still
  fails the probe outright: `email_campaign_push_enabled` is confirmed absent from `pipeline_settings`
  (direct query returns zero rows for that key) and the push script still exits at that valve check —
  zero sends logged.
- **p0-3-enrich (AMBER, unchanged).** Shopify-blind again this session. Live-draining-cohort half
  stays healthy on this week's officially captured numbers (enriched_7d 130, published_7d 130).
  `enrich_stuck` ticked up again (52→53) and quality-gate-parked held flat at 28 — the same
  growing-but-not-accelerating risk flagged the last two audits.
- **p0-4-reviews (RED, unchanged).** Still 0 review invites ever, `reviews_pdp_enabled` correctly
  `false`. New context this run: Shopify confirms the store's first-ever non-owner order, #1003
  (2026-08-20, $28.11), so there are now 3 lifetime orders and 1 real customer, with zero invites
  sent against any of them. The root blocker (the review-invite pipeline itself not firing) is
  already covered by suggestion #5233 (`review-invite-pipeline-not-firing-2026-08`, blocked,
  non-terminal, targets strategy) — not refiled; the strategist should comment on that ticket
  instead of treating this as a fresh gap.
- **p0-7-valves (RED, unchanged).** L1–L9 checklist still never recorded in this log, now 6 weeks
  past its 2026-07-20 target — unmoved for 6 straight audits, still the cheapest unblock in the
  roadmap.
- **p1-2-compare (RED, unchanged, but the shape changed again).** Unverifiable this session (no
  Sanity access). Worth flagging regardless: this week's content run (590, 2026-08-30) published
  `/notebook/air-pulse-vs-clitoral-suction` under `blogPost.category:'comparisons'` as part of
  suggestion #3892's production quota — real comparisons content is now shipping, but as a Notebook
  `blogPost`, not the dedicated `comparison` Sanity document type this milestone's literal probe
  checks for (confirmed via `studio/schemas/comparison.js`, a distinct doc type from `blogPost.js`'s
  separate `category` field). This is the same definitional-drift shape already flagged on
  p1-7-frontdoor: worth an owner/tech-architect call on whether Notebook comparisons content
  satisfies this milestone's intent, or whether the dedicated `/compare/` route + doc type remains
  the real target.
- **p1-7-frontdoor (AMBER, unchanged).** Re-checked, no change — still the same ADR-vs-keep-both
  judgment call, no formal ADR filed.
- **p2-10-tierc-trust-review (RED, unchanged).** Still no dated owner decision in this log.
  **Correction to the record:** last audit's "~6 weeks overdue" note mis-measured against
  p0-7-valves' target rather than this milestone's own ~2026-08-12 revisit date; the accurate figure
  is 19 days (~2.7 weeks) overdue.

**Routine coverage check** (scope derived from `routine-schedule.md`'s 25 numbered rows plus
R-WATCH/R-SHEP, which post no run rows by design, last 7 days, cross-checked directly against
`homepage_team_runs`): **0 mandatory misses** — every routine with a recorded trigger and an
enabled gating valve produced at least one run row in the window, including the routines tagged
`run_type='manual'` rather than a routine-name string (SEO curation run 585, Podcast Review run
517) and the trend-scout lanes (content run 569, social run at 17:10 08-31). 0 half-enabled
valve-on/no-trigger misses: every `pipeline_settings` valve that maps to a `routine-schedule.md`
row has a recorded trigger id per the manifest; the several other ON valves this week
(`blocker_scout_enabled`, `outreach_send_enabled`, `sms_agent_enabled`, `chat_enabled`,
`social_metrics_sweep_enabled`, `import_monitor_enabled`, `pricing_costsync_enabled`) gate separate
Vercel cron routes documented outside this manifest, not scheduler-trigger rows, so they're out of
this check's scope, consistent with prior audits.

**Not a tracker-milestone finding, but urgent enough to flag here:** this week's own Weekly Strategy
run (id 603 in `homepage_team_runs`, i.e. the run this program-manager audit is a sub-step of)
shows `status='failed'`, `error='auto-expired: no recorded activity for 120 minutes'`, started
12:05:16 UTC, reaped 14:16:14 UTC — before this sub-step even ran. This is the same
"P1 runtime error: Team run auto-expired" class the log-monitor has been auto-filing all week
(#5475 video, #5954 strategy/dev, #6262 content/trend-scout, #6553 social, and now #6706 for this
very run 603, plus #6707 for a same-day homepage/merchandise auto-expiry, run #599) — each with a
unique random `dedupeKey` suffix (`logmon-<hash>`) that never converges to one stable ticket, so the
underlying CLASS is never root-caused even though every individual occurrence gets filed. Notably,
suggestion #5252 (`strategy-run-idle-timeout`, applied 2026-08-24) requested exactly the
120-minute strategy timeout that just fired on run 603 — the fix that stopped zombie strategy runs
from blocking QA/Apply for up to 240 minutes has, as an apparent side effect, made the multi-substep
weekly strategy routine itself (which invokes 5+ sub-agents in series, this program-manager step
included) trip the SAME lowered threshold when it runs long. This is not a tracker-tracked program,
so no suggestion is filed here for it, but it belongs in this week's scoreboard and deserves a
direct owner/tech-architect look: either weekly strategy needs to post heartbeat events between
sub-steps, or its own idle-timeout override needs to be wider than the other strategy run types it
shares a threshold with.

Suggestions filed this run: none for this tracker — every remaining RED/AMBER gap is already
covered by a non-terminal prior row (#57 email, #5233 review-invite pipeline) or is an owner-only
decision routed to the brief instead of the bus (p0-7-valves, p2-10-tierc-trust-review,
p1-7-frontdoor, and now p1-2-compare's definitional question).

**Asks for the owner (carried, updated):** (1) p0-7-valves L1–L9 checklist, now 6 weeks overdue,
remains the cheapest unblock in the roadmap. (2) p2-10-tierc-trust-review's revisit is ~2.7 weeks
overdue: decide whether to add a carried-brand/allowlist condition to Tier-C `autoImportPhase2`.
(3) p1-7-frontdoor and (new, same shape) p1-2-compare both need a definitional call: accept
what's actually shipping (keep-both variants; Notebook comparisons content) as satisfying the
milestone, or hold out for the originally-specified mechanism. (4) Six weekly tracker PRs
(`pm/tracker-2026-07-20` through `-08-24`) sit open and unmerged on the remote — worth a batch
look now that the count has climbed to six.


### 2026-08-24 (program-manager, run 482). Overall stays RED. Three genuine closes, real partial movement on two more.

Re-probed all 25 milestones against files on `main`, Sanity (live query via `SANITY_API_TOKEN`),
Neon (`pipeline_settings`, `review_invites`, `homepage_team_suggestions`/`suggestion_links`), and
`homepage_team_events`. Three rows changed, all genuine closes on suggestions filed last audit:

- **p1-4-plp-filter: RED → done.** Suggestion #3889 (applied) landed exactly the fix its own
  DONE WHEN named: `loadCollectionDeals` now branches on `filtersApplied` — any facet param triggers
  a KV-cached whole-collection fetch (`getCollectionAllDeals`), server-side filter, then paginate;
  unfiltered requests keep the fast per-page cursor path. `VaultCard` (on this route) carries a real
  quick-add wired to `/api/cart`. Both AND-halves pass on `main`.
- **p1-8-pdp: AMBER → done.** Suggestion #3891 (applied) shipped `enrichment-coverage.server.ts`, a
  live Shopify walk (not the generation cache) that tallies per-field enrichment coverage, rendered
  in `admin.imports.tsx` via a `CoveragePanel` with a Refresh action. Combined with the
  already-confirmed MAP-restricted PDP price path, both halves pass.
- **p1-9-monitoring: AMBER → done.** Suggestion #3890 (applied) shipped
  `structured-data.contract.test.tsx`, a vitest test inside the existing required `npm test` step of
  `ci.yml` — deliberately test-only so it never touches a protected `.github/**` path — asserting
  every structured-data component emits well-formed, correctly-`@type`d ld+json plus static
  route-wiring. **Correction to the record:** last audit's RED-on-this-half verdict came from
  grepping `.github/workflows/` for JSON-LD keywords, which missed that CI validation can live inside
  an existing workflow's test step rather than a dedicated file — a probe-methodology gap, not a
  moving target, and worth remembering for future CI-presence checks on this and other trackers.

**Two more real partial moves, RAG unchanged:** **p0-1-email** — two email-team campaign rows
(#4117 Wand Week, #4118 Air Pulsation) now sit `approved` for the first time ever, so last audit's
"zero campaign rows ever approved" no longer holds; the probe still fails outright, because
`email_campaign_push_enabled` stays unset and `scripts/push-approved-campaigns.ts` exits at that
valve check before touching Klaviyo — zero sends logged, stays AMBER. **p0-3-enrich** — Shopify-blind
this session again (no Shopify creds in the sandbox), so the `moodTags` coverage half stays
unverified and capped at AMBER per README; the live-draining-cohort half stays measured-healthy
(enriched_7d 79, published_7d 79) but `enrich_stuck` doubled (26→52) and `enrich_failed`(parked)
nearly tripled (~10→28) week over week — a growing risk worth a closer look even though it hasn't
yet broken the tracked AND-condition.

**Four REDs carried unmoved (checked, no new evidence):** **p0-4-reviews** (`review_invites` still 0
rows ever, `reviews_pdp_enabled` correctly `false`); **p0-7-valves** (L1–L9 checklist still never
recorded in this log, now 5+ weeks overdue); **p1-2-compare** (live Sanity query this run:
`count(*[_type=="comparison"])` is still 0 — but genuinely improving process, not a stalled one: the
production-quota instructions from suggestion #3892 landed in both `content-plan.md` and
`routine-seo-curation.md`, and this week's SEO curation run (462, 2026-08-23) explicitly evaluated
the quota and correctly declined to seed a doc rather than fabricate a match — "the Sunday head-to-head
is a DISTINCTION, not a clean two-product both-sides-real match... skip and say so." Content is still
zero, so RAG stays RED, but the mechanism is now demonstrably working as designed, not stalled);
**p2-10-tierc-trust-review** (no dated owner decision in this log, revisit date now ~6 weeks overdue).
p1-7-frontdoor unchanged AMBER (still the ADR-vs-keep-both judgment call flagged to the owner).

**Also verified, not a tracker row:** `pricing_changes` (referenced in p2-9-pricing-converge's own
probe as the table to retire) is confirmed empty-ever, but `pricing_audit_log` — the v2 mechanism —
has 405,257 rows with a fresh `trigger:'batch'` write at 2026-08-24 07:05 UTC, so routine 13 (Daily
Pricing Sweep) is genuinely running; it simply outputs to a different table than the one this run's
input context flagged as unverifiable. No action needed; noted here so the ambiguity does not recur
next audit.

**Routine coverage check** (scope derived from `routine-schedule.md`'s 24 rows, last 7 days): clean,
0 mandatory misses. Last week's routine 21 (Daily Support Review) total-miss is resolved (3 runs this
week, `homepage_team_runs` team=support, 08-19/21/23) — not yet at full daily cadence (3 of 7 expected
days), watched but not filed, per this run's brief. 0 half-enabled valve-on/no-trigger misses: every
enabled valve has a recorded trigger id per `routine-schedule.md`. R-WATCH (22) and R-SHEP (23) write
no run rows by design, not checkable this way. R-ENRICH (24, live since 2026-08-22) is new and has run
rows both days since creation — healthy, no gap.

Suggestions filed this run: none for this tracker (every remaining RED/AMBER gap is already covered
by a non-terminal prior row — #57 blocked, or is an owner-only decision routed to the brief instead
of the bus — p0-7-valves, p2-10-tierc-trust-review, p1-7-frontdoor).

**Asks for the owner (carried):** (1) p0-7-valves L1–L9 checklist remains the cheapest unblock in the
roadmap, now over a month overdue. (2) p2-10-tierc-trust-review's revisit is ~6 weeks overdue: decide
whether to add a carried-brand/allowlist condition to Tier-C `autoImportPhase2`. (3) p1-7-frontdoor
still needs a call: write the formal ADR, or accept the keep-both state as the real answer. (4) Five
weekly tracker PRs (`pm/tracker-2026-07-20` through `-08-17`) sit open and unmerged on the remote,
because neither the release engine nor this program is able to merge them — worth a batch look.


### 2026-08-17 (program-manager, run 359). Overall stays RED. Nine row changes, four genuine closes.

Re-probed all 25 milestones against files on `main`, Sanity (query access available this run via
`SANITY_API_TOKEN`), Neon (`pipeline_settings`, `review_invites`, `reviews`), `homepage_team_events`,
and the suggestion bus. Nine rows changed:

- **p1-1-guides: not-started → done.** 15 live `blogPost` docs (Sanity-confirmed) carry category
  guides/comparisons, past the ≥10 bar. `gsc_snapshots` captured today shows `/notebook/do-kegel-exercisers-work`
  with live impressions — direct evidence of indexing.
- **p1-5-discounts: not-started → done.** `shopify-discounts.server.ts` has a real fail-closed hard
  MAP gate (`decidePromo`) and mints only from `approved` suggestion rows via
  `scripts/execute-approved-promos.ts`. Both probe halves pass.
- **p1-3-plp-copy: AMBER → done.** Sanity access confirmed 172/172 `collectionPage` docs carry
  genuinely unique `introCopy` (spot-checked, not a generic fallback).
- **p1-6-llms: AMBER → done.** `app/routes/[llms-full.txt].tsx` now exists, inlining FAQ/About/Notebook
  content bounded by `MAX_INLINE`. Combined with the already-curated `[llms.txt].tsx`, both halves pass.
- **p0-1-email: RED → AMBER.** Real Klaviyo campaign infra found (`klaviyo-campaigns.server.ts` +
  `scripts/push-approved-campaigns.ts`, fail-closed, owner-email review) — genuine partial progress
  after 4 weeks at RED. Still fails the probe: no admin-dashboard surface (CLI script only),
  `email_campaign_push_enabled` unset, zero email-team campaign rows ever reached `approved`, zero
  test sends logged.
- **p1-8-pdp: GREEN(not-due) → AMBER.** MAP-restricted PDP price path confirmed. Admin
  enrichment-coverage half only partial (coarse timestamp counts, no per-field tag coverage).
- **p1-9-monitoring: GREEN(not-due) → AMBER.** GSC week-over-week anomaly alerting confirmed real.
  No CI JSON-LD/structured-data validation found anywhere in `.github/workflows`.
- **p1-4-plp-filter: GREEN(not-due) → RED.** Target week reached; the collection loader filters
  client-side over the single fetched 24-item page (`useMemo` over `deals`), not server-side across
  the full collection — the exact anti-pattern the probe was written to catch. No quick-add either.
- **p2-10-tierc-trust-review: GREEN(not-due) → RED.** Revisit date (~08-12) passed with no dated
  owner decision logged. Owner-only policy call, flagged in the brief rather than filed as a
  suggestion.

**p1-2-compare stays RED** but its shape changed: the infra shipped (route, `.md` twins, Sanity
`comparison` doc type all confirmed on `main`, suggestion #2389 applied), but zero comparison docs
have ever been published (`count(*[_type=="comparison"])` = 0 in Sanity). The gap is now content,
not code — suggestion #3892 filed (instructions, content) for a production quota rather than more
engineering.

Four P0 REDs carried unmoved (checked, no new evidence): **p0-4-reviews** (0 review invites ever
sent, valve correctly off; suggestion #114 was dismissed by the owner since last audit — treated as
a stable owner-choice state, not refiled), **p0-7-valves** (L1–L9 checklist still never recorded,
now 4 weeks overdue). p1-7-frontdoor unchanged AMBER (still the ADR-vs-keep-both judgment call
flagged to the owner).

**Routine coverage check** (scope derived from `routine-schedule.md`'s 22 rows, last 7 days): 20/22
expected-and-ran clean, including SEO curation (run 343, 08-16) and Podcast Review (run 281, 08-12)
which are tagged `run_type='manual'` in the DB, not the routine-name string — verified by summary
content, not the type column, so a naive `run_type` filter undercounts. **1 no-run miss filed**:
routine 21 (Daily Support Review) — valve ON, trigger recorded
(`trig_01J4JPPmzdtgg8UBpHDmbwTu`, documented first fire 2026-08-16 16:30 UTC), zero
`homepage_team_runs` rows ever for `team=support` as of this audit, a full day after the documented
first fire. Suggestion #3894 (process). **0 half-enabled valve-on/no-trigger misses.** Two
newly-flipped valves checked per this run's brief: `video_team_enabled` (flipped 08-16, trigger
`trig_01QBLBTi9sS7X7FjFXAvPfkw` created same day, first natural fire tomorrow 08-18) — an
owner-supervised smoke run already surfaced a real infra fault (`video_jobs` row 1 failed
`ENOSPC: no space left on device`), suggestion #3893 filed before the routine's first scheduled
fire hits the same wall; `x_autopublish_enabled` (flipped this week) rides the existing hourly
`/cron/social-publish` Vercel cron already covered by routine 6's infra, not a separate scheduler
trigger — no gap.

Suggestions filed this run: #3889 (p1-4-plp-filter, code, homepage), #3890 (p1-9-monitoring, code,
strategy), #3891 (p1-8-pdp, code, product), #3892 (p1-2-compare content quota, instructions,
content), #3893 (video ENOSPC, code, strategy), #3894 (routine 21 no-run miss, process, strategy).
All carry `dedupeKey:tracker:<tag>`.

**Asks for the owner:** (1) v5-checkin (voice-register-v5-trial) is due this exact week — see that
tracker. (2) p2-10-tierc-trust-review's revisit is now overdue: decide whether to add a
carried-brand/allowlist condition to Tier-C `autoImportPhase2`. (3) p0-7-valves L1–L9 checklist is
now 4 weeks overdue and remains the cheapest unblock in the roadmap. (4) p1-7-frontdoor still needs
a call: write the formal ADR, or accept the keep-both state as the real answer.


### 2026-08-10 (program-manager, run 249). Overall stays RED. Seven row changes — first genuine multi-milestone movement since the tracker opened.

Re-probed all 25 milestones against files on `main`, Neon (`import_candidates`, `pipeline_settings`, `reviews`, `review_invites`), and the suggestion bus. Seven rows changed:

- **p0-2-restock: RED → GREEN (done).** Genuine win. PR #471 merged (suggestion #55, applied, QA-verified 2026-08-03): `server/webhooks.ts` fires `triggerBackInStock` on the real sold-out→in-stock crossing via `isRestockCrossing`; no longer early-returns on restock. Both probe halves confirmed on `main`.
- **p0-3-enrich: RED → AMBER.** Re-audited against the "batch_jobs is dead" premise this tracker had carried RED for ~3 briefs (flagged by product-team suggestions #1623/#1784/#2156) — it does not hold. The enrichment mechanism changed weeks ago (cheaper single-call enrichment replaced the batch path; `batch_jobs` sits empty/unused now, so the original probe was written against a retired mechanism). Real evidence: `import_candidates` shows max enriched/published both 2026-08-10, 108 enriched + 108 published in the last 7 days, only 24 stuck (down from 289 stuck for weeks in July), 0 stuck on the publish half. Catalog-wide coverage is strong (tagline 99.1%, FAQs 98.9%, sensation dial 98.9%) but `moodTags` sits at only 49.3% — a real gap, already tracked by approved suggestion #1278. Not carrying the stale dead verdict forward.
- **p0-8-links: RED → dropped.** The hardcoded `/for-him`/`/for-her` links still exist in code but sit inside the legacy-variant render branch, unreachable now that `HOME_VARIANT` defaults to `b` and daily deals retired 2026-08-03. Owner dismissed suggestion #56 as moot 2026-08-06 for exactly this reason. Dropped rather than carried RED against dead code.
- **p1-2-compare: GREEN → RED.** Target week 2026-08-10 (today) reached, zero evidence: no `/compare` route, no comparison Sanity doc type. Suggestion #2389 filed.
- **p1-3-plp-copy: GREEN → AMBER.** Target week reached; this run has no Sanity query access to verify `collectionPage.introCopy` coverage. Unverifiable probe capped at AMBER per README, not guessed.
- **p1-6-llms: GREEN → AMBER.** Target week reached with partial evidence: `[llms.txt].tsx` is genuinely curated (confirmed), but no `llms-full.txt` route exists. Suggestion #2391 filed.
- **p1-7-frontdoor: GREEN → AMBER.** Target week reached with partial evidence: the code-level default-to-`b` decision is well documented in `home-variant.server.ts` as a de facto record, but no formal ADR names a winner and no route 301s — `/discover` deliberately still serves variant `a` by design, so this milestone's literal definition (one winner, losers 301) may need revising against the actual keep-both product decision. Flagged as an owner/tech-architect judgment call for the brief, not filed as a mechanical suggestion.

Four P0 REDs carried unmoved: **p0-1-email** (still no Klaviyo campaign-execution functions in `klaviyo.server.ts`; suggestion #57 blocked, non-terminal, not refiled), **p0-4-reviews** (still 0 review invites ever sent, valve correctly off; suggestion #114 approved, non-terminal, not refiled), **p0-7-valves** (L1–L9 checklist still never recorded in this log, now ~4 weeks overdue — though the PDP stock-indicator half of the probe now genuinely passes: `_layout.products.$slug.tsx` carries a real `stockIndicatorQty` computed off the same purchasability signal as the waitlist path, no fabricated scarcity; the AND still fails on the owner-only checklist half).

**Routine coverage check** (all 22 routines in `routine-schedule.md`, last 7 days): zero no-run misses, zero half-enabled live-but-dead states. **#1031 is RESOLVED**: routine 16 (Trend Scout) fired run 227 on 2026-08-08 on schedule (trigger created 2026-08-05); routine 20 (Social Trend Scout) has trigger + valve on since 2026-08-06, its first scheduled fire since enabling is later today (17:07 UTC) so no run is expected yet — not a miss. Two new non-tracker risks surfaced (neither meets this run's mandatory-suggestion bar since both have run rows): routine 16's run 227 is structurally blocked — the `trendTopicBrief` Sanity doc type was never deployed, so 5 researched topics could not be written; already covered by suggestion #2048 (approved, non-terminal). Routine 17 (Business Research)'s first live fire on 2026-08-06 double-fired within one second (one run skipped at the gate, the other hung ~6h then failed) and produced zero `researchBrief` output; no suggestion covers this yet, worth a follow-up if it recurs.

Suggestions filed this run: #2389 (p1-2-compare, code, homepage), #2390 (p4-changelog — design-elevation tracker, instructions, homepage), #2391 (p1-6-llms, code, content). All carry `dedupeKey:tracker:<id>`.

**Asks for the owner:** (1) p0-7-valves L1–L9 checklist is unchanged for 4 weeks and remains the cheapest unblock in the roadmap. (2) p0-1-email needs real engineering scoping (Klaviyo campaign client + admin surface), unmoved for 3 weeks. (3) p1-7-frontdoor needs a decision: write the formal ADR, or accept the keep-both (`/` = b, `/discover` = a) state as the actual answer and revise the milestone's definition to match.

### 2026-08-03 (program-manager, run 162). Overall stays RED. No row changes.

Re-probed all 25 milestones. No RAG changes this week; overall stays **RED**. The six P0 REDs all carried unmoved:

- **p0-1-email** — `app/lib/klaviyo.server.ts` still has no campaign-execution functions; `email_team_enabled` still OFF.
- **p0-2-restock** — no back-in-stock Klaviyo path; `handleInventoryUpdate` unchanged in shape.
- **p0-3-enrich** — enrich/publish chain still dead; known cheap root cause (custom_id length) unfixed ~3 weeks. This is the #1 catalog blocker; imported SKUs never reach the storefront.
- **p0-4-reviews** — 0 review invites ever sent; valve correctly still off.
- **p0-7-valves** — L1–L9 checklist still never recorded in this log (the owner half keeps it RED). Note: the PDP now carries active in-stock/sold-out label logic (`_layout.products.$slug.tsx` ~L795-800), so the stock-indicator half of the probe may have progressed — worth a closer re-verify next audit — but the L1–L9 owner action is unchanged.
- **p0-8-links** — `_layout._index.tsx` still hardcodes `ctaLink="/for-him"` (L691) and `ctaLink="/for-her"` (L699); both 301-hop via `RETIRED_ROUTE_TARGETS`.

P1 milestones (W6 = 2026-08-17) not yet due. Reminder: **p2-10-tierc-trust-review** revisit date (~2026-08-12) and the **p1-2-compare/p1-6-llms/p1-7-frontdoor** W5 targets (2026-08-10) are one week out — next audit is the last clean check before those hit. No new suggestions filed (every P0 RED is already covered on the bus by an approved row; the gap is execution/owner, not suggestion volume).

**Asks for the owner (carried, unmoved):** (1) p0-7-valves L1–L9 checklist (~30 min) is still the cheapest unblock in the roadmap. (2) p0-2-restock and p0-8-links remain ~1-hour zero-risk fixes — good R-DEV / apply-pass candidates. (3) p0-3-enrich's known root cause has sat unfixed for ~3 weeks and is blocking the entire import→live path.

### 2026-07-27 (program-manager, run 100). Overall stays RED.

Re-probed all 25 milestones. Four rows changed:

- **p0-6-alerting: RED → GREEN (done).** Genuine win. PR #282 shipped the owner digest (`owner-alerts.server.ts` + `owner-digest.server.ts`, Zoho SMTP/Twilio) and the authenticated read-only valve-snapshot route (`api.team.status.tsx`), closing the §4.6 auditability gap. Both halves of the probe now pass.
- **p0-3-enrich: AMBER → RED.** Target week reached with no progress: the same 3/3 `full-enrichment` batch jobs are still failing on the identical bug since 07-13, zero retries in 2 weeks, and 289 import_candidates are stuck (imported, enriched_at NULL) since 07-20. Known cheap root cause (custom_id length). Suggestion #111 filed.
- **p0-4-reviews: AMBER → RED.** Target week reached, still 0 invites ever sent, valve correctly off. Suggestion #114 filed.
- **p2-6-design: not-started → done (housekeeping).** Mirrors design-elevation's p1-doctrine (done since 07-13); this mirror row had never been updated.

Four P0 REDs carried unmoved from last week: p0-1-email, p0-2-restock, p0-7-valves, p0-8-links. Overall stays **RED** (6 milestones RED on the critical path). Suggestions filed this run (108-111, 113-114): p0-7 valves (owner), p0-2 restock (homepage), p0-8 links (homepage), p0-3 enrich (product), p0-1 email client (homepage), p0-4 reviews (owner).

Routine-coverage check (routines 2-14, last 7 days): all 13 produced a run row, zero misses. Correction to keep the record straight: #12 Podcast Review is NOT a miss — it fired 2026-07-22 (Wed) logged as `team=content, run_type=manual` and skipped honestly under the no-stack-pending-brief rule; a `%podcast%` run_type grep was the wrong probe.

**Asks for the owner:** (1) p0-7-valves L1-L9 checklist (~30 min) is still the cheapest unblock in the roadmap and nothing has touched it in 2 weeks. (2) p0-2-restock and p0-8-links remain ~1-hour zero-risk fixes, good agent-editor apply-pass candidates. (3) p0-3-enrich has a known root cause sitting unfixed for 2 weeks.

### 2026-07-20 — first real audit: overall flips to RED

Recomputed all 25 milestones against evidence (files on `main`, `batch_jobs`/`pipeline_settings`/`homepage_team_runs` rows, live routes). W2's five P0 milestones targeted today; four probes fail outright and one passes:

- **RED (target reached, zero evidence):** p0-1-email (no Klaviyo campaign client anywhere in `klaviyo.server.ts`), p0-2-restock (`handleInventoryUpdate` still only rotates the deal on sold-out, never fires on restock; no back-in-stock Klaviyo path), p0-6-alerting (only Sentry + GitHub-issue alerting exists, explicitly excluded by the probe; no valve-snapshot route), p0-7-valves (L1–L9 never answered here; PDP stock indicator still commented out), p0-8-links (`_layout._index.tsx` still links straight into the retired, 301-ing `/for-him` and `/for-her` routes).
- **Done (probe passes):** p0-5-content-cron — cloud trigger has carried the routine since 2026-07-13 and 4 posts published live this week.
- **AMBER, next week's target (2026-07-27), real risk showing already:** p0-3-enrich (3/3 `full-enrichment` batch jobs failed, 0 succeeded), p0-4-reviews (0 review invites ever sent, ~1 review row, valve correctly still off).
- **P1/P2:** target weeks not yet reached; left GREEN this run except a note on p1-7-frontdoor (HOME_VARIANT default flipped to `b` this week ahead of the formal ADR — check next audit) and p2-6-design (now genuinely true given design-elevation's p1-doctrine done, though that tracker's own p1-stack is RED).

Overall flips **GREEN → RED**: five P0 milestones on the critical path are RED past their W2 target. Filed process suggestions for the three highest-leverage REDs this run (p0-2-restock, p0-8-links — both cheap XS fixes; p0-1-email; p0-7-valves — unblocks re-scoping everything else) — capped at the suggestion-bus limit; p0-6-alerting is real but not filed this run, tracked in the audit scoreboard event instead.

**Asks for the owner:** (1) p0-7-valves is the cheapest unblock in the whole roadmap (XS, CONFIG+OPS) and several other milestones' scope depends on its answers — worth doing this week regardless of engineering bandwidth. (2) p0-2-restock and p0-8-links are both ~1-hour code fixes with zero design risk; good candidates for this week's agent-editor apply pass once proposed. (3) p0-1-email needs real scoping (client + admin surface) before it can move — recommend rr7-engineer picks it up next.

### 2026-07-13 — product-management bridge merged; deferred follow-ups tracked

The product-management bridge landed on `main` (PRs #254/#252/#253): Tier-C new-product auto-import, the daily `product` team routine, cheaper single-call enrichment + a quality gate, the import→storefront surfacing fixes (index refresh, draft-leak fix, New Arrivals rail + `/new` page), and the v2-only Nalpac price-drop cost-sync loop. All new behavior ships OFF (migrations 059/060/061 seed switches false). Two milestones added to track the deliberately-deferred follow-ups, both captured in **issue #255**:
- **p2-9-pricing-converge** — ADR-007 decision 4. We shipped "contain now" (price-drop loop is v2-only, v1 fenced off + documented); the real v1→v2 convergence remains, so `ADR-007`'s "tracked" pointer now has a real row.
- **p2-10-tierc-trust-review** — owner accepted "admit all Tier-C vendors" to unblock the summer catalog; revisit ~2026-08-12 whether to add a carried-brand/allowlist condition (regulated-category compliance). Set a reminder for the owner.

### 2026-07-12 — seeded (baseline)

Overall GREEN. Tracker created from the full store audit (docs/audits/2026-07-full-store-audit.md). All milestones `not-started` by definition; no probes pass yet. First real audit lands with the next Monday weekly strategy run. Note for that run: the §3 live-state checklist (L1–L9) is the first thing to resolve — several milestones re-scope based on its answers.
