# Ad Studio v2: owner runbook

Written 2026-10-04 at the end of the build session. Everything below is open as a PR or already
done; nothing spends money until the owner flips one valve, and this file says which one.

## 1. What shipped, and where it is

| PR | Ticket | What | Stacks on |
|---|---|---|---|
| #1500 | 13377 | Phase 0 docs: audit, research, Meta teardown, concept bank, plan, wires, codified charter v5.8 and ads-policy Meta lane | main |
| #1501 | 13378 | PR-B: `routine-ads-daily.md` two-pass playbook, `ads-manager.md` rewrite, weekly routine retired | #1500 |
| #1502 | 13383 | PR-F: Klaviyo cart abandonment and post-purchase flows (drafts in Klaviyo), 5 templates, setup script | #1500 |
| #1503 | 13385 | PR-A: migration 114, `ad_ideas`, feedback tables, team endpoints, Ideas tab, rating control, admin shell sticky fix | #1500 |
| #1504 | 13386 | PR-D: `curious.xdipx.com` bridge route (host-gated), PDP health block, Meta product subset, two bridge drafts | #1500 |
| #1505 | 13391 | PR-G: CSV import (Google, Shop Campaigns), Shopify order attribution by `utm_content`, `ad_spend` rollup, Live tab | #1503 |
| #1506 | 13399 | PR-C: migration 115, render pipeline (plate plus layout-layer slogan), five gates, Creatives tab, Render now | #1503 |
| #1507 | 13404 | PR-H: migration 116, rules R1 to R8, Spend tab, owner valves, cart `_utm_content` stamping fix, digest section | #1505 |
| #1508 | 13405 | PR-E: export registry (Google and Microsoft Editor CSV, Meta paused draft, banner zip), push gated by the spend valve | #1506 |

Follow-up tickets already on the bus: 13384 (fire Viewed Product so the browse abandonment flow
can exist), 13406 (wire the Meta subset check M5 into exports once PR-D and PR-E are both on main),
13407 (routine liveness entries for the two daily passes).

Owner blockers already filed: #393 set the Klaviyo flows live, #394 add `curious.xdipx.com` as a
Vercel domain and CNAME.

## 2. Merge order

The release engine squash-merges each PR once QA marks its ticket verified. Because the branches
stack, let them land in this order and the diffs collapse cleanly: #1500, then #1503, then #1505 and
#1506 in either order, then #1507 and #1508, with #1501, #1502 and #1504 any time after #1500. If
GitHub shows a conflict on a later PR after an earlier one merges, R-SHEP rebases it; nothing in the
stack needs a hand merge.

## 3. Daily triggers (created 2026-10-04)

Both are RemoteTrigger cloud routines on the Max subscription, team `ads`, gated by
`ads_team_enabled` (on) and `ads_team_max_runs` (2), Sanity read-only as their only connector.

- Pass 1, ideas: `trig_01Y1sZNUGXwBGcEV4s1fTM4H`, cron `30 14 * * *` UTC, runs
  `docs/store-team/routine-ads-daily.md` Pass 1 as `ads-manager`.
- Pass 2, render and rules: `trig_01V5uuqg4V96CgK3UFUMfyTX`, cron `30 20 * * *` UTC, Pass 2, with
  the paid-media-buyer step once its addendum merges.

Until PR #1503 deploys the ideas endpoint, Pass 1 records `ideas_api_not_live` and finishes failed
on purpose, so the gap is visible in the run table rather than silent.

## 4. Simulation mode

`ads_spend_enabled` is off and stays off. In that state:

- Ideas and creatives generate daily. You rate them at `/admin/ad-studio/ideas` and
  `/admin/ad-studio/creatives` on your phone. Hearts render, thumbs-down teach.
- Exports build and store. Download the Google CSV, the banner zip, or view the Meta payload. No
  push button exists anywhere.
- The Live tab runs on `?source=sample` and on Shop Campaigns history you import on the Spend tab.
  Rules R1 to R8 fire as recommendations; Pause, Scale and Refresh write rule events and nothing
  else.
- The simulation badge in the burn bar shows the exit criteria: 10 straight routine days, 30 hearted
  creatives across 3 lanes, bridge page live, and your "go".

## 5. Exit simulation, lane by lane

Each step is yours. None is automatic.

1. DNS: done 2026-10-04. `curious.xdipx.com` CNAMEs to Vercel with a valid certificate. Until
   PR #1504 deploys, the host serves the main store at `/` and 404s on bridge slugs; after it
   deploys, `/` 404s on this host and published bridge slugs render. Then publish the two
   `adBridgePage` drafts and the `adLaneProductSubset.meta` draft in Sanity. The `plain-box` page
   still needs a photograph of a closed plain box; its fallback shows the product, which fails M2.
2. Google Ads Editor: export one existing campaign first and compare headers to our CSV, then import
   the paused campaign. Same for Microsoft Ads Editor after the Adult Advertising Program approval.
   Flip paused to enabled in the Editor yourself.
3. Meta: the connector was authorized 2026-10-04 and verified read-only. Ad account "XDIPX Digital"
   920738511029316 (business xdipx.com 966322319440094) is active with a payment method and zero
   campaigns. Pixel dataset 1619122322498289 "hello_xdipx_1" is active, fired from browser and server
   on 2026-10-03, data-use setting `advertising_and_analytics` (unrestricted, so purchase
   optimization is available). The Facebook Page is "xdipx.com", page id 1181080778417899, owned by the business
   with ad-creation permission (verified 2026-10-04; the ad account's promoted-pages list fills only
   after a first ad). Set `META_PAGE_ID=1181080778417899`. No Instagram account is linked to the ad
   account for advertising yet, so ads run under the Page identity until @hello_xdipx is connected
   to the Page in Business settings (blocker filed). Never use the recommended catalog 1551461513373481; it is the raw
   Shopify feed and fails gate M5. Set `META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID=920738511029316`
   and `META_PAGE_ID` in Vercel if you want the server-side push; otherwise an interactive session
   pushes the stored payloads through the connector. Every object is created PAUSED. You flip them
   live in Ads Manager, one ad at a time, 25+ targeting, bridge destination only.
4. Klaviyo: set the cart abandonment and post-purchase flows live (blocker #393). Browse abandonment
   appears after ticket 13384 ships the Viewed Product event.
5. Adult networks and sponsors: hand the banner zip and its `copy.txt` to ExoClick, JuicyAds, or the
   newsletter. UTMs are already in every link.
6. The valve: when you are ready for the first real dollar, flip `ads_spend_enabled` to true.
   There is no toggle in Ad Studio by design. Until a valve surface ships, run from a session:

   ```bash
   npx tsx -e "import('./app/lib/settings.server').then(m => m.setPipelineSettingAudited('ads_spend_enabled','true','owner','owner:go-live'))"
   ```

   With it on: the Meta push button appears for ready Meta creatives, R7 can pause everything on an
   over-cap day, and the daily media cap (`ads_media_daily_cap_cents`, default $20) and monthly cap
   (`ads_media_monthly_cap_cents`, default $600) on the Spend tab are what the rules enforce.

## 6. Daily rhythm once live

- 14:30 UTC the ideas pass files 10 to 20 ideas and reads yesterday's ratings back.
- You rate on your phone whenever. Hearts queue renders.
- 20:30 UTC the render pass renders hearted ideas, imports attributed orders, rolls up `ad_spend`,
  runs R1 to R8, and writes recommendations.
- The owner digest carries one Ad Studio section: ideas and creatives awaiting rating, rules fired,
  R7 events, spend against cap.
- Kill rule defaults: pause at 2x break-even CPA with zero orders after 48 hours live, revive once
  on a late order, scale 20 percent at 1.3x break-even ROAS with 3 orders, brake 30 percent below
  break-even on both windows, hard stop on an over-cap day. All editable on the Spend tab.

## 7. What is still not true

- No real render has run against Atlas yet; every creative so far was produced on scratch databases
  with a stubbed provider. The first production render pass is the first real image spend, drawn
  from `ads_team_daily_cents` ($20).
- No order carries a `utm_content` yet. PR-H fixes the cookie gap; attribution starts counting from
  the first click after it deploys.
- The reviews table holds one test-looking row. No social-proof numbers appear in any ad until real
  reviews exist.
- Microsoft Adult Advertising Program and Snapchat accounts do not exist yet. Both are owner
  sign-ups.
