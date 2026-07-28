# Homepage Merchandising + SEO Diagnosis, 2026-07-27

Owner-triggered diagnosis of (a) why the homepage looks the same day after day despite an autonomous merchandising team, (b) the specific UX complaints from the 2026-07-27 review, (c) what merchandising staples the page is missing, (d) agent-team capability gaps, and (e) why only ~50 pages are indexed in Google. Built from five parallel agent passes (section-map forensics, 10-day run reconstruction from Neon/Sanity, instruction-layer audit, CRO gap audit vs the live teardown, SEO indexation audit) plus direct prod DB and live-site verification.

Everything here is diagnosis. Fix planning happens in the follow-up plan.

---

## 0. TL;DR: five root causes, in order of impact

1. **BUG, dominant, now fixed: the team's work never reached the page 7/24 to 7/26.** Run 85 wrote one malformed `emmaCuratedRail` doc (bare-string `productHandles`). The GROQ projection collapsed the handles to null, `.map(p => p.handle)` threw, the single rejected rail took down the whole `contentBlocks` `Promise.all`, and every `<Await errorElement>` silently swapped in hardcoded fallbacks: identical imageless mosaic tiles, algorithmic rails, imageless couples band, every day. Only the hero (non-deferred) kept updating. The team published full slates on 7/24, 7/25, 7/26 that were invisible. Fixed 7/26 in PR #322 (commit 92af2de) + #324.
2. **The gates cannot see the page.** The run's definition of done (HTTP 200, hero renders, link ratio) passes on fallback content, so runs 89 and 94 reported success while nothing they shipped was rendering. The design-critic screenshot gate has never executed in the cloud runner (Claude_Preview MCP not connected there; noted in runs 53, 65, 81, 85, 89, 91, 94, 99). Sameness was undetected until the owner reported it. Post-#324, publish propagation is ~15 min blob warm + 900 s edge + SWR 3600, while the playbook still claims 60 s (suggestion #104 filed).
3. **POLICY: the instruction layer is engineered for sameness.** Reuse-before-generate is written into six layers (orchestrator, media-manager, routine step 4, README cascade guards, store mission brief, designer/calendar handoffs). There is no fresh-image mandate and no per-run floor, only ceilings. Result: **zero images generated in 15 consecutive merchandise runs; $0.43 total image spend in 11 days against a $600/day budget (raised from $15 on 7/20) and a 100-image/day cap.** Freshness rules are weekly, not daily ("No two consecutive weeks with the same hero..."), "a run that publishes nothing is fine" (MB §10), sub-300-sessions/week traffic locks in "heuristics only, no swaps", and no gate diffs today's publish against yesterday's.
4. **POLICY: theme compliance exists in prose, no gate checks it, and no rule binds the hero to the theme.** Hero selection optimizes photogenic-first + margin + no-repeat. Run 99 (7/27) read Lube Literacy Week and deliberately picked the glass Icicles No. 87 (rationale recorded: lube hero already ran 7/20, glass photographs better than bottles, 57% margin, "glass is safe with EVERY lube"), executing the theme as three taxonomy rails (Water-Based / Silicone / Hybrid). With no visible campaign device (no takeover band, no theme framing beyond one announcement line), the page reads as "we sell lubricant" under a non-lube hero rather than as a lube-week campaign.
5. **A third of the page is code-locked shell no agent can touch, and the playbook is stale about the rest.** Trust bar, FAQ, Meet Emma copy/CTA, Sensation Map selection, notebook see-more, hero-image linking, and the "Show me" CTA target are all hardcoded. Meanwhile the playbook (routine-daily-merchandise.md) still tells the team `playTogetherBanner` is ignored by the storefront (false since the couples band now renders it) and only mandates hero + rails + notebook-override per run, so the wayfinder mosaic and Discover You tile sat 5 days and two themes stale even though they are fully Sanity-swappable.

**SEO in one line:** 48 of 4,608 sitemap URLs indexed, 0 newly indexed per day, 48 impressions and 5 clicks in the last 28 days; IndexNow dead (key file 404s live), 1,230 URLs stuck on Google-cached noindex verdicts from the May outage, ~2,715 URLs never crawled at all (orphaned; the homepage links ~20 products of 4,401), 252 crawled-but-rejected (thin PDP content). The monitoring infra for a daily diagnosis already exists and is live (gsc_index_daily, gsc_url_inspections, gsc_snapshots, 3-hourly sweep cron); what is missing is activation of the push levers and a daily reporting/alerting surface.

---

## 1. The owner's complaints, answered one by one

Lanes: **content** = the team can change it today via Sanity, **PR** = code change required, **playbook** = instruction change required.

| # | Complaint | Root cause | Fix lane |
|---|---|---|---|
| 1 | "Show Me" next to "Take a peek" is confusing | Secondary CTA is hardcoded: always links `/collections` (`StorefrontHome.tsx:210-219`). Its label just flips to whichever of "Show me"/"Take a peek" the primary is NOT using, purely to avoid duplicate labels. Worse, `/collections` is a 170-tile unmerchandised dump (100+ category tiles, mostly placeholder tints, plus 70 brand tiles), so the hero's second click lands a nervous first-timer on the worst page on the site | PR (CTA target + `/collections` hub) |
| 2 | Hero image not clickable to PDP | Confirmed: the product still has no `<Link>` ancestor (`StorefrontHome.tsx:242-265`). Only the button below it links | PR |
| 3 | Trust bar boring | It is a hardcoded 4-string JS array (`StorefrontHome.tsx:268-282`). A `trustBar` Sanity block exists but variant b filters it out (`homepage-payload.server.ts:145-150` whitelist). Also stated at minimum intensity: "Billed as XDIPX" as a flat bullet, vs the doctrine §6 named-fear promise pattern. Free-shipping threshold absent (and contradictory elsewhere, see §7) | PR + copy |
| 4 | Rail is lubes but See All goes to Best Sellers | `emmaCuratedRail.ctaLink` is an independent Sanity field; when the team leaves it blank the code falls back to `/collections/best-sellers` (`StorefrontHome.tsx:1060`). The playbook's per-run checklist never says "set ctaLink to match the products" | content + playbook |
| 5 | "Find your fit" is an anchor, not /discover | Deliberate: mission brief caps the page at two real `/discover` links, so the Meet Emma CTA is hardcoded `to="#discover"` (`StorefrontHome.tsx:474-481`), which scrolls to the Nº 09 band whose own identically-labeled button finally goes to `/discover`. A double hop with the same label at both ends | PR + mission-brief edit |
| 6 | Nº 05 unchanged for days | It IS Sanity-swappable (`wayfinderMosaic`) and team-authored, but it is not in the playbook's mandatory per-run list (only hero, rails, notebook override are), so it refreshes at best weekly. Currently 5 days and two themes stale ("slow night" content from 7/22 live during Lube Literacy Week), extended by the 7/24-26 fallback outage | playbook |
| 7 | Discover You image should follow the theme | Same block (`wayfinderMosaic.promo.image`), fully swappable today, same cadence gap as #6 | playbook |
| 8 | Nº 07 Find your feel always the same products | Code-locked: the SSR default state is deterministic (`defaultSensationState()` always picks `types[0]` + `feels[0]`, `sensation-map.ts:140-147`), there is no daily-content lever and no time-seeded rotation, and `TYPE_COLLECTION` only maps couples/massage so most "See the full fit" links dump to `/collections/best-sellers` | PR |
| 9 | Play Intimately Together should follow the theme | Sanity-swappable (`playTogetherBanner`) and actively curated, but the playbook explicitly (and wrongly) tells the team the storefront ignores this block, so the daily loop never touches it. Also: body copy is a greeting-card cliché with a 🖤 emoji (off-charter, brand mark is ♥), and the component's `rail` prop for a "chosen for sharing" strip is never passed (dead feature) | playbook + copy (+ PR to use the rail) |
| 10 | Notebook: last 3 posts, no see-more, no selling | `getBlogPosts({perPage:3})`, and `NotebookRail.tsx` has no see-all link. Tiles link only to posts, zero product/collection links, while `/notebook` is ~21% of all site sessions at 100% engagement, the only funnel with real traffic today | PR + content |
| 11 | FAQ questions are wasted space | Hardcoded `FAQS` array (`StorefrontHome.tsx:897-918`), no Sanity read. Q2 restates the trust bar. The same discretion claims are hand-written in three files (trust strip, FAQ, `Footer.tsx:70-74`) with no shared source | PR |
| 12 | New images should be generated each day | No instruction anywhere mandates generation; six layers mandate reuse-first; zero generated in 15 runs. The page has 8 swappable single-image slots (hero still, Emma portrait, 3-4 wayfinder tiles, Discover You promo, couples band, 3 notebook cards) that could carry fresh art daily | playbook + budget floor |
| 13 | Lube week but hero is not lube | Deliberate, documented policy pick (see §3). No rule binds hero to theme category; no gate would catch the miss | playbook + gate |

---

## 2. What the team actually did, 7/17 to 7/27 (run forensics)

Runs fire ~10:00 PT daily. Budget gate passed every run; the only skip was a duplicate double-start (run 66).

| Date | Published? | Hero live | Calendar theme | New images | Notes |
|---|---|---|---|---|---|
| 7/17 | yes | Kian Warming G-Spot | none (self-directed) | 0 | hero + rail refresh |
| 7/18 | yes | Kian (kept: "no superior candidate; 0 traffic did not justify churn") | Unhurried Night | 0 | 1 rail re-picked |
| 7/19 | minimal | Kian (Sunday content-only hold) | Unhurried Night | 0 | announcement only |
| 7/20 | yes | JO H2O Cooling (a lube) | Heat Wave, Cool Down | 0 | full flip, lube/care-heavy slate |
| 7/21 | yes | Intense Wand, off-calendar drift ("Slow nights in", never written to calendar, suggestion #72) | Heat Wave (ignored) | 0 | hero, 3 rails, tiles |
| 7/22 | copy only | Intense Wand (run 75 declined same-day flip) | Heat Wave (still ignored) | 17 gen calls, $0.43 (design standup run 72: 5 tiles + 3 PDP macros, heavy retries) | wayfinder art generated; still live today |
| 7/23 | yes | Nixie Mystic Wave (calendar realign) | Heat Wave | 0 | rails rewired to theme |
| 7/24 | yes, **page breaks** | We-Vibe Touch X | Heat Wave | 0 | run 85's malformed rail doc starts P0 #88; everything Sanity-driven falls back |
| 7/25 | published, invisible | Tantus Cush O2 | Heat Wave | 0 | owner reports empty slots; #88-#91 filed |
| 7/26 | deliberate hold | Cush O2 | Heat Wave, last day | 0 | PR #322 + #324 land, fix deployed |
| 7/27 | yes | Icicles No. 87 glass (deliberate non-lube) | **Lube Literacy Week** | 0 | full pivot: 3 lube rails, announcement; first run whose rails actually rendered since 7/24; wayfinder still stale |

Costs: ~2.45M input / 241k output tokens across the window, all on the Max subscription ($0 logged); $0.43 total metered image spend. Suggestions #46, #68, #72, #78, #88, #89, #90, #91, #99, #104 filed, all auto-approved (`homepage_team_auto_approve_suggestions=true`).

**Why the owner saw sameness:** (1) 7/24-26 everything below the hero was fallback content regardless of what the team did; (2) even in healthy weeks, images only change when the product changes because all art is reused catalog photography; (3) the wayfinder/couples surfaces refresh weekly-at-best by playbook; (4) rotation minimums are weekly (2 hero changes/week satisfies the brief); (5) sub-300-sessions/week policy explicitly holds slates ("keep" is the default verb).

---

## 3. The lube-week hero, precisely

`marketing_calendar` id16 "Lube Literacy Week" active from Mon 7/27. Run 99 read it and pivoted the page, then chose a glass wand hero on recorded rationale: (a) no-repeat rule, a lube hero ran 7/20 and run 85 had been steered away from "lube-heavy" toward the 70% product-forward PDP mandate; (b) mission brief §5 photogenic-first ("a great product with murky photos loses the hero slot"), clear glass vs a plastic bottle; (c) 57% margin at $60.29; (d) editorial argument "glass is safe with EVERY lube, anchors the core lesson", with the lube curriculum in the rails (11 of 12 rail slots are lubes). It is a POLICY-driven deliberate pick, fully documented. No instruction anywhere says the hero must belong to the theme's product category, and no gate checks theme match for hero/rails/tiles (the DoD checks theme only for Emma presets). Aggravators: until 10:35 PT Monday the hero was still Sunday's Cush O2 hold, and blob/edge propagation can add another 15+ min.

If the owner wants "theme-category product (or product+lube combo) in the hero during theme weeks", that is a one-line mission-brief constraint plus a DoD check. It does not exist today.

---

## 4. Instruction-layer findings (where the conservatism is written)

Quoted evidence in the instruction audit; summary:

- **Reuse-before-generate, six layers:** orchestrator budget guards ("Reuse before generate... A day featuring products that already have art ≈ $0"), media-manager first critical rule + "tag for reuse" (actively engineering recurrence), routine A step 4, README cascade guard 3, store mission brief §6, designer/calendar handoffs. Caps are ceilings (12 images/day then 100, $15/day then $600); **no floor exists anywhere**. Curated rails structurally cannot carry generated art (no image field); `gen-homepage-image.ts` only accepts `block|tile|promo` targets.
- **Anti-novelty by charter:** orchestrator ("judged on whether it helps a real visitor find and buy, not on novelty"), CRO agent ("if a change doesn't plausibly move sales, it doesn't ship"), store mission brief §1 ("novelty never").
- **Publish-skipping allowance:** MB §10 "A run that publishes nothing is fine." The counter-sentence ("...identical to yesterday is not") has no enforcing gate.
- **Sparse-data hold:** below 300 sessions/week the scoreboard "does not auto-trigger swaps" (repeated in 5 places). Current traffic ~26-51 sessions/week.
- **Freshness rules are weekly:** MB §3 "No two consecutive weeks with the same hero product, the same rail lineup, or the same tile artwork." Copy is the only per-run freshness surface. Day-level memory exists (step 2b keep/drop scoreboard) but its default verb is "keep".
- **Theme binding is prose:** required in MB §3 and routine step 2, checked by nothing (DoD, pick gate, self-validation, design-critic rubric all lack a theme dimension).
- **Stale playbook:** routine step 5 says `playTogetherBanner` is ignored by the storefront; false since `homepage-payload.server.ts` whitelisted it. The playbook also still cites 60 s publish propagation (now ~15-30 min).
- **Design-critic rubric** is doctrine-compliance only; a pixel-identical repeat of yesterday scores a clean PASS.

---

## 5. Merchandising gaps vs the teardown (CRO audit)

Live page inventory 7/27: Hero (Icicles, "It's hot before you are.") → trust strip → "Water-Based Lubricants" grid → Meet Emma → wayfinder + Discover You → "Silicone" rail → "Hybrid" rail → Sensation Map → Couples band → ink closer → Notebook (3) → FAQ (4) → email → footer. 12 of ~19 product cards are lube.

**Structural finding:** publishing any team rail unconditionally displaces the "most picked" bestseller anchor grid (`StorefrontHome.tsx:1053-1070`). The always-on bestseller anchor guardrail from the redesign brief exists only in a doc, not in code, so the current lube slate silently deleted it.

Missing staples (severity, teardown attribution in the CRO report):

1. **Bestseller / finite ranked set** (Blocker): no "most picked" anywhere; anchor slot consumed by a lube rail.
2. **Image-led collection entry doors** (Blocker): mood pills are text chips; all three wayfinder photo tiles deep-link single PDPs. Zero collection doors on the page.
3. **`/collections` hub is an unmerchandised 170-tile dump and the hero's secondary CTA points at it** (Blocker).
4. **New-arrivals / "just in" rail** (High): zero freshness signal on a 4.5k-SKU catalog with a live import pipeline; `new-arrivals` collection + `newest` sort already exist in code.
5. **Editorial→PLP funnel** (High, and the only measurable one today): Notebook is ~21% of sessions, links zero products.
6. **Gift / occasion framing** (High): absent entirely.
7. **Bundle/attach logic for consumables** (High): lube merchandised as browse rails instead of PDP/cart attach; `pairing_why` + `accessory_product_ids` metafields render nowhere on the homepage.
8. **Free-shipping threshold invisible until cart** (High, live trust bug): `FREE_SHIPPING_THRESHOLD = 99` hardcoded in `CartDrawer.tsx:11` and `emma-cart.server.ts:16`, while `_layout.collections._index.tsx` meta advertises "free US shipping over $59". Two numbers disagree.
9. **Theme takeover treatment** (Medium): zero committed tinted bands; every module on paper/paper-2; doctrine §1 says section rhythm is color.
10. **Borrowed credibility row** (Medium): LELO, Tantus, Sliquid, System JO etc. in catalog, never surfaced; card eyebrow inconsistent (brand on team rails, taxonomy elsewhere).
11. **Named guarantee** (Medium, blocked on owner naming it, teardown P0).
12. **Review proof** (correctly deferred until real order volume; plumbing exists behind `reviews_pdp_enabled`).

Section verdicts: KEEP Meet Emma, Sensation Map (but promote it above the rails; it is the page's genuine differentiator buried at position 7), ink closer, FAQ (reorder), email, footer (+P0 additions). FIX hero (secondary CTA, packshot-in-frame vs scene imagery, theme coherence), trust bar, wayfinder targets, couples copy, Notebook links. REPLACE the three-lube-rail slate with bestseller anchor + new arrivals + occasion edit.

GA4 reality: 37 homepage landing sessions / 15 users in 14 days, 322 `view_item_list` vs 4 `select_item`, 1 purchase. Nothing is A/B-measurable at this volume; decisions must be first-principles + teardown pattern until acquisition exists. Also: `home_scroll_depth` fires but its parameter is not registered as a GA4 custom dimension (emitting data nobody can read).

---

## 6. Agent-team capability gaps and recommendations

No new-agent hiring is strictly required to fix the bug class; the biggest wins are gates and mandates. Recommended, in priority order:

1. **Render-truth gate (fix the blindness).** DoD must verify team content actually rendered (fetch the live page and assert the published rail titles / tile headlines / hero handle appear in the HTML, not just HTTP 200), plus a hard failure when fallbacks render where team content was published. This directly prevents a repeat of #88 going unnoticed.
2. **Make the screenshot gate real.** design-critic cannot run in the cloud runner (no preview MCP). Either give the routine a headless screenshot path (the playwright capture recipe exists) or run design-critic against served HTML + stored images. A visual gate that never executes is a paper gate.
3. **Theme gate + hero-theme binding.** Add to MB §10 DoD: "hero, ≥1 rail, and ≥1 tile demonstrably belong to this week's theme; state the mapping" and (owner's call, this diagnosis recommends it) "during theme weeks the hero is a theme-category product or a product+theme combo". Add a theme-expression dimension to design-critic's rubric.
4. **Freshness floor + sameness diff.** Per-run: compare today's slate to yesterday's run summary; a no-change day requires a stated reason (flip MB §10's default). Add an image floor for designated fresh slots (hero block art, wayfinder tiles, Discover You promo, couples band): generate when the hero or theme changed, reuse only as fallback after two failed vision-gate attempts. Budget already supports this ($600/day, 100 images; the team spent $0.43 in 11 days).
5. **New agent: `homepage-art-director`** (the one genuine roster gap). Daily step between product picks and media: converts the week's theme into a per-day visual scheme (ground-tint rotation within the doctrine lock, per-slot image concept + archetype, prop/color rhyme) that media-manager prompts must start from. The current roster has a designer scoped to Routine B only and an orchestrator explicitly defined as anti-novelty; nobody owns "what does today look like".
6. **Playbook corrections:** `playTogetherBanner` IS renderable (remove the false prohibition); add wayfinder + couples band + rail `ctaLink` sync to the mandatory per-run checklist; correct the 60 s propagation claim and codify the post-publish warm (#104).
7. **Collection merchandising mandate:** wayfinder tiles may target collections today; nothing curates theme collections. Fold "create/refresh a theme collection, point 1-2 wayfinder tiles at it" into the daily loop (shopify-ops or the art-director brief).
8. **Notebook conversion module and FAQ rotation** need shell PRs first (see §1 items 10-11), then become daily content levers (product link per notebook tile; product-led questions from the sex-wellness reviewer's domain, rotated via a new additive Sanity block).

---

## 7. SEO: why 48 pages, and the daily diagnosis

Prod ground truth (queried 2026-07-27):

- `gsc_index_daily` 2026-07-28 row: sitemap 4,608 URLs, inspected 4,608, **indexed 48**, crawled-not-indexed 252, discovered-not-crawled 1,329, other-not-indexed 2,979, newly_indexed 0, newly_dropped 0. Per-URL breakdown: URL unknown to Google 1,386; Discovered-not-indexed 1,329; **Excluded by noindex tag 1,230**; Duplicate without user-selected canonical 335; Crawled-not-indexed 252; indexed 48; 404 24; soft-404 11; 5xx 6.
- `gsc_snapshots` 6/26-7/24: **48 impressions, 5 clicks, avg position 24.9** for the entire site.
- Sitemap: healthy, segmented (18 static + 205 collections + 24 notebook + 4,401 products). Canonicals, JSON-LD (6 blocks on PDP), meta descriptions, 410s for archived deals, AVIF: all correct.

Ranked causes:

1. **The May outage's cached verdicts (1,230 noindex + 335 duplicate-canonical).** Between ~5/09 and 5/25 transient render errors emitted `noindex` + homepage canonicals; Google cached the verdicts. Fixed 6/13 (#173); the sitemap now floors lastmod at the fix date, but **passive lastmod is not triggering recrawls** (newly_indexed 0/day). ~1,565 URLs are stuck until Google recrawls them.
2. **~2,715 URLs never crawled** (unknown + discovered-not-crawled): classic crawl-demand problem. The homepage links ~20 products of 4,401; PDPs are effectively orphaned beyond the sitemap; site has near-zero external authority (5 clicks/month).
3. **IndexNow dead, confirmed:** `SEARCH_PING_ENABLED` / `INDEXNOW_API_KEY` unset, live key file 404s. No push signal to any engine on rotation or fix events.
4. **252 crawled-and-rejected: content quality.** Enrichment coverage across the 4.4k catalog is unquantified; unenriched PDPs carry thin/near-duplicate Nalpac descriptions. (Quantify in the plan; the enrichment pipeline exists.)
5. Minor hygiene: 24 404s + 11 soft-404s still in inspection set (suppression is working but slow), 6 5xx.

Levers: sitemap ALIVE; GSC snapshot cron ALIVE (weekly, Mon 06:00 UTC); GSC index sweep ALIVE (3-hourly, ~1,900 inspections/day quota); IndexNow DEAD; internal linking WEAK; content depth PARTIAL; external authority ABSENT.

**Daily SEO diagnosis capability:** most of it already exists as data. `gsc_index_daily` is literally a daily diagnosis table (with newly_indexed / newly_dropped deltas) that nothing reads, reports, or alerts on. The missing pieces are: a daily routine/report surface (trend, deltas, top movers, error spikes, action suggestions filed to the improvement bus), IndexNow activation so fixes and rotations get pushed, a recrawl-acceleration push for the 1,565 stale-verdict URLs, an internal-linking program (homepage collection doors, PLP cross-links, notebook embeds) to de-orphan the catalog, and an enrichment-coverage counter to drive the thin-content queue. Design belongs to the plan.

---

## 8. Defects found in passing (file separately or fold into the plan)

- **Bestseller anchor displacement:** any published team rail deletes the "most picked" grid (`StorefrontHome.tsx:1053-1070`); guardrail exists only in the redesign brief.
- **Free-shipping contradiction:** $99 hardcoded twice vs "$59" advertised in `_layout.collections._index.tsx` meta. Live trust bug.
- **Latent billing-descriptor violation:** `Footer.tsx:73` fallback reads "Billing appears as XD Inc." (must always be XDIPX) if Sanity `siteSettings.discreetBody` is ever unset.
- **Off-charter couples copy:** "the couple that plays together, stays together" + 🖤 emoji (brand mark is ♥).
- **Discretion claims hand-written in three files** (trust strip, FAQ, footer) with no shared source.
- **Dead code:** `Couples()` accepts a `rail` prop never passed; "chosen for sharing" strip unreachable.
- **GA4:** `home_scroll_depth` parameter not registered as a custom dimension; three simultaneous rails inflate `view_item_list` and will corrupt per-rail CTR once traffic exists.
- **Nº numbering inconsistency:** section numerals render only on hardcoded fallback paths, not on CMS-driven components, so the page's numbering changes depending on what the team publishes.
- **Playbook staleness:** `playTogetherBanner` prohibition false; 60 s propagation claim false.

---

*Sources: five agent reports (section map, run forensics, instruction audit, CRO gap audit, SEO audit) 2026-07-27, prod Neon queries (gsc_index_daily, gsc_url_inspections, gsc_snapshots), live-site fetches (xdipx.com, sitemap, indexnow.txt). Owner complaints from the 2026-07-27 review message.*
