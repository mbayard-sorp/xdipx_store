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

The Meta Ads MCP connector is the interactive alternative. You authorize it in a chat session, it is not a server credential, and no routine carries its write tools (routine 28 and the weekly burn review carry only a pinned read-only set, for diagnosis). In that session an agent can run the same payload steps through `ads_creative_upload_media`, `ads_create_campaign`, `ads_create_ad_set`, `ads_create_creative` and `ads_create_ad`, each with status PAUSED, and only while the valve is on.

## 4. Banner zip for networks, sponsors and Snap

The zip holds `<lane>-<idea>-<format>.png` for each creative (`.jpg` when only a JPEG gets under the network's file-size cap), `copy.txt` (slogan, headlines, body and the tracked link for each banner), `README.txt` (the register tier and the imagery ceiling that applied) and `manifest.json`.

- Adult networks (ExoClick, JuicyAds): upload each image in the network dashboard and paste its link exactly as written in `copy.txt`. Copy runs at register 10 (codified 2026-10-03, live in code 2026-10-20). The ceiling is the nudity definition only. Every link lands on the product page itself, see section 4a. One pack is for one network: set `audience.network` to `juicyads` on the idea for a JuicyAds pack, otherwise it is built for ExoClick.
- Newsletter sponsor: email the PNGs and `copy.txt` to the sponsor. Ask them to use each link as written, and make sure the sponsor disclosure runs at send.
- Snap: there is no bulk importer in use. Make a Snap Ad per PNG in Ads Manager, paste the link, and leave it paused until you flip it.
- Owned channels: use the PNGs on site, in email or in opted-in SMS.

## 4a. ExoClick banner spec and the landing rule

Owner direction 2026-10-20: the ads team generates register-10 banners for ExoClick. Owner decision the same day: they land directly on the product page, no bridge.

### Sizes we render

The adult lane renders ExoClick's six static banner sizes. The list comes from the owner's ExoClick account (2026-10-20) and matches ExoClick's Ad Formats page.

| Size | ExoClick format | Slogan limit (chars) | Layout |
|---|---|---|---|
| 160x600 | Banner (wide skyscraper) | 48 | Plate on top, slogan column below, tick and wordmark |
| 300x250 | Banner, Mobile Banner | 42 | Plate on top, text panel below |
| 728x90 | Banner (leaderboard) | 44 | Strip: slogan left, plate right |
| 900x250 | Banner | 60 | Strip |
| 300x100 | Mobile Banner | 30 | Strip |
| 300x50 | Mobile Banner | 22 | Strip, one line of type at the 11px floor |

The 160x600 takes a tall plate (the `story` bucket), so an adult idea now generates one more plate than before. Every other size shares the wide plate.

### File rules

- File types: JPEG, PNG or GIF for banner and mobile banner images. MP4 for video banners (not built). Source: [Ad Formats](https://docs.exoclick.com/exoclick-docs/ad-formats.md), Banner and Mobile Banner sections.
- File size: the Ad Formats page says 300 KB per image. The [Media Library](https://docs.exoclick.com/advertisers/campaigns/media-library.md) page sets 150 KB for any image under 1,000,000 pixels (banner, native, push) and 300 KB above that (full-page interstitials). The two pages disagree, so we hold the stricter 150 KB (`EXOCLICK_MAX_IMAGE_BYTES` in `app/lib/ad-formats.ts`).
- How we enforce it: the compositor re-encodes any render over 150 KB as a palette PNG, stepping quality down. The banner zip checks each file again; if no palette PNG fits it falls back to JPEG with falling quality, and it refuses the creative if nothing fits. The pixel size never changes.
- ExoClick converts PNG to JPEG on upload when that is smaller, and makes MP4 copies of animated GIFs for some zones (Media Library page). We ship static images, so neither matters.
- Animated GIFs are allowed but get the "Animated Images" label, which publishers can block. Rapidly flashing banners are rejected. Sources: [campaign labels](https://docs.exoclick.com/advertisers/advertisers-faq/advertiser-compliance/my-campaign-has-labels-what-mean.md), [rejection reasons](https://docs.exoclick.com/advertisers/advertisers-faq/advertiser-compliance/my-campaign-got-rejected-why.md).
- A plain image with no text, button or logo gets the "Simple Images" label, which publishers can also block. Our banners always carry the slogan and the wordmark. The "High CTR Elements" label covers fake close or play buttons, fake chat boxes and "Watch Now" buttons: none of that, ever.
- One image per creative. ExoClick does not permit several images merged into one (Ad Formats page).

### Landing rule

- Every adult banner lands on the canonical product page, `https://xdipx.com/products/{slug}`, with `utm_source`, `utm_medium`, `utm_campaign` and `utm_content`. No bridge page, no collection, no homepage.
- The export resolves the landing itself (`adultLandingFor` in `app/lib/ad-export/common.ts`). It keeps the idea's destination when that is already an xdipx.com product page, otherwise it uses the idea's first product handle, and it drops any other query string. An adult idea with no product refuses to export.
- ExoClick's docs allow a product page as the landing page. The banner and the page must load for review, the product must not be on ExoClick's banned list, the URL must be https, and back-button redirects or entry and exit prompts on the page earn blocking labels. Our PDPs do none of that. Models who look young need a visible 18 U.S.C. 2257 disclaimer on the banner or the page; we cast adults only.

### Next formats (not built)

The owner's account also offers these. They need their own copy fields or layouts, so they are listed here rather than squeezed into the banner composer.

- Native (Recommendation Widget): image 16:9, 4:3 or 1:1, between 300x300 and 900x900, PNG or JPEG, 150 KB. Title up to 90 characters, description up to 90, brand up to 30. The image should be text-free with the words in the fields, so it needs a native exporter and `utm_medium=native` (already supported by `adultMediumFor`).
- Push notification: 720x480 (icon plus image) or 192x192 (icon), JPEG, PNG or GIF, title up to 50 characters, description up to 90. Same shape problem: the words go in fields, not pixels.
- Left out on purpose: video, vertical video, full-page interstitials, popunder, direct link and email clicks.

## 5. The UTM scheme

Every exported link carries all four. The values come from the lane and the idea.

| Parameter | Value |
|---|---|
| utm_source | facebook (meta), google, bing (microsoft), snapchat, newsletter, owned. Adult lane: the network, `exoclick` (default) or `juicyads` |
| utm_medium | paid, except sponsor for newsletter, owned for owned, and on the adult lane `display` for banners (`native` once native images ship) |
| utm_campaign | `ad<idea id>-<concept>` for example `ad103-sculpture-hall` |
| utm_content | the creative id for example `503`. A Search idea with no creative row yet uses `idea-<id>` |

Adult banners built before 2026-10-20 carried `utm_source=adnetwork&utm_medium=paid`. Those links still work and still attribute: order attribution counts `adnetwork` as a paid source and the ExoClick channel lists it as an alias. Nothing writes it any more.

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
