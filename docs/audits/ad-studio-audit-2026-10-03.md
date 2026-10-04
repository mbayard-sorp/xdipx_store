# Ad Studio and paid-ads stack audit, 2026-10-03

Scope: every piece of the paid-ads and ad-creative surface in this repo, checked against the owner's
stated expectation that `/admin/ad-studio` is where the agent team generates ad campaigns and
display ads daily, which he can rate, manage, kill by performance, and push or export to Meta and
Google. Method: read every file named below, read key names (never values) from `.env` and
`.env.local`, and queried production Neon read-only (`default_transaction_read_only=on`) on
2026-10-03.

## 1. Executive verdict

**Rebuild the workflow and UI on the existing chassis. Do not rip out the data model, the policy
guard, or the generation seam. Do gut the page.**

The owner is right: the Ad Studio does not do what he expects, and on the evidence it has never
done anything at all.

- **Zero creatives have ever been generated.** `ad_creatives` has 0 rows, `media_assets` has 0
  rows with purpose `ad_static` or `ad_video`, and `api_token_log` has 0 rows under feature
  `ads-creative`. The generator in `app/lib/ad-creative.server.ts` has never produced one image in
  production.
- **Nothing generates daily.** The only agent (`ads-manager`) is weekly, propose-only, capped at 3
  proposals a run, writes text proposals, and is forbidden to make images. It has produced real
  output twice in 13 runs (2026-07-14 and 2026-10-02); the other 11 were gate skips.
- **No rating, no metrics, no kill.** The schema has no rating column, no feedback table, and no
  performance column except `actual_spend_usd`, which nothing in the codebase ever writes.
  `daily_profit_summary.ad_spend` is $0.00 on every row, including the days since 2026-09-30 when
  the owner says he has been running Shop Campaigns.
- **Every push button is a dead end, and the page hides that.** All three connectors are inert
  stubs. The page's action returns JSON errors, but the component never reads `useActionData`, so
  a push or a failed generation shows the owner nothing at all.
- **The owner's actual ask collides with binding policy.** Register-9 provocative display ads on
  Meta and Google are prohibited three ways at once: Meta bans the category in ads outright, Google
  bans the category on the Display Network outright (Search only), and the voice charter caps paid
  creative at intensity 3-4 with no on-skin imagery. No amount of building changes those three
  facts. The policy-compliant home for register-9 display creative is vetted adult ad networks
  (which `docs/ads-policy.md` already permits), plus owned surfaces.

What is worth keeping: the `ad_campaigns` and `ad_creatives` tables (extend them additively), the
`policyCheck` discipline and the structural Meta/TikTok block in `app/lib/ad-publish/types.ts`, the
unified image seam `app/lib/generate-image.server.ts` that `ad-creative.server.ts` already calls,
the owner-digest section that surfaces approved-but-unlaunched campaigns, and the `ads-manager`
agent's Google Search playbook. What should go: the current page component, the three push stubs as
user-facing buttons (keep the interface, stop rendering buttons that cannot work), and the dead
`attachVideoCreative` helper unless it gets a caller.

The rating system the owner likes in `/admin/socials` is a clean, reusable pattern (section 7). The
right rebuild is "Social library feedback, applied to ad creatives", plus a performance ledger fed
by CSV import, plus export files Google Ads Editor and Meta Ads Manager can ingest without API
tokens.

## 2. Inventory

Status key: **wired** = reachable and has run in production; **reachable, never used** = code path
is live but production data shows it has never executed; **stub** = returns a hard-coded refusal;
**dead** = no caller; **doc only** = described in a doc, not in code.

| Component | File | Status | Notes |
|---|---|---|---|
| Admin nav entry | `app/components/admin/AdminNav.tsx:192` | wired | "Ad Studio", reuses `SocialsIcon`. |
| Ad Studio page loader | `app/routes/admin.ad-studio.tsx:32-36` | wired | Lists the newest 20 campaigns. `.catch(() => [])` silently turns any DB error into an empty page. |
| Generate batch form | `app/routes/admin.ad-studio.tsx:158-196`, action `:51-58` | reachable, never used | Owner types a product handle or URL plus a hand-written policy note (min 20 chars, required every time). Produces 3 statics (1:1, 4:5, 9:16). 0 creatives exist in prod. |
| Creative approve/reject | `admin.ad-studio.tsx:60-68`, UI `:258-271` | reachable, never used | Binary. No reasons, no notes, no undo after the first decision (buttons only render while `draft`). |
| Hook copy edit | `admin.ad-studio.tsx:70-75`, UI `:247-257` | reachable, never used | Free text saved to `hook_copy`. Never rendered onto the image. |
| Campaign approve/reject | `admin.ad-studio.tsx:77-85`, `app/lib/team.server.ts:3033-3038` | wired | Used 2026-07-17 and later. Only `proposed -> approved/rejected`; no path to `launched`, `paused`, `ended`. |
| Push buttons (google/meta/tiktok) | `admin.ad-studio.tsx:87-127`, `:294-315` | stub | Visible only on approved campaigns. Every click ends in `not_configured` or `policy_blocked`, and the page never displays the result (no `useActionData`; imports at `:14` are `Form, useLoaderData, useNavigation` only). |
| Campaign card content | `admin.ad-studio.tsx:199-230` | wired | Shows name, platform, objective, status, first 220 chars of policy. **Does not show** `planned_daily_cents`, `audience_json`, or `creative_json`, which is where the agent puts headlines, keywords, negatives, landing URLs (600-1,400 chars per row in prod). The owner approves proposals without seeing their content. |
| Batch generator | `app/lib/ad-creative.server.ts:72-148` | reachable, never used | Calls `generateImage` (Atlas seedream-4.5-edit primary, fal fallback) with the product's first Shopify image as reference. Prompt `:42-49` is a fixed paid-register scaffold, three fixed angles `:51-55`. Sequential, synchronous, inside a route action (`vercel.json` maxDuration 300). |
| Video-to-ad attach | `ad-creative.server.ts:151-167` (`attachVideoCreative`) | dead | Zero callers. The Video Studio header (`app/routes/admin.video-studio.render.tsx:11`) and the Arcads doc both claim videos fan out to `ad_creatives`; no code does it. |
| Push interface + policy guard | `app/lib/ad-publish/types.ts:15-38` | wired (as a guard) | `citesHealthCarveOut` regex makes a Meta/TikTok push structurally impossible unless the policy note cites the health carve-out. Worth keeping. |
| Google push | `app/lib/ad-publish/google.server.ts:15-26` | stub | Returns `not_configured` even when all three env vars exist ("not yet implemented", `:24`). Needs `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`: all missing locally. The launch plan (§6) deliberately keeps it inert. |
| Meta push | `app/lib/ad-publish/meta.server.ts:17-33` | stub | Policy-blocks unless carve-out cited, then returns `not_configured`. Needs `META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`: both missing. |
| TikTok push | `app/lib/ad-publish/tiktok.server.ts:14-35` | stub | Always `policy_blocked`, by design. Needs `TIKTOK_ADS_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`: both missing and irrelevant. |
| Pusher registry | `app/lib/ad-publish/registry.server.ts` | wired | Maps the three stubs. |
| Team proposal API | `app/routes/api.team.ad-campaign.tsx` | wired | `propose` and `list` only. Platform whitelist `:19` is `meta, x, google, reddit, other`: allows `x` (policy-banned for paid) and lacks a reject/withdraw op, so the agent cannot clean its own junk (run 1200 left rows #4-#9). |
| `createAdCampaign` / `listAdCampaigns` / `decideAdCampaign` | `app/lib/team.server.ts:3006-3038` | wired | Plain CRUD. |
| Owner digest section | `app/lib/owner-digest.server.ts:530-560`, `:870` | wired | Lists approved campaigns with no `external_campaign_id`, links to `/admin/ad-studio`. Closes the ADR-012 blind spot. |
| `ad_spend` writer | `app/lib/profit.server.ts:243` | doc only | Comment says `ad_spend` "is written by the ads flow". No code anywhere writes it. |
| `actual_spend_usd` / `external_campaign_id` writers | none | dead | Only the push success branch (`admin.ad-studio.tsx:115-117`) would set the external id, and no pusher can succeed. |
| Meta CAPI (server) | `app/lib/meta-capi.server.ts` | wired | ViewContent/AddToCart/Purchase via `fireCapiEvent`, called from `_layout.products.$slug.tsx`, `api.cart.tsx`, `purchase-capi.server.ts`. Needs `META_PIXEL_ID`, `META_CAPI_TOKEN` (both set locally), optional `META_TEST_EVENT_CODE` (set). This is measurement, not ad delivery. |
| Meta Pixel (client) | `app/lib/meta-pixel.client.ts` | wired | Browser ViewContent/AddToCart with shared event ids for dedupe; boot in `app/root.tsx:198-222`. |
| GMC field helpers | `app/lib/gmc-metafields.server.ts` | wired | Pure helpers used by `app/routes/[feed.xml].tsx`. Category 5391 mapping, custom labels, MAP-aware discount flag. Feeds Merchant Center, which is not yet submitted. |
| Reddit Ads OAuth | `app/lib/reddit-oauth.server.ts`, `api.reddit-connect.tsx`, `api.reddit-callback.tsx` | reachable, unclear use | Read scope `adsread` by default. Reddit paid is "effectively prohibited" per policy, so this is reporting at most. |
| `ads-manager` agent | `.claude/agents/ads-manager.md` | wired | Weekly, propose-only, max 3 proposals, opus. Tool list names `ads_catalog_get_catalogs` and `ads_catalog_get_details`, which the live Meta Ads MCP no longer exposes (current name is `ads_catalog_list_catalogs`); ticket #13116 (approved, not applied) fixes it. |
| Ads routine playbook | `docs/store-team/routine-ads-weekly.md` | wired | Step 4 still says budgets "within `ads_team_daily_cents`", contradicting the agent def; #13116 fixes it. |
| Cloud trigger | `trig_013PfuKac4rkjPTHuUwXWzRn`, `0 13 * * 2` (Tue 13:00 UTC), `docs/store-team/routine-schedule.md:77,169` | wired | Meta Ads MCP attached with `permitted_tools` pinned to the read set (memory, 2026-07-31). |
| Cron expectations | `app/lib/cron-expectations.ts` | not covered | No ads entry. Cloud routines are tracked by run rows, not this file. |
| Video pipeline | `app/lib/video-pipeline.server.ts`, `fal-video.server.ts`, `media-providers/*`, `/admin/video-studio/*` | wired, barely used | 5 `video_jobs` rows total (2 done, 3 failed), 0 variant sets, 0 posted video social rows. Not connected to ads. |

## 3. Data snapshot (production Neon, read-only, 2026-10-03)

### ad_campaigns (12 rows, 2026-07-14 to 2026-10-02)

| status | platform | count |
|---|---|---|
| approved | google | 4 |
| approved | other | 2 |
| rejected | google | 6 |

All 12 rows: `actual_spend_usd = 0.00`, `external_campaign_id` empty. None was ever launched or
recorded as launched.

Last 10 (newest first; ids 1 and 3 are older and also approved):

| id | platform | name | objective | status | $/day | created | policy_check (first chars) |
|---|---|---|---|---|---|---|---|
| 11 | google | gads-search-category-learning-wand-couples-2026w40 | learning-category-search | approved | 7.00 | 10-02 | Google Ads, same moderately-restricted sexual-merchandise category, Search Network only. Explicitly a learning expense, |
| 5 | google | test-json-2026w40 | test | rejected | 12.00 | 10-02 | Google Search only, moderately-restricted sexual merchandise category, education creative, lands on collection not /. |
| 4 | google | test-min-2026w40 | test | rejected | 0 | 10-02 | (same as #5) |
| 12 | google | gads-search-halloween-costumes-masks-2026w40 | seasonal-halloween-search | approved | 6.00 | 10-02 | Google Ads, Search Network only. This is the LEAST restricted slice of the catalog: Halloween masks and costumes are mai |
| 10 | google | gads-search-magic-wand-brand-2026w40 | sales-brand-model-search | approved | 12.00 | 10-02 | Google Ads, 'sexual content - moderately restricted sexual merchandise' category (ads-policy.md Platform matrix + Google |
| 9, 8, 7 | google | bisect | t | rejected | 0 | 10-02 | xxxxxxxx... (debug junk) |
| 6 | google | bisect | t | rejected | 0 | 10-02 | GGGGGGGG... (debug junk) |
| 2 | other | owned-newsletter-sponsorship-wellness-educator-2026w29 | awareness / education | approved | 0 | 07-14 | PLATFORM: owned/earned creator sponsorship, the no-gatekeeper lane... |

Older: #1 `gads-search-bodysafe-education-2026w29` (google, $3/day, approved 07-17) and #3
`adult-network-display-validation-test-2026w29` (other, $4/day, approved 07-17). **Six approved
proposals, the oldest 78 days old, none launched.** Rows #4-#9 are debugging debris from run 1200
(a varchar(40) `objective` overflow, per its own summary).

### ad_creatives

**0 rows. Ever.** No `media_assets` rows with purpose `ad_static`/`ad_video`. No `api_token_log`
rows under `ads-creative` (14 rows exist under `ads-planning`, the agent's own token spend).

### Suggestions bus (`homepage_team_suggestions`)

- `team='ads'`: applied 7, approved 2, dismissed 2. `target_team='ads'`: dismissed 3, applied 1.
- The 2 approved-not-applied rows are both agent-def edits to `ads-manager.md`: #12550 (Shop
  Campaigns retro duty, 2026-09-30) and #13116 (budget wording, tool-name fix, pixel-gate scope,
  "bodyscape is paid-ineligible, images only via /admin/ad-studio", 2026-10-02).
- Recent applied rows are Shop image work (#12549, #12668, #12675, #12676, #12679), the CLAUDE.md
  payments correction (#12624), and the Reddit Ads OAuth PR (#9972).

### Ads team runs (`homepage_team_runs`, team `ads`)

13 runs: 11 `skipped`, 2 `succeeded` (run 31 on 2026-07-14, run 1200 on 2026-10-02). Last 8:
1200 succeeded (10-02, owner-directed in session, 3 Google proposals), 1139/1011/884/757/622/499/376
all skipped (09-29 back to 08-18: team disabled plus the 2026-08-15 paid hold).

### Valves (`pipeline_settings` where key ilike '%ads%')

| key | value | updated |
|---|---|---|
| ads_team_enabled | true | 2026-10-02 |
| ads_team_auto_approve_suggestions | true | 2026-10-02 |

No `ads_team_daily_cents` or `ads_team_max_runs` row, so defaults apply from
`app/lib/team-keys.ts:140`: **$5.00/day compute, 1 run/day.** That is the agent's Claude spend
ceiling, not media budget.

### Money context

`daily_profit_summary` all-time: **9 orders, $431.20 revenue, $188.80 profit, AOV $47.91, ad_spend
$0.00.** The launch plan's unhold criterion is "AOV at or above $45 over at least 10 real orders"
plus a trustworthy measurement chain. The AOV half is close on paper (n=9, and the plan notes some
early orders were the owner's own tests, so the real-customer count is lower). Shop Campaigns spend
since 2026-09-30 appears nowhere in the database.

### Social feedback (for comparison, section 7)

`social_asset_feedback`: 121 verdicts (76 up, 45 down), latest 2026-10-03. Top reasons:
on-message 58, more-like-this 55, product-faithful 50, skin-treatment 47, composition 44. The owner
uses this daily. The Ad Studio has no equivalent.

## 4. What the owner can actually do at /admin/ad-studio today

1. Type a product handle or paste a PDP URL, pick Google / Adult network / Meta, hand-write a
   20+ character policy note, and click "Generate 3 formats (~$0.08)". If it works he gets three
   near-identical product-on-paper stills (no people, no hands, no text). If it fails he sees
   nothing, because errors are returned as JSON the page never renders. It has never worked in
   production by the data.
2. Approve or reject a proposed campaign (name, platform, objective, a 220-char policy excerpt).
   He cannot see the proposed budget, headlines, keywords, negatives, audience, or landing URL.
3. Approve or reject each creative once, and type a hook line that is stored but never composited
   onto the image.
4. On an approved campaign, click google / meta / tiktok. Each click silently fails.

He cannot: rate with reasons, filter, sort, search, see spend, see any metric, mark a campaign
launched, enter an external campaign id, pause or kill anything, delete junk rows, download or
export anything, see creatives grouped by product or angle, or see a campaign idea list. There is
no pagination past 20 campaigns.

## 5. Agent and routine: how often, what it produces

- **Cadence:** weekly, Tuesday 13:00 UTC (`trig_013PfuKac4rkjPTHuUwXWzRn`), gate-checked, 1 run/day
  cap, $5/day compute cap. Next scheduled firing: Tuesday 2026-10-06.
- **Output:** at most 3 `ad_campaigns` text proposals per run (platform, objective, budget, audience
  JSON, creative JSON with headlines/descriptions/negatives/landing URL, policy note), plus events.
  It never generates images (`ads-manager.md` workflow step 4: "assets get produced only after the
  owner approves the proposal"), and #13116 makes that explicit.
- **Retro:** Step 6 compares launched spend to revenue. It has never had data to read.
- **Policy posture:** binding reads of `docs/ads-policy.md`; never TikTok, never X paid; Google
  Search playbook with the AI Max and Display traps called out.
- **Contradiction:** `docs/store-team/google-ads-launch-plan.md` lines 3-15 still say HELD and tell
  `ads-manager` not to write Google proposals. Run 1200 wrote three anyway, treating the owner's
  in-session direction as a live override and asking for the doc to be updated. Until it is, the
  next scheduled run may skip again on the doc's instruction.

## 6. The Arcads build: built versus wired

`docs/store-team/video-arcads-assessment-and-plan.md` (2026-08-09) recommended not buying Arcads
and building five phases. Code evidence:

| Phase | Built? | Evidence | Wired into a workflow? |
|---|---|---|---|
| 1 Batch variation (`enqueue-set`, `variant_group_id`) | yes | migration 078, `enqueueVideoJobSet`, `app/lib/video-pipeline-set.test.ts` | 0 variant jobs in prod |
| 2 Word-timed captions, 1:1 and 4:5 masters, end card | yes | `elevenlabs.server.ts` with-timestamps, `video-pipeline.server.ts:2232` (`final_4x5`), `video-postpass.server.ts:293` (`video_endcard_enabled`) | not exercised at volume |
| 3 Tone control, lipsync tier | partly | lipsync tiers exist in the provider registry | n/a |
| 4 Owner compose form | yes | `admin.video-studio.render.tsx:152` (`intent === 'compose'`) | available |
| 5 Multi-scene jobs | yes | migration 083 | available |
| "Fan-out to `ad_creatives`" (claimed in §2 as already built) | **no** | `attachVideoCreative` has zero callers | **no** |

Production: 5 video jobs ever (2 done, 3 failed), zero posted. Providers: Atlas (primary stills and
italk video tier, `VIDEO_DEFAULT_MODEL_TIER_DEFAULT = 'italk-atlas'` in `team-keys.ts:236`), Wavespeed
video mirror (`app/lib/media-providers/wavespeed-video.server.ts`, needs `WAVESPEED_API_KEY`,
missing locally), fal fallback, RunPod (keys present). The pipeline is real and over-built relative
to its use, and it has no path into the ads lane.

## 7. The social rating model (reusable as-is)

- **Table:** `social_asset_feedback` (`db/schema.ts:433-445`, migration 104): `asset_id` (unique,
  one live verdict per asset), `verdict` `'up'|'down'`, `reasons jsonb string[]`, `note text`,
  `rated_by`, timestamps. Keys to `social_media_assets.id`, **not** `media_assets` (ad creatives
  live in `media_assets`, so they cannot be rated through this table today).
- **Vocabulary:** `app/lib/social-asset-feedback-reasons.ts`. Up chips: on-message, more-like-this,
  product-faithful, composition, skin-treatment, lighting, cast-on-model. Down chips: product-drift,
  pose-or-composition, crop-too-tight, crop-too-loose, skin-treatment-off, over-the-ceiling,
  too-tame, lighting-or-colour, cast-off-model, scene-or-location, ai-artifact, text-or-watermark,
  other. Each chip maps to one lever the team controls. Shared by UI, write path, and read API so
  they cannot drift.
- **Write path, owner only:** `app/components/admin/social/AssetFeedback.tsx` (heart and thumbs-down
  glyphs, fetcher post `intent=feedback`, popover of chips plus note, bottom sheet on phones) posts
  to `admin.socials.library.tsx` / `admin.socials.library.$assetId.tsx` behind `requireAdmin`,
  which call `setAssetFeedback` (upsert) / `clearAssetFeedback` in
  `app/lib/social-asset-feedback.server.ts`. There is deliberately no team-token write op, so the
  signal cannot train on itself.
- **Filter:** library grid `?feedback=loved|rejected|unrated`.
- **Read path, agents:** `POST /api/team/social-asset-feedback` (`app/routes/api.team.social-asset-feedback.tsx`)
  with `op:'list'` (rated assets joined to prompt, negative prompt, provider request id, cast,
  product, batch) or `op:'summary'` (counts by verdict and reason), both with `since`.
- **How agents apply it:** `docs/store-team/routine-social-daily.md` Step 7b. Every UP with
  `more-like-this` must be cited by asset id and provider request id as a positive precedent; every
  DOWN reason must be named as a negative on the specific lever it constrains (product-drift to
  reference discipline, crop reasons to `cropScale`, over-the-ceiling/too-tame to register, and so
  on); the run report states which rows were applied; a reason seen on 2+ assets is promoted to the
  standing notes ledger `docs/store-team/imagery-owner-notes.md`.

For ads, reuse the pattern, not the table: an `ad_creative_feedback` table (same shape, keyed to
`ad_creatives.id`) with an ads-specific chip set (for example: on-policy, scroll-stopping,
hook-lands, product-faithful versus off-policy, too-tame, weak-hook, product-drift,
text-legibility, wrong-format), or generalize to a polymorphic `asset_kind` column. Same owner-only
write rule, same team read endpoint shape.

## 8. Reusable primitives for an ads lane

| Primitive | File | Use for ads |
|---|---|---|
| Unified image generation (Atlas, fal, Imagen fallback, cost logging) | `app/lib/generate-image.server.ts:129` | Already used by `ad-creative.server.ts`. Keep. |
| Atlas client | `app/lib/atlas.server.ts` | Primary still provider; free-form sizes give exact 4:5. |
| Social image API (generate and cast composite, scene axes, rehost, bare-product reference) | `app/routes/api.team.social-image.tsx`, `app/lib/social-media.server.ts` | Team-token generation path an ads routine can call. The `generate` op with archetype B is the paid-safe one; `cast` with on-skin axes is paid-ineligible. |
| Asset library ingest and index | `app/lib/social-asset-library.server.ts` (`ingestSocialAsset`) | Model for an ad asset library with provenance. |
| Reuse-first query | `app/routes/api.team.social-asset-query.tsx` | Model for "find a rated-up creative before generating". |
| Vision gate (anatomy, hard checks) | `app/lib/social-vision-gate.server.ts:801-816`, `app/routes/api.team.vision-gate.tsx` | Run on every ad creative. |
| Product-fidelity gate | `app/lib/social-product-fidelity.server.ts:222` | Run on every ad creative; misrepresentation is an ad-review risk too. |
| Crop-to-zone | `app/lib/social-crop-to-zone.server.ts:319` | Format reframes. |
| Publish gate (deterministic: stock, legible text, repetition, reachability) | `app/lib/social-publish-gate.server.ts` | `isProductSellable`, `classifyLegibleText` port directly to an ad pre-flight. |
| Voice gate verdict contract | `app/lib/social-voice-gate.server.ts:58`, agent `emma-empathy-reviewer` | Gate every headline/description. |
| Voice charter loader (marketing addendum covers paid) | `app/lib/emma-voice.server.ts:56-64` | Inject the paid register into any copy prompt. |
| Humanizer | `.claude/skills/humanizer/SKILL.md` | Mandatory on all written output per CLAUDE.md. |
| Feedback model | section 7 above | Rating. |
| Owner digest section | `app/lib/owner-digest.server.ts:530-560` | Surface daily batches awaiting rating. |
| Shop packshot sweep | `scripts/sweep-packshot-primaries.ts` | Shop Campaigns creative is the catalog image; keep position 0 paid-clean. |
| Video variants and multi-format masters | `app/lib/video-pipeline.server.ts` | 9:16, 1:1, 4:5 video ads for adult networks, once wired. |

## 9. Policy constraints, per platform (from `docs/ads-policy.md`)

| Platform | Paid ads for the pleasure catalog | What is permitted | Source lines |
|---|---|---|---|
| Meta (FB/IG) ads | **Prohibited.** Adult sexual arousal products banned outright. | Narrow health/wellness carve-out: contraception, family planning, at most clinically framed lube-type SKUs, 18+ (treat 25+ as floor), never pleasure. Pixel/CAPI measurement is fine. | matrix row, §Creative |
| Meta Shops | Commerce policy prohibits adult products; product tagging permanently removed. | Approved items may appear in shops; no ad implication. | §Meta Shops |
| TikTok | **Prohibited, never propose.** | Nothing paid. | matrix |
| X ads | **Prohibited** despite permissive organic rules. | Organic only (social team). | matrix |
| Google Search | **Restricted, allowed.** The only mainstream paid lane. "Limited" serving is normal. | Standard Search text ads only, Search Network only, Presence geo, ~34 excluded/strongly restricted countries, no broad match, auto-assets off (AI Max trap). | matrix, §Google network eligibility |
| Google Display / GAM / PMax / Demand Gen / Discovery / YouTube / Smart | **Prohibited by network**, regardless of creative. | Nothing. | §Google network eligibility |
| Google Shopping (Merchant Center) | Restricted, separate review. | Phase two only; `adult` attribute required (feed emits it); feed shipping must match checkout (500 items declared free shipping vs $9.99 actual as of 2026-08-15). | §Merchant Center, launch plan §6 |
| Reddit ads | Effectively prohibited. | Organic community participation. | matrix |
| Adult ad networks | **Allowed**, it is their business. | Display/native on adult inventory; vet traffic quality and fraud; UTMs mandatory. | matrix |
| Shop app / Shop Campaigns | Shop review approved the whole catalog (owner report 2026-09-30). | **Owner-run only; agents never propose or widen it.** Third-party placements stay off. Creative is the catalog: position 0 image must be product-as-object, no body, no skin, no text; titles at paid register 3-4. Any Shop notice is an account-health event because it reaches Shopify Payments. | §Shop app and Shop Campaigns rules 1-7 |
| Etsy | Physical catalog blocked twice. | Digital-only design-original lane. | §Etsy |
| Organic social | Community standards, not ad standards. | IG at 9 by implication, graphic-detail fence, imagery per `instagram-campaigns.md` §3.2a (line 169) and §3.2c (line 485). | §Organic social |

**Creative rules for paid (all platforms), §Creative rules:** no nudity; for paid additionally no
visible nipple of any sex, no depiction or simulation of use on a body, **no on-skin frame per
§3.2c**; education/wellness framing; product-as-object; never porn-adjacent; 18+ targeting; landing
page must match and no policy note may claim an age gate (there is no site-wide one). The voice
charter (`docs/emma-voice.md:198,211`) sets paid ads at intensity 3-4, education and mechanism only,
and `docs/store-team/campaign-look.md:48` excludes paid from the bodyscape look.

**Collision with the owner's ask.** "Register-9 provocative display ads on Meta and Google":

- Meta: category banned in ads; register 9 makes it worse (pleasure framing is what the carve-out
  forbids). Ban risk is account-level and retroactive.
- Google: Display is prohibited for the category at the network level. "Display ads on Google" is
  not a creative-tuning problem; there is no compliant version. Google Search text ads are allowed,
  at register 3-4.
- Charter: paid is 3-4 and on-skin is paid-ineligible. Changing that is an owner codify decision on
  `docs/emma-voice.md` and `docs/ads-policy.md`, and even then it would not change Meta's or
  Google's rules.
- Where register-9 display creative can run compliantly today: **vetted adult ad networks** (policy
  permits; their own creative rules apply), owned surfaces (site, email, opted-in SMS), and organic
  Instagram at 9-by-implication under the social fence.
- Hidden stake: the store runs on Shopify Payments. A Meta or Google ban is an ad-account loss; a
  pattern that draws Shopify attention can take checkout down (§Shop rules, "Enforcement").

**Google Ads economics (launch plan and copy bank conclusions).** `google-ads-launch-plan.md` is
**HELD by owner direction 2026-08-15** ("fix the AOV and CVR first, hold the ads"). At a ~$33 basket
and 37.6% contribution margin, break-even ROAS is ~2.7x and break-even CPA ~$12.40, requiring ~12%
CVR at ~$1.05 CPC: "at the basket the catalog currently produces, Google Ads cannot break even on
first-order revenue" (lines 446-452). It becomes arguable above ~$50 and comfortable above ~$60.
Readable-test floor is ~$25/day for 4 weeks (~$700). Unhold criteria: AOV >= $45 over 10+ real
orders, plus measurement fixes (#3441, #3422, checkout web pixel). The memory note's "$26 AOV" was
the owner's own 75%-off test order and the plan itself retracts it (lines 415-423). The Google Ads
API connector is deliberately not built (§6: write-scope credential risk, slow developer-token
approval, output is only a paused draft). `google-ads-ad-copy.md` is "drafted and shelved": five
RSA themes at register 3-4, ready when the hold lifts. Current data (9 orders, AOV $47.91) suggests
the AOV gate deserves a fresh read, with owner test orders excluded.

## 10. Meta Ads MCP

- Connector uuid `92e627b9-b2d8-40da-9dcc-c5d8ea15dcf7`, `https://mcp.facebook.com/ads`, OAuth (no
  token in env). In this session it reports as needing authorization, so nothing was re-verified
  live today; the owner re-authorizes it in claude.ai connector settings.
- Verified 2026-07-31 (memory): ad account `920738511029316` "XDIPX Digital", business
  `966322319440094`, ACTIVE, USD, payment method on file, **0 campaigns, 0 catalogs**. A second bare
  account `64994145` is visible and should be ignored. The account id is written nowhere in the repo.
- The ads trigger pins `permitted_tools` to the read set. Seven other triggers carry the same
  connector with empty `permitted_tools`, which exposes `ads_create_campaign`, `ads_update_entity`,
  `ads_activate_entity`, `ads_boost_ig_post` to prompt discipline alone (memory, open risk).
- The MCP does expose write tools (`ads_create_campaign`, `ads_create_ad_set`, `ads_create_creative`,
  `ads_creative_upload_media`, `ads_create_ad`, `ads_activate_entity`). A Meta "push" therefore
  needs no `META_ADS_ACCESS_TOKEN` at all if done through the MCP from a human-attended session. That
  makes the technical barrier near zero and leaves the policy barrier fully in place.
- `ads-manager.md` names two tools that no longer exist (`ads_catalog_get_catalogs`,
  `ads_catalog_get_details`); the live name is `ads_catalog_list_catalogs`.

## 11. Gaps versus the owner's stated expectations

| Expectation | Today | Gap | What it would take |
|---|---|---|---|
| Agent team generates campaigns and display ads **daily** | Weekly text proposals, max 3, no images; owner-triggered 3-image batches that have never run | Total | A daily ads routine (new trigger, `ads_team_max_runs` >= 2) that picks products from the strategy brief and stock, generates a creative batch through `generate-image.server.ts`, runs vision + fidelity + voice gates, and writes `ad_creatives` rows; owner-digest line for "batch awaiting rating". Needs the team-token write path the page lacks today. |
| Owner can **rate** | Binary approve/reject, once | Total | Port section 7: `ad_creative_feedback` + chips + note + team read endpoint + routine Step 7b equivalent. |
| **Manage**: filter, sort, see content | 20 newest, no filters, proposal content hidden | Large | Rebuild page: tabs (Ideas, Creatives, Live, Killed), filters by product/platform/status/rating, show `creative_json` and budget, error display via `useActionData`/fetchers, junk-row delete, mark-launched with external id. |
| **Kill by conversion** | No metrics, no spend, nothing writes `actual_spend_usd` or `ad_spend` | Total | `ad_creative_daily_metrics` table (spend, impressions, clicks, conversions, revenue per creative per day), CSV import for Google Ads and Shop Campaigns (ADR-012's fallback, never built), Meta via MCP insights once anything runs, kill rule (for example spend > 2x break-even CPA with 0 conversions) surfaced as a one-click pause recommendation. Also backfill `daily_profit_summary.ad_spend`. |
| **Push to Meta** | Stub, policy-blocked | Policy, not code | Only the health carve-out SKUs qualify. Technically possible through the Meta Ads MCP (paused drafts only, human-attended) or a Marketing API token. Pleasure catalog stays blocked by `citesHealthCarveOut`. |
| **Import to Google** | Stub, deliberately unbuilt | Code, small | Skip the API. Export a Google Ads Editor CSV (campaign, ad group, keywords with match types, negatives, RSA headlines/descriptions, final URL with UTMs) from an approved proposal. Search text only; no image assets, since Display is prohibited. |
| **Spend management** | `planned_daily_cents` stored, invisible in UI; compute and media budgets conflated in the playbook | Large | Show planned vs actual per campaign, a monthly media cap the owner sets (new valve, owner-only), and the CSV-fed actuals. Fix the playbook wording (#13116). |
| **Campaign ideas** | Agent writes them weekly into a table the owner sees only by name | Medium | Render the idea body (headlines, keywords, audience, break-even math) as a readable card with approve / reject-with-reason / "make creatives for this". |
| **Register-9 display** | Charter says 3-4; policy bans Meta and Google Display | Policy | Run register-9 display on adult networks (a manual-export lane: sized PNGs plus copy plus UTM URLs), and keep Google Search at 3-4. Any change for Meta or Google is an owner codify plus an accepted ban risk. |

## 12. Risks

1. **Account and processor risk.** Building a one-click path that sends register-9 creative to Meta
   or Google Display invites an ad-account ban; Meta and Google both enforce retroactively. Because
   checkout runs on Shopify Payments, a pattern that pulls Shopify review is the costliest failure
   in the stack.
2. **Silent failure UX.** The current page swallows every action result. Any rebuild that keeps
   `Form` posts without `useActionData` repeats the "it doesn't do anything" experience.
3. **Unpinned write tools.** Seven cloud triggers carry the Meta Ads MCP with no tool pin. Nothing
   in code stops an agent from calling `ads_create_campaign` there (memory, 2026-07-31).
4. **Doc drift steering agents.** The launch plan still says HELD and tells `ads-manager` not to
   propose Google. The agent def names nonexistent tools. The playbook conflates budgets. #12550 and
   #13116 are approved but unapplied.
5. **Auto-approve on ads.** `ads_team_auto_approve_suggestions` is now true (flipped 2026-10-02),
   reversing ADR-012's explicit "leave it off" recommendation. Agent-filed instruction changes to the
   ads lane can now reach merged behavior with no owner triage.
6. **No measurement of paid at all.** `ad_spend` is $0 everywhere while Shop Campaigns runs. Any
   kill-by-performance feature built before spend ingestion would be judging on nothing.
7. **Synchronous generation in a route action.** Three sequential Atlas calls plus blob uploads
   inside one request; the daily routine should go through a team-token endpoint with batching and
   the existing cost logging, not this action.
8. **Shared budget.** Ad image spend logs under feature `ads-creative`, and the team gate sums
   `feature LIKE 'ads-%'` (`app/lib/team.server.ts:375-376`), so a daily image lane would draw on
   the same $5/day ceiling as the agent's own tokens. Size `ads_team_daily_cents` before turning a
   daily lane on.
9. **Small sample economics.** 9 orders is not a basis for scaling paid; the plan's own scale and
   kill criteria (§4: day-10 and day-28 checkpoints) should be the kill rules the rebuild encodes.
