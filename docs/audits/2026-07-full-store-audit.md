# Full Store Audit — Automation, SEO/AEO/GEO, PDP/PLP/Discovery (July 2026)

**Supersedes:** `docs/agent-automation-audit-2026-07.md` (its three verified defects are fixed in-tree; its §5–6 roadmap is carried forward into the roadmap below).
**Goal audited against:** $2,000/month profit within 3 months of launch; world-class SEO, AEO, and GEO versus competitors.
**Method:** three parallel deep code sweeps (automation architecture, SEO/AEO/GEO surface, PDP/PLP/discovery), plus repo-source passes by `seo-pdp-auditor` and `aeo-geo-auditor` (Appendices A–B). Live-state checks that require prod access are collected in §3 as an owner verification checklist — this audit ran in an environment where the live site, Shopify Admin, Vercel, and the Neon DB were unreachable, which is itself a finding (§4.6).
**Progress tracking:** the roadmap in §7 is mirrored milestone-for-milestone in `docs/store-team/trackers/automation-audit-roadmap.md`, owned by `program-manager` and audited weekly under the strategy routine. That tracker is the living source of truth; this report is a point-in-time snapshot.

---

## 1. Executive summary

The store's automation *architecture* is unusually complete for its age: a six-team agent plane (homepage, social, ads, email, strategy, content) over a shared control plane with budgets, kill switches, a run/event feed, a suggestion bus with two human gates, and a weekly strategy brief. The technical SEO/AEO/GEO layer is likewise well above the market bar. The gaps are concentrated in three places:

1. **Revenue plumbing is missing where the agents are already waiting.** Email campaigns (no Klaviyo campaign client), discount minting, referrals/loyalty rewards, IG/TikTok posting, and inbound support email are all propose-only stubs. For a category locked out of mainstream paid acquisition, email is the single largest uncovered revenue surface.
2. **The answer layer is empty.** All the machinery to win SEO/AEO/GEO exists — llms.txt, per-page `.md` twins, 12 JSON-LD types, keyword bank, content agents, a 30-topic plan — but roughly one Notebook post is live, zero guides, zero comparisons, zero programmatic landing pages. LLMs and search engines cannot cite content that was never written. The content-writer routine has published nothing because it runs as a desktop scheduled task that requires the owner's Claude app to be open.
3. **Product-data coverage silently caps everything downstream.** Enrichment of the ~1K imported draft cohort is incomplete; bare products render plausible generic fallback copy on the PDP (invisible thinness), are suppressed from discovery rails (no tags), and would poison any future programmatic pages. Reviews are fully built but valve-off with zero reviews, so no PDP emits `aggregateRating` and no rich-result stars appear.

**Top five moves** (full roadmap in §7): ship the Klaviyo campaign client → complete the enrichment batch → stand up the review corpus and flip `reviews_pdp_enabled` → move content-writer to a Vercel cron and start the guide/comparison sprint → then convert the mood/audience/matters taxonomy into programmatic landing pages.

Verdict: the store does not need more architecture. It needs **execution plumbing on four revenue paths, completion of product data, and a content corpus** — most of it dispatchable to agents that already exist.

---

## 2. Scope and competitive frame

Sexual wellness is ad-restricted on Meta, Google Shopping (partially), TikTok, and most display networks (`docs/ads-policy.md`). Competitors therefore win on: organic/LLM discoverability (guides, comparisons, category landing pages), email/SMS lifecycle revenue, review corpus depth, and discovery UX. That ranking drives the prioritization in §7: paid ads stay propose-only by policy; the owned channels must be world-class because they are the only scalable ones.

## 3. Live-state verification checklist (owner action required)

The repo cannot prove prod state for the items below. This session additionally could not reach xdipx.com (network policy), Shopify Admin, Vercel, or Neon (MCP approval gates). Each item is a one-line check; several roadmap items collapse or change priority depending on the answers.

| # | Check | How | Decides |
|---|---|---|---|
| L1 | Was migration `052_enable_teams.sql` applied to prod? (`SELECT key,value FROM pipeline_settings WHERE key IN ('homepage_team_enabled','strategy_team_enabled','suggestion_apply_enabled','import_monitor_phase','product_manager_enabled','import_enrich_enabled')`) | Neon SQL or `/admin/homepage-team` tabs | Whether the five teams + unattended import→live chain are actually running. Code defaults are all OFF; 052 flips them ON. The repo cannot tell which world prod is in. |
| L2 | Are migrations 053–057 applied? | `SELECT * FROM pipeline_settings WHERE key IN ('content_team_enabled','keyword_research_enabled','seo_curation_enabled','reviews_pdp_enabled')` + `\d gsc_snapshots` | Content team, SEO valves, review-invite `send_after`, GSC snapshot table |
| L3 | Are the 15 Vercel crons firing? (post-#236 `vercel.json` is authoritative) | Vercel dashboard → Crons; runtime logs for 200s on `/cron/warm`, `/cron/homepage-healthcheck` | Whether monitoring/self-heal/import pipeline are live |
| L4 | GSC service-account env vars set? | Vercel env (`GSC_SA_JSON` etc.) | `/cron/gsc-snapshot` is a silent no-op without them |
| L5 | Do the 8 cloud routine triggers still exist and fire? | Claude scheduler vs `docs/store-team/routine-schedule.md` trigger IDs; `runs` table rows | Agent plane liveness (the manifest's own smoke test is still marked outstanding) |
| L6 | Approved review count | `/admin/reviews` | Scope of P0-4; `reviews_pdp_enabled` must not flip before ≥1 real approved review exists (055 comment, Google policy) |
| L7 | Enrichment coverage counts: products missing `xdipx.product_type_dial` / mood/audience/matters tags; draft-status count | Shopify Admin GraphQL (`productsCount(query:"status:draft")` + metafield spot-check) | Exact size of P0-3 batch |
| L8 | Klaviyo account state: lists, flows, API key scopes | Klaviyo dashboard | Whether P0-1 is greenfield or partial |
| L9 | Which homepage variant serves `/` in prod (`HOME_VARIANT` / Sanity `activeVariant`) | View source on xdipx.com | Baseline for P1-7 front-door consolidation |

## 4. Automation architecture audit

### 4.1 What is genuinely closed-loop today (per repo state)

- **Deterministic control plane:** 15 Vercel-scheduled crons (`vercel.json`, restored as authoritative in #236; `cron.yml` demoted to manual-only): feed processing, deal rotation, pricing recompute + Nalpac cost webhook, import monitoring, enrichment batch poller, profit summary, log monitor, homepage healthcheck + rollback, AEO surface check, cache warming, GSC snapshot, review reminders.
- **Webhooks:** order-created (profit metafields + Meta CAPI with self-healing retry queue + referral capture), fulfilled (review invites via `send_after` rows — the old dead `setTimeout` is fixed), returns auto-refund, sold-out deal rotation.
- **Homepage merchandising (Routine A)** auto-publishes content-only changes within gate/budget/image caps, with healthcheck rollback as the safety net — the one agent loop authorized to act unattended on the storefront, per the CLAUDE.md carve-out.
- **Conversational commerce** (web chat, SMS v2, IVR) — live, rate/budget/draft-order-capped.

### 4.2 Built but gated (config, not engineering)

Import→live chain (`import_monitor_phase=2` + `product_manager_enabled` + `import_enrich_enabled`), all six team enable flags, `suggestion_apply_enabled`, `seo_curation_enabled`, `keyword_research_enabled`, `reviews_pdp_enabled`, stock indicator on the PDP (built, commented out). Whether these are on in prod is exactly checklist item L1/L2.

### 4.3 Propose-only stubs missing execution plumbing (the revenue gap)

| Surface | Agent (exists) | Missing plumbing | Roadmap |
|---|---|---|---|
| Email campaigns | email-marketing-manager | Klaviyo campaign-API client + approval-gated send path | P0-1 |
| Back-in-stock | (webhook) | `handleInventoryUpdate` early-returns on restock; waitlist signups never trigger Klaviyo | P0-2 |
| Discount codes | promo-manager | Nothing mints a Shopify code; MAP guard exists only in the proposal | P1-5 |
| Referral/loyalty | loyalty-referral-manager | `?ref=` capture + `referrals` table exist; no codes, rewards, payouts | P2-2 |
| IG/TikTok posting | social-media-manager | Draft rows only; X alone has (double-gated) live plumbing | P2-3 |
| Support email | customer-service-emma | No inbound pipeline (agent def says so verbatim) | P2-4 |
| Paid ads | ads-manager | Propose-only **by deliberate policy** — not a gap | — |

### 4.4 Scheduling and alerting fragilities

- **Content-writer (routine 9) is a desktop scheduled task** that fires only while the owner's Claude app is open — zero posts published as of 2026-07-09 per the manifest itself. Fix is a cloud trigger or Vercel cron (P0-5).
- **The 8 cloud routine schedules live outside the repo**; `docs/store-team/routine-schedule.md` is the only versioned record and its own smoke test is still marked outstanding. Weekly strategy self-check is the only drift detector (L5).
- **Alerting is one-directional:** log-monitor and healthcheck file GitHub issues + Sentry, but nothing pushes/emails the owner; `review_settings.digestEmail` exists unused. Approval latency is the bottleneck once teams run (P0-6).

### 4.5 Doc/code drift

- `docs/agent-automation-audit-2026-07.md` — its three "verified defects" are all fixed in-tree (vercel.json restoration #236, migration 056 `send_after`, monthly valve-gated keyword-research via 055). Marked superseded by this report.
- `docs/import-monitor-runbook.md` still describes Phase 2 as "deferred/TODO" with different gate thresholds (margin ≥45%, qty ≥100) than the shipped code (`autoImportPhase2`: markup ≥ wholesale·1.08, qty ≥30, gap ≥3.0, tier A/B, MAP hard gate, 8/day cap, no margin floor — margin explicitly not a gate per owner direction). Reconcile in P2-8.
- Daily-deal *staging* (`orchestrateDealPipeline`) is still admin-button-only per the prior audit; daily deals are a deferred phase, so this stays parked.

### 4.6 Meta-finding: auditability

This audit could not verify prod from the execution environment (site blocked by network policy; Shopify/Vercel/scheduler MCPs approval-gated; no DB credentials in fresh clones by design). Anything that improves machine-checkable state-in-repo — committed routine manifests (exists), the program tracker pattern (#234), and a read-only `/api/team/status` style valve snapshot endpoint — compounds every future agent's effectiveness. A tiny authenticated read-only valve-state endpoint is folded into P0-6.

## 5. SEO / AEO / GEO vs the competitive bar

### 5.1 World-class already (keep, don't rebuild)

Dynamic sitemap with image namespace and per-source degradation; robots.txt allowing 18 named AI crawlers; spec-compliant `llms.txt`; `.md` twins for every route class with answer-shaped structure, canonical Link headers, and 410 parity; 12 JSON-LD components (Product with MerchantReturnPolicy/shipping, Organization, WebSite+SearchAction, BreadcrumbList, FAQPage, HowTo, VideoObject, BlogPosting, CollectionPage+ItemList, ItemList, featured Product, Person/ProfilePage); IndexNow; GMC feed with MAP awareness; 410s on archived deals in both HTML and `.md`; retired-route 301s; noindex-on-facets with self-canonical pagination; self-hosted fonts, AVIF `<picture>` hero, consent-defaulted analytics. Few competitors in this category have any of the GEO layer at all.

### 5.2 The gaps that decide the competition

1. **Answer layer is unwritten** (§1). The 30-topic content plan (guides Mon/Wed/Fri, comparisons Tue/Sun, care Thu, wellness Sat) exists; the corpus does not. Guides and comparisons are what LLM answers and mid-funnel SERPs actually cite. Six-to-ten weeks to index means the sprint must start immediately to pay inside the 3-month window (P0-5 → P1-1).
2. **No comparison surface.** Comparisons exist only as planned blog posts; no `/compare/x-vs-y` route or product-family comparison template. Highest-intent BOFU queries in the category ("X vs Y", "alternative to X") have no landing surface (P1-2).
3. **No programmatic pages from the taxonomy.** mood/audience/matters + product_type_dial is a ready-made pSEO matrix ("best {type} for {mood}", "{type} for {audience}") but exists only as one client-side `/discover` page. Gated on enrichment coverage; ship with quality bar + noindex-until-ready (P2-1).
4. **No review corpus → no `aggregateRating` → no stars.** Schema, moderation, invites, valve all built; corpus empty (P0-4).
5. **llms.txt bloat:** ~thousands of bare product URLs with no descriptions dilute citation quality; no `llms-full.txt` (P1-6).
6. **E-E-A-T ceiling:** all content bylined to an explicitly-AI persona with no human/expert reviewer, in a YMYL-adjacent category (P2-5).
7. **Monitoring is built-not-watched:** GSC snapshots stored with no anomaly alerting; LLM-citation tracking is a manual 20-query spot check; no CWV field data; no schema regression checks in CI (P1-9, P2-7).

## 6. PDP / PLP / Discovery audit

### 6.1 PDP (`_layout.products.$slug.tsx`)

Strong skeleton (gallery with video, sensation dial + vote, subscription offers, pairs-with/FBT, Emma's take streamed, FAQ/HowTo/Video schema, sticky mobile CTA). Gaps:

- **Silent thinness:** every `ProductSummaryGrid` card has generic fallback copy, so unenriched products look complete while carrying no real specs/FAQs/dial/take. No admin coverage dashboard exists to see which PDPs are bare (P0-3, P1-8).
- **Zero social proof** until P0-4 lands.
- **Stock indicator built but commented out** — a legitimate availability fact, not urgency theater; re-enable within voice rules (P0-7).
- **No MAP treatment on the PDP** (homepage has one) — compliance/consistency gap if any SKU is MAP-restricted (P1-8).
- **No cross-product comparison** and **no PDP→editorial links** (guides don't exist yet) (P1-2, P1-8).

### 6.2 PLP (`_layout.collections.$handle.tsx`)

Good schema/canonical hygiene and Emma rails. Gaps: **filtering is client-side over the loaded 24-item page only** — deep collections cannot actually be filtered, and facet vocabulary shifts per page (P1-4); intro copy falls back to Shopify description or a generic string on most collections (P1-3); no quick-add (P1-4); the legacy homepage variant still links "For Him/For Her" carousels into retired 301 routes (P0-8).

### 6.3 Discovery

Three front doors coexist (Compass `/discover`, storefront variant `b`, legacy deal home) — fragmenting internal links, analytics, and the visitor mental model; pick one and 301 the rest (P1-7, informed by L9). Discovery rails rank purely on tag overlap, so unenriched products are invisible — enrichment (P0-3) is a discovery fix as much as a PDP fix. Ask Emma (web + SMS) is a real differentiator competitors lack; once the answer layer exists, its transcripts are also a topic-mining source for seo-curator.

## 7. Prioritized roadmap

Type: CODE = reviewed PR (never auto-merged) · CONTENT = agent routine · CONFIG = valve flip · OPS = env/external. Every CODE item observes RR7 loader discipline, `.server.ts` boundary, Sanity additive-only, admin approval gates, MAP rules, Emma voice charter, mobile-first. Milestone tracking: `docs/store-team/trackers/automation-audit-roadmap.md` (program-manager).

### P0 — Weeks 1–2: revenue plumbing + force multipliers

| # | Item | Agents | Effort | Type | Why it moves $2k/mo |
|---|---|---|---|---|---|
| P0-1 | Klaviyo campaign execution client + approval-gated send (owner approves each campaign from the dashboard; agent briefs become executable) | rr7-engineer, email-marketing-manager, qa-reviewer | M | CODE+OPS | Email is the #1 lever in an ad-restricted category; converts the list the store already captures |
| P0-2 | Back-in-stock: extend `handleInventoryUpdate` to fire Klaviyo events against waitlist signups | rr7-engineer, shopify-ops | S | CODE | Pure leakage fix on already-captured intent |
| P0-3 | Enrichment completion: drain the imported draft cohort + close mood/audience/matters tag coverage (batch API path in `backfill-product-enrichment.ts`), sized by L7 | emma-product-enricher, emma-empathy-reviewer, media-manager | M (batch) | CONTENT | Unblocks PDP quality, discovery rails, PLP facets, and future pSEO simultaneously |
| P0-4 | Review program: verify invite flow live (056), legitimate post-purchase acquisition, flip `reviews_pdp_enabled` only once real approved reviews exist | shopify-ops, rr7-engineer, owner | S–M | CONFIG+OPS | Trust + star rich results in a trust-decided category |
| P0-5 | Content-writer off desktop scheduling → cloud trigger or Vercel cron; 2 posts/week cadence | rr7-engineer, content-writer | S | CODE+CONTENT | Zero posts despite full machinery; compounding must start now |
| P0-6 | Bidirectional owner alerting (push/email digest on pipeline failures + P0 issues) + read-only valve-state snapshot endpoint | rr7-engineer | S | CODE+OPS | Prevents silent automation death; fixes the auditability gap (§4.6) |
| P0-7 | Resolve §3 checklist: reconcile 052 state, GSC env vars, `keyword_research_enabled`, `seo_curation_enabled`, re-enable PDP stock indicator | owner, shopify-ops | XS | CONFIG+OPS | Several "gaps" may close for free |
| P0-8 | Fix legacy homepage For-Him/For-Her links into retired 301 routes | rr7-engineer | XS | CODE | Link-equity hygiene, ~1 hour |

### P1 — Weeks 3–6: answer layer + conversion surface

| # | Item | Agents | Type |
|---|---|---|---|
| P1-1 | Answer-layer sprint: 10–12 guides/FAQ posts from the 30-topic plan + keyword bank; YMYL-adjacent claims get a human review gate | content-writer, emma-copywriter, seo-curator, qa-reviewer | CONTENT |
| P1-2 | `/compare/x-vs-y` route + Sanity comparison doc type (additive), 3–5 seed comparisons with ItemList/FAQ schema and `.md` twins | rr7-engineer, sanity-content-builder, content-writer | CODE+CONTENT |
| P1-3 | Unique intro copy (100–150w, Emma voice) + FAQs per collection; facet-vocab normalization | emma-copywriter, seo-curator | CONTENT |
| P1-4 | Server-side PLP filtering across full collections + quick-add on cards | rr7-engineer, qa-reviewer | CODE |
| P1-5 | Discount-code minting via Shopify Admin API, approval-gated, hard MAP guard, wired to promo-manager proposals | rr7-engineer, promo-manager, pricing-ops | CODE |
| P1-6 | llms.txt slim (curated sections + described entries; drop bare product URL dump) + `llms-full.txt` | seo-curator, rr7-engineer | CODE |
| P1-7 | Discovery front-door consolidation: pick the winner (informed by L9 + GA4), 301 the losers, ADR the decision | tech-architect, product-manager, rr7-engineer | CODE |
| P1-8 | PDP: MAP treatment parity with homepage; PDP→editorial internal links; enrichment-coverage admin dashboard | rr7-engineer, emma-copywriter | CODE |
| P1-9 | GSC anomaly alerting over `gsc_snapshots` + JSON-LD regression check in CI | rr7-engineer, log-monitor | CODE |

### P2 — Weeks 7–12: compounding + expansion

| # | Item | Agents | Type |
|---|---|---|---|
| P2-1 | Programmatic pSEO routes from mood/audience/matters × product_type_dial (gated on P0-3 coverage; noindex until quality bar met; ItemList+FAQ schema; `.md` twins) | rr7-engineer, seo-curator, content-writer | CODE+CONTENT |
| P2-2 | Referral/loyalty execution: code generation, reward issuance on `referrals` rows | loyalty-referral-manager, rr7-engineer | CODE+OPS |
| P2-3 | IG/TikTok posting plumbing (approval-gated, voice-gated) | social-media-manager, rr7-engineer | CODE+OPS |
| P2-4 | Inbound support-email loop for customer-service-emma (draft-first, owner-send until proven) | customer-service-emma, rr7-engineer | CODE+OPS |
| P2-5 | E-E-A-T: human expert reviewer byline + review workflow for health-adjacent content | owner, content-writer | OPS+CONTENT |
| P2-6 | Design-elevation program Phase 1 kickoff (already planned; all milestones not-started) | homepage team, tech-architect | CODE |
| P2-7 | CWV field data (RUM) + automated LLM-citation tracking (replace the manual 20-query check) | rr7-engineer, aeo-geo-auditor | CODE |
| P2-8 | Doc reconciliation: import-monitor runbook Phase-2 drift; routine-schedule smoke test recorded | program-manager, process-optimizer | CONTENT |

### Dependencies

`P0-7 (L1–L9 answers) → may re-scope several items` · `P0-3 → gates P2-1, improves P1-4 facets + discovery rails` · `P0-4 → gates the reviews valve flip` · `P0-1 → gates discount-in-email (with P1-5)` · `P0-5 → gates P1-1 cadence` · `P1-7 decided before P1-4 lands` (don't build filtering onto a route being retired).

### Program gates

- **Week 2:** email plumbing live (one approved test send), enrichment queue drained, alerting live.
- **Week 6:** ≥10 posts indexed (GSC), reviews valve on with real reviews, PLP filtering shipped, comparison route live.
- **Week 12:** pSEO live and indexing, referral MVP live, store-strategist assesses $2k/mo run-rate trajectory.
- **Weekly:** program-manager RAG audit of the tracker; KPI block in the strategy brief: sessions, email revenue, review count, enrichment coverage %, indexed pages, LLM citations.

---

## Appendix A — seo-pdp-auditor pass (repo-source)

Live fetches were blocked by network policy, so this pass verified every check against source. **Score: 44 pass / 2 fail / 6 require live verification (52 checks).**

Confirmed passing in code: PDP canonical + single H1 + Product/Breadcrumb/FAQ/HowTo JSON-LD with brand, `inventoryLevel`, and valve-gated `aggregateRating` (`ProductStructuredData.tsx`); AVIF/WebP/JPG `<picture>` with responsive srcset (`ProductImageGallery.tsx`); PLP canonical/pagination/noindex-on-facets logic and CollectionPage+ItemList (`_layout.collections.$handle.tsx`); collections hub schema; homepage self-canonical never redirecting to the deal slug; sitemap completeness with image elements and retired-route denylist; 410 on archived deals.

**Defects found:**
1. **Product JSON-LD emits no `datePublished`/`dateModified`** — `deal.updatedAt` exists but is never exposed in `ProductStructuredData.tsx`. Freshness signal lost on every PDP. Fix is a one-liner; folded into P1-9's schema work (or ship immediately with P0-8).
2. **Empty-collection ItemList edge case** — `CollectionStructuredData.tsx:55–84` may emit an invalid empty ItemList for empty collections; needs a guard + live validation.

Requires live verification (blocked this session): real metaDescription quality, actual AVIF delivery, aggregateRating rendering once reviews exist, active homepage variant (code default is `legacy` unless env/Sanity flips it — feeds L9), enrichment ratio sampling, per-variant H1, OG image rendering, 375px rendering.

Fallback-masking table confirmed: "What it does", box contents, and Emma's take always render generic fallbacks when metafields are empty; sensation dial, pairs-with, and FAQs hide silently — matching §6.1.

## Appendix B — aeo-geo-auditor pass (repo-source)

Live fetches blocked; repo-source pass. **Score: 19/19 checks pass — surface judged deploy-ready.**

Confirmed: 12 `.md` routes with correct `text/markdown` content-type + canonical Link headers; llms.txt generated from the same loaders as the sitemap (no drift possible); HTML advertises every `.md` twin via `rel=alternate`; 410 parity; robots.txt allows all 18 AI crawlers with no auth/age-gate/geo-wall on markdown routes; answer-shaped structure enforced ("## What it is" factual lead, `###` Q&A pairs, plain-list specs, consistent brand facts, no urgency language); on-demand rendering with safe cache types and last-updated footers throughout.

Nuance vs §5.2(5): the auditor judged llms.txt structure spec-compliant and non-bloated *at typical catalog sizes*; whether the full-catalog product enumeration becomes dilutive depends on the live product count (checklist L7). P1-6 stands as a curation/quality improvement (described entries, curated sections, `llms-full.txt`) rather than a defect fix.

Surface-growth recommendations (fold into P1-1/P1-2/P2-1 scoping): comparison/versus guides, standalone category explainers, how-to/care guides, `/brands/{slug}` pages, curated "best for" lists; PDP additions — material certifications section, return/warranty callouts, low-stock signals; collection-level FAQ aggregation in `.md` twins.

Live verification still required (L-checklist companion): curl sample `.md` URLs with AI-crawler user agents, fetch live llms.txt/robots.txt to confirm prod parity.
