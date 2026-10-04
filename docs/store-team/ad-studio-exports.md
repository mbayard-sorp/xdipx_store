# Ad Studio exports: owner runbook

Ad Studio never uploads anything on its own. When you heart a creative, it can build an export: a Google or Microsoft Ads Editor file, a Meta paused draft, or a zip of banners. You download it or look at it, and you decide what happens next. The one exception is a single Meta button that stays hidden until you turn the spend valve on, and even that only ever creates a paused draft.

Where this lives: `app/lib/ad-export/`. Plan: `docs/store-team/ad-studio-v2-plan.md` sections 2, 3 and 5. Policy: `docs/ads-policy.md`.

## What builds what

| Lane | Exporter | What you get | Where you use it |
|---|---|---|---|
| google | google-editor-csv | UTF-16 file for Google Ads Editor | Google Ads Editor |
| microsoft | google-editor-csv (Microsoft layout) | UTF-8 bulk file | Microsoft Advertising Editor |
| meta | meta-paused-draft | Payload you can read, plus a push button when the valve is on | Ads Manager, after you flip it live |
| snap, adult, newsletter, owned | banner-zip | Zip of PNGs, copy, README, manifest | Network dashboard, sponsor email, Snap Ads Manager |

An export only builds for hearted creatives. A creative with a blocked gate, or one that breaks its lane's rules, refuses to build and says why. Nothing is padded past a limit and nothing is quietly dropped: if a headline is 31 characters, the build stops and names the headline.

On the Creatives tab each hearted creative shows an Export row: Build, then Download (files) or View payload (Meta). On the Ideas tab a hearted Google or Microsoft idea has an "Export Google Ads file" or "Export Microsoft Ads file" button, because Search ideas have no picture to rate.

## 1. Google Ads Editor, step by step

The file is Responsive Search Ads only. Google allows sexual merchandise on the Search Network and nowhere else, so there is no Display, YouTube or Performance Max output on purpose.

Before the first import, once:

1. Open Google Ads Editor, make or open any small campaign, and export it (Account, Export, Export whole account to CSV). Open that file and compare its header row with ours. If a header is spelled differently, tell the team before importing. Google adds and renames columns from time to time.

Each import:

1. On Creatives or Ideas, press Build, then Download. The file is `google-search-idea-<id>-<date>.csv`.
2. In Editor, choose Account, Import, From file, pick the CSV, and let it check the file.
3. Read the review screen. You should see one campaign, one ad group per idea, keywords with Exact or Phrase match, about 100 campaign-level negatives, and one responsive search ad per idea with 15 headlines and 4 descriptions.
4. Choose Keep changes. Every row arrives Paused.
5. Set the things the file cannot, from `docs/store-team/google-ads-launch-plan.md`:
   - Location options: Presence, not "Presence or interest". Exclude HI, AK and PR for the first test.
   - Networks: Google search only. Search partners and Display stay off. The file already says "Google search".
   - Bid adjustment on 18-24 of minus 50 percent for the higher-ticket ad groups. Do not exclude the Unknown age group.
   - Turn off the AI Max auto-upgrade if Google is offering it.
   - Auto-tagging stays on. The file also carries the four UTMs on the Final URL.
6. Choose Post. The campaign is still Paused. Enable it in the Google Ads web interface when you are ready.

What the file never contains: prices, discounts, "buy now", exclamation marks in headlines, arrows, hearts, smart quotes or dashes. The on-site CTA glyphs stay on the site.

### Why UTF-16 and tabs

Google's own help says Editor imports a CSV saved as Unicode, which on a Mac is "UTF-16 Unicode Text". That format is tab-delimited, and Google's own UTF-16 report downloads are tab-delimited too. So the Google file is UTF-16LE with a byte order mark, tabs between columns, English headers, and a `.csv` extension. Editor works out the delimiter itself.

## 2. Microsoft Advertising Editor

Prerequisite: the account has been accepted into the Adult Advertising Program (participation form). Without that, do not import. See `docs/ads-policy.md`, the Microsoft row.

1. Build and download the Microsoft file from the idea (`microsoft-search-idea-<id>-<date>.csv`). It is UTF-8 with a byte order mark and uses Microsoft's own bulk layout: a Type column, a Format Version row, and the headlines and descriptions as one JSON cell each.
2. In Microsoft Advertising Editor, choose Import, From file, and pick the CSV.
3. Review and keep changes. Everything arrives Paused.
4. Microsoft publishes its bulk columns at learn.microsoft.com under Advertising, Bulk service, Responsive search ad. As with Google, export one existing campaign first and compare headers if the import complains.

## 3. Meta paused draft

Meta's written policy bars ads that focus on sexual pleasure, so this lane runs under gates M1 to M7 in `docs/ads-policy.md`. The exporter enforces the ones a computer can check and refuses to build when one fails:

- Register 3-4 copy, no category words or pleasure claims in the headline, primary text or description.
- No on-skin creative. Object-first only.
- Destination is the bridge host (`curious.xdipx.com`) or a `/products/` page with the health block.
- One advertiser page, age 25 and up, United States, no special ad categories, no Advantage+ audience.
- Every object is PAUSED. The build also re-checks this and refuses a payload with an ACTIVE status anywhere in it.

What you can do with a built draft:

1. Press View payload. Read the preview at the top: campaign, ad set, budget, each ad with its headline, text and link. The warnings section lists anything to confirm. Right now it says the curated Meta product subset (M5) is not checked by the builder, because that list ships with the bridge-page work. Check by eye that the product is in the subset.
2. With the valve off, that is all. The payload stays stored. Nothing is sent.
3. With the valve on and the Meta credentials set (section 6), a "Create paused draft in Meta" button appears on a ready creative. It uploads the picture, then creates the campaign, ad set, creative and ad, all PAUSED, and shows the Meta ad id. Sizes of the same idea share one campaign and one ad set.
4. Open Ads Manager from the "Open in Ads Manager" link. Check the ad, the preview and the audience. Flip it live there yourself. Only you flip a Meta ad live. No agent and no automation does.
5. Account health (M7): one rejected ad stops new Meta proposals until you have read it and decided. A second rejection citing the same policy, or any account-level restriction, pauses the whole lane.

Daily budget on the ad set is the idea's break-even CPA (about $15 when the idea gives none), never below $1 and never above the daily media cap.

The Meta Ads MCP connector is the interactive alternative. You authorize it in a chat session, it is not a server credential, and the daily routine never carries it. In that session an agent can run the same payload steps through `ads_creative_upload_media`, `ads_create_campaign`, `ads_create_ad_set`, `ads_create_creative` and `ads_create_ad`, each with status PAUSED, and only while the valve is on.

## 4. Banner zip for networks, sponsors and Snap

The zip holds `<lane>-<idea>-<format>.png` for each creative, `copy.txt` (slogan, headlines, body and the tracked link for each banner), `README.txt` (the register tier and the imagery ceiling that applied) and `manifest.json`.

- Adult networks (ExoClick, JuicyAds): upload each PNG in the network dashboard and paste its link exactly as written in `copy.txt`. The ceiling is the nudity definition only. Copy is held at register 9 until you codify register 10.
- Newsletter sponsor: email the PNGs and `copy.txt` to the sponsor. Ask them to use each link as written, and make sure the sponsor disclosure runs at send.
- Snap: there is no bulk importer in use. Make a Snap Ad per PNG in Ads Manager, paste the link, and leave it paused until you flip it.
- Owned channels: use the PNGs on site, in email or in opted-in SMS.

## 5. The UTM scheme

Every exported link carries all four. The values come from the lane and the idea.

| Parameter | Value |
|---|---|
| utm_source | facebook (meta), google, bing (microsoft), snapchat, adnetwork, newsletter, owned |
| utm_medium | paid, except sponsor for newsletter and owned for owned |
| utm_campaign | `ad<idea id>-<concept>` for example `ad103-sculpture-hall` |
| utm_content | the creative id for example `503`. A Search idea with no creative row yet uses `idea-<id>` |

`utm_content` is what lets Shopify order attribution find the creative later. Medium stays `paid` on purpose, even though GA4's default grouping wants `cpc`. Map it with a GA4 custom channel group, as the Google launch plan says. Do not change the UTM.

## 6. The `ads_spend_enabled` valve (Phase 5)

What it gates: the "Create paused draft in Meta" button, and any Meta write through the MCP connector. Nothing else in Ad Studio depends on it. Building files, downloading them and reading payloads work with it off, and they stay off-platform either way.

Do not flip it until the simulation exit criteria in plan section 2 are met: you say so, ten straight days of successful routine runs, at least 30 hearted creatives across at least 3 lanes, and the bridge page live.

Before flipping it:

1. Set `META_ADS_ACCESS_TOKEN` (or `META_ACCESS_TOKEN`), `META_AD_ACCOUNT_ID` and `META_PAGE_ID` in Vercel. The page is the single xdipx advertiser page. Missing any of them makes the button answer `not_configured` and send nothing.
2. Confirm the daily media cap (`ads_media_daily_cap_cents`) and the monthly cap read the numbers you want.
3. Do the first push on one creative you have read the payload for.

Flipping it: the valve is never a toggle inside Ad Studio, so it cannot sit next to a rating button. Until the Phase 5 valve surface exists, flip it with the audited setter, which records who and why in `settings_audit_log`:

```ts
await setPipelineSettingAudited('ads_spend_enabled', 'true', 'owner', 'session:phase5-flip')
```

Flipping it back is the same call with `'false'`. With it off, the button disappears on the next page load, and a direct call to push answers `spend_disabled` before it reads anything.

What push refuses, by code:

| Code | Meaning |
|---|---|
| spend_disabled | The valve is off. Nothing was read or sent. |
| not_configured | A token, account or page id is missing. Nothing was sent. |
| not_exportable | There is no ready payload, or the payload is not a safe paused draft. |
| already_pushed | The creative is already in Meta. The ad id is on the card. |
| api_error | Meta refused a step. The ids created so far are kept, so a retry reuses them and does not duplicate. |

The team token can build exports and read their status through `POST /api/team/ad-export`. It cannot push. That op does not exist on the team route, and a request for it answers 403.
