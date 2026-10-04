# Ad platform research: tools, formats, policy, creative, measurement

Date: 2026-10-03. External web research only, no codebase changes. Input for the Ad Studio platform redesign.
Store context: xdipx.com, curated sex toy and sexual wellness store, Shopify headless, AOV roughly $26 to $40, test budget $20 to $50 per day.

How to read this: every factual claim carries an inline source. Where I could not reach a primary source (X ads policy pages returned HTTP 402, Reddit's policy site refused fetches, several network review sites returned 403), I say so and mark the claim **verify**. Numbers labelled "est." are my own derivations from cited inputs, not quoted figures.

---

## Executive summary

1. **No mainstream social platform will run a sex toy ad in the US in 2026.** Meta, TikTok, Pinterest and (per its paid policy) X prohibit sex toys outright. Meta and Snap allow adjacent products under health framing or 18+ gating: lube on Meta, a non-graphic vibrator ad on Snap. Google and Microsoft allow sex toys on **search only**, 18+, SafeSearch-gated. Sources in section C.
2. **Meta's 2025 health and wellness data restrictions matter more than its creative policy.** Since January 2025 Meta can block Purchase and Add to Cart events for health and wellness advertisers, sexual wellness included ([Polar Analytics](https://www.polaranalytics.com/post/2025-metas-tracking-restrictions-for-health-wellness-are-here----heres-how-to-fix-it), [Pixelflow docs](https://docs.pixelflow.so/troubleshooting/what-are-meta-s-health-and-wellness-restrictions-and-how-do-they-affect-tracking-ce3t3)). Before any spend, check the xdipx dataset's restriction tier in Events Manager. If Purchase is blocked, the Ad Studio's ROAS-based kill rules cannot use Meta's own numbers. They have to read Shopify orders tagged by UTM.
3. **The provocative register belongs on owned channels, adult networks, Snap (18+, non-graphic) and Google/Bing search copy (factual).** Paid Meta stays at education register 3-4, matching `docs/ads-policy.md`.
4. **At $20 to $50 a day with a ~$33 AOV, platform learning phases are out of reach.** Meta wants about 50 optimization events in 7 days. At a ~$15 break-even CPA that is about $750 a week. So the kill and scale engine has to run on xdipx's own math (spend vs break-even CPA, CTR floors, impression minimums), not on platform "learning" status.
5. **UX to copy:** a creative card grid with thumbnail-first scoring (Motion, Atria Radar), a brief-in, variants-out generator with a predicted score as a pre-filter (Pencil, AdCreative.ai), modular multivariate combination (Marpipe), and rule recipes with explicit lookback windows plus a "revive" rule (Madgicx, Birch/Revealbot). The "Patterns to copy" shortlist below has 14 patterns sized for a 375px phone.

---

## A. Interface patterns of leading ad tools

### A.1 Tool by tool

| Tool | Ideas: brief in, variants out | Review, rate, approve | Performance and kill/scale | Export / import |
|---|---|---|---|---|
| **Arcads** | Paste a script, pick one of 1,000+ AI actors and a voice, and a talking-head UGC video renders in about 2 to 5 minutes. Bulk mode crosses scripts with actors to build a test matrix ([Omniconvert comparison](https://www.omniconvert.com/nexus/compare/arcads-vs-tellos/), [Vantaige](https://vantaige.io/ai-tool/arcads)). | Library of renders; no built-in finishing editor, so clips go to an external tool ([Omniconvert](https://www.omniconvert.com/nexus/compare/arcads-vs-tellos/)). | None native. | MP4 download. |
| **AdCreative.ai** | Upload a brand kit (logo, colors, fonts), pick format and objective, get 20+ variants in under five minutes ([review roundup](https://bestaitools.it.com/product-review/adcreative-ai-review/)). | Every creative gets a predicted **Performance Score** (CTR) and **Awareness Score**, from a CNN trained on a large ad dataset, with saliency heatmaps ([AdCreative help](https://help.adcreative.ai/en/articles/8885776-what-is-creative-scoring-ai-and-how-to-use-it), [AdCreative academy](https://www.adcreative.ai/academy/how-to-evaluate-ad-performance-with-ai-creative-scoring)). | Light. | Download per size; push to ad accounts. |
| **Pencil (trypencil.com)** | Brief, then chat-based idea generation, then thousands of variants ([Pencil platform](https://trypencil.com/the-platform)). | 0-100 predictive **Media Performance Score** per variant as a pre-filter before spend; governed approval workflow with brand-safety guardrails and a full audit trail ([Superscale review](https://superscale.ai/alternatives/pencil/review)). | "Evaluate market signals" loop back into briefs. | Publishes to Meta, TikTok, YouTube, Google Display, DV360, LinkedIn ([Superscale](https://superscale.ai/alternatives/pencil/review)). |
| **Smartly.io** | Feed-connected dynamic templates: one template times a product feed (region, language, weather, audience signals) gives N creatives ([Smartly features](https://www.smartly.io/all-features)). | "Producer" workspace for real-time adapt, approve and launch, with role-based access ([Smartly](https://www.smartly.io/all-features)). | **Predictive Budget Allocation** shifts budget daily across ad sets and campaigns by observed performance ([Smartly docs](https://docs.smartly.io/docs/scale-across-channels-with-automation)). | Catalog and template driven; direct API launch. |
| **Motion (motionapp.com)** | Not a generator; an analysis layer. | Visual reports where the **thumbnail is the row**: Top Performing Ads, Comparative Analysis, weekly Leaderboard, Launch Analysis, Winning Combinations; filter by naming convention and tags ([Motion reporting](https://motionapp.com/solutions/creative-reporting-tool)). | Hook rate, CTR and conversions shown beside each creative ([Motion](https://www.motionapp.com/)). | Shareable report links. |
| **Foreplay** | Swipe file: one-click save from the Meta Ad Library, TikTok Top Ads and LinkedIn into Boards and Folders. **Briefs** turn saved inspiration into a creator brief with modular deliverables (aspect ratios, format, duration, platforms, products, music) ([Foreplay 2.0](https://www.foreplay.co/post/foreplay-2-0), [How to use Foreplay](https://www.foreplay.co/post/how-to-use-foreplay)). | Tags plus boards. "Spyder" tracks competitors; "Lens" does creative analytics ([1800DTC](https://1800dtc.com/tool/foreplay)). | Lens analytics. | Brief share links. |
| **Atria** | Library of 25M+ ads; AI scripts from brand briefs using AIDA and PAS frameworks. **Raya** (Feb 2026) is an AI strategist that generates concepts, writes briefs and batch-uploads dozens of ads ([Trendtrack review](https://www.trendtrack.io/blog-post/atria-review), [Atria](https://tryatria.com)). | **Radar** grades every live creative and labels it **scale / iterate / kill** from ROAS, CTR, hook rate and retention ([Atria blog](https://tryatria.com/blog/best-ai-ad-tools-for-creative-analysis)). | Grade-based. | Batch upload to Meta. |
| **Icon (icon.com)** | "AI Admaker": AdGPT scripts from product info and audience, AdCut AI video editor, and repurposing of existing footage into tagged clips that get reassembled into new ads ([Icon AdGPT](https://icon.com/products/adgpt), [The AI Report](https://www.theaireport.ai/tooldatabase/icon-ai)). | Creative Library with AI tagging. | Not documented publicly. | Video export. |
| **Omneky** | A brand LLM learns fonts, colors, tone and visual style, then generates on-brand assets ([Omneky](https://omneky.com/llm)). | **Approve & Launch** hub ([Omneky brands](https://www.omneky.com/brands)). | Omnichannel insights. | Launcher for Meta, Google, TikTok, LinkedIn, Reddit. |
| **Marpipe** | **Modular multivariate**: 5 headlines x 3 images x 2 background colors becomes 30 ads in one click ([MarTech Zone](https://martech.zone/marpipe-ad-creative-multivariate-testing-automation)). | Results roll up by element, so you learn which headline or image wins across combinations. | Statistical significance per element. | Feed and catalog output. |
| **Madgicx** | AI ad generation (secondary). | Creative insights. | **Automation tactics** (detail in A.2): Stop Loss, Revive, Surf, Sunsetting ([Madgicx Academy](https://academy.madgicx.com/lessons/madgicx-automation-tactics)). | Meta-native. |
| **Revealbot (now Birch, bir.ch)** | n/a | n/a | Rule builder with AND/OR and nested conditions, hourly time ranges, actions to pause, start, change budget or change bid, and Slack alerts ([Birch automated rules](https://bir.ch/facebook-automated-rules), [help](https://help.revealbot.com/en/articles/1526011-creating-automated-rules)). | Meta, Google, TikTok, Snap. |
| **Triple Whale** | n/a | **Creative Cockpit**: top ads, hooks and visuals, segmented by naming convention or manual grouping ([Triple Whale KB](https://kb.triplewhale.com/en/articles/6362638-introducing-creative-cockpit)). | Blended first-party attribution. | n/a |
| **Meta Advantage+ creative** | Give up to **5 primary texts and 5 headlines**; Meta flags text as "optimized" at 3 or more and assembles combinations per placement ([Jon Loomer](https://www.jonloomer.com/meta-ads-creative-optimization/)). Enhancements are individual toggles ([Madgicx blog](https://madgicx.com/blog/advantage-plus-creative)). | In-platform previews. | Platform-chosen. | n/a |
| **Google PMax asset groups** | Up to 15 headlines, 5 long headlines, 5 descriptions, 20 images, 5 videos per asset group; Google mixes them ([Google PMax best practices](https://support.google.com/google-ads/answer/14528220)). | Per-asset performance labels in Google Ads. | Platform-chosen. | Editor CSV or API (section B). |

### A.2 Kill and scale rule mechanics (Madgicx and Revealbot/Birch)

**Madgicx tactics** ([Madgicx Academy](https://academy.madgicx.com/lessons/madgicx-automation-tactics), [custom automation](https://academy.madgicx.com/lessons/how-madgicx-custom-automation-works)):

- **Stop Loss** (ad or ad set). Pause if spend > X with 0 purchases, OR spend > X with ROAS below threshold. Their worked example pauses at spend > $42.48 with no purchase, or ROAS < 2.92. Evaluates today's performance; resets at midnight.
- **Revive** (ad or ad set). Re-enable a paused asset when delayed attribution shows at least 1 purchase today and ROAS above threshold (example 2.26). Exists because attribution lags cause false kills.
- **Surf** (ad set or campaign). If an event occurs X or more times and spend is under Y, raise budget proportionally, capped by a Surf Limit. Daily reset.
- **Sunsetting** (ad set). Cut budget first, then pause if ROAS keeps falling over the 3-day and 7-day windows. Never resets.
- Guardrail pattern from their strategy lessons: give ad sets at least 120 hours (5 days) before judging, then pause below 0.5x the account's 7-day ROAS or below 0.4x its 3-day ROAS ([Madgicx strategies](https://academy.madgicx.com/lessons/how-to-use-madgicx-automation-strategies)).

**Revealbot/Birch reference setup for a $2M/month account** ([Birch blog](https://bir.ch/blog/our-automation-setup-to-manage-a-2m-month-spend-facebook-ad-account/)):

| Rule | Level | Condition | Lookback | Action | Cadence |
|---|---|---|---|---|---|
| Hard pause, creative test | Ad | ROAS < target OR spend > threshold | 3 and 7 days | Pause | Daily, midnight |
| Surfing | Ad set | Today's ROAS at least 20% above target | Today | Budget +40% | Before 7pm |
| Incremental scale | Ad set | 7-day ROAS at least 10% above target | 7 days | Budget +30% | Daily |
| Pump the brakes | Ad set | 3-day and 7-day ROAS both below target | 3 and 7 days | Budget -30% | Daily |
| Stop loss | Ad | Today's ROAS far below target | Today | Pause | Intraday |
| Same-day restart | Ad / ad set | Paused today, conversions improved | Today | Resume | Several times a day |
| Safety net | Ad / ad set | Paused in last 7 days, now profitable | 7+ days | Restart | Daily |
| CPM spike protector | Campaign | CPM and CPC double | Short | Pause plus Slack alert | Every 15 min |
| Bid up / bid down | Ad set | 7-day ROAS +20% / 3 and 7 day below target | 3 / 7 days | Cost cap +5% / -5% | Daily |

The structural lesson: **every kill rule has a paired revive or safety-net rule**, and rules read blended data (GA plus a tracker in a sheet), not raw platform numbers, because post-iOS 14 reporting is delayed and aggregated. Both points fit xdipx, where Meta purchase data may be restricted.

### A.3 Patterns worth copying for a phone-first owner (375px)

See the "Patterns to copy" shortlist after section E.

---

## B. Bulk import / export mechanics

### B.1 Meta

**Creative specs (current Meta Ads Guide).** Feed image: JPG or PNG, 4:5 recommended, 1440x1800 recommended resolution, minimum 600x750, 30MB max, 3% ratio tolerance. Primary text 50 to 150 characters recommended; headline 27 characters recommended ([Meta Ads Guide, Facebook Feed image](https://www.facebook.com/business/ads-guide/update/image/facebook-feed)). Note this differs from the brief's figures. The widely repeated "125 / 40 / 30" are older guide numbers, and dynamic-ad guidance quotes 125 / 32 / 18 ([War Room KB](https://services.warroominc.com/en/knowledgebase/meta-static-image-ads), [AdNabu](https://blog.adnabu.com/facebook-ads/facebook-ad-specs/)). These are recommendations, not hard caps; longer text truncates behind "See more". Practical standard for the generator: **1:1 1080x1080, 4:5 1080x1350 (or 1440x1800), 9:16 1080x1920; primary text at or under 125 so the hook survives truncation; headline at or under 27 to 40; description at or under 30; up to 5 primary texts and 5 headlines per ad** for Advantage+ text variations ([Jon Loomer](https://www.jonloomer.com/meta-ads-creative-optimization/)).

**Ads Manager bulk import (Excel/CSV).** Ads Manager > Import & Export accepts a spreadsheet (XLSX template; CSV and TSV also accepted) with one row per object. Columns include Campaign Name, Ad Set Name, Ad Name, Body (primary text), Title (headline), Link Description, Link, Call to Action (enum such as SHOP_NOW, LEARN_MORE), Image Hash (32-character hex from the account's image library) or an image file name, and URL Tags (for example `utm_source=facebook&utm_medium=paid_social`) ([AdsUploader bulk guide](https://adsuploader.com/blog/facebook-ads-bulk-uploads), [AdManage](https://admanage.ai/blog/how-to-create-multiple-ads-on-facebook)). File names must match exactly, including case and extension, or the import fails. The safest way to get the exact header set for the xdipx account is to **export one existing ad from Ads Manager and use that file as the template** (**verify** headers per account, since Meta adds columns over time).

**Marketing API.**
1. Upload the image: `POST /act_{ad_account_id}/adimages` with `bytes` (base64) and a filename with an extension. The response returns `hash`, `url`, `width`, `height` ([Meta Ad Image reference](https://developers.facebook.com/docs/marketing-api/reference/ad-image/)).
2. Create the creative: `POST /act_{id}/adcreatives` with `object_story_spec.link_data.image_hash`, `message` (primary text), `name` (headline), `description`, `link`, `call_to_action`. For multiple text variations use `asset_feed_spec` (bodies, titles, descriptions, images) with dynamic or Advantage+ creative ([Meta Marketing API docs](https://developers.facebook.com/docs/marketing-api/reference/ad-image/)).
3. Then campaign, ad set and ad. Create ads with `status=PAUSED` so nothing spends before the owner's explicit approve-and-push.

### B.2 Google Ads Editor CSV

**General rules** ([Google Ads Editor, import CSV](https://support.google.com/google-ads/editor/answer/56368?hl=en), [answer 30564](https://support.google.com/google-ads/editor/answer/30564)): CSV only (not XLS); save as Unicode (UTF-16 on Mac via "UTF-16 Unicode Text"); first row is the header; English headers are auto-recognized, with case and spaces ignored; one entity per row; multiple values separated by semicolons; `<Account-level>` in the Campaign column for account-level assets.

**Responsive display ad columns.** Long headline, Headline 1..5, Description 1..5, Business name, Final URL, Call to action text, Image ID / Square image ID / Logo ID / Landscape logo ID (or image file names), Accent color, Main color, Allow flexible color, Ad format preference, Promotion text, Price prefix ([column list surfaced from Google Ads Editor help](https://support.google.com/adwords/editor/answer/57747)). **Verify** exact spellings by exporting one RDA from Editor, the same template trick as Meta.

**Responsive display ad asset limits** ([Create a responsive display ad](https://support.google.com/google-ads/answer/7005917?hl=en), [Manage RDAs](https://support.google.com/google-ads/answer/9050310?hl=en)):

| Asset | Limit | Count |
|---|---|---|
| Short headline | 30 chars | 1 to 5 |
| Long headline | 90 chars | 1 |
| Description | 90 chars | 1 to 5 |
| Business name | 25 chars | 1 |
| Landscape image 1.91:1 | 1200x628 rec., min 600x314 | 1 to 15 (5 rec.) |
| Square image 1:1 | 1200x1200 rec. (600x600 shown in some help pages), min 300x300 | 1 to 15 (5 rec.) |
| Logo 1:1 | 1200x1200 rec., min 128x128 | 1 to 5 |
| Logo 4:1 | 1200x300 rec., min 512x128 | optional |
| File size | 5,120 KB max | |

**Performance Max asset group** ([PMax best practices](https://support.google.com/google-ads/answer/14528220), [PMax asset specs](https://support.google.com/google-ads/answer/10724492?hl=en)): headlines 30 chars, 3 to 15, with at least one at 15 chars or fewer; long headlines 90 chars, 1 to 5; descriptions 90 chars, 2 to 5, with one at 60 or fewer recommended; business name 25 chars; landscape 1.91:1 1200x628; square 1:1 1200x1200; portrait 4:5 960x1200 optional; logo 1:1 1200x1200; up to 20 images and 5 videos. Editor 2.0+ supports PMax campaigns, asset groups and listing groups via CSV ([Editor 2.0 release notes](https://support.google.com/google-ads/editor/answer/11354954?hl=en-GB)).

**Hard blocker for xdipx:** Google's sexual content policy allows sexual merchandise **only on the Search Network**. Display, YouTube, AdMob, Gmail and image ads are excluded ([Google Ads sexual content policy](https://support.google.com/adspolicy/answer/6023699?hl=en)). RDAs and PMax (which serves across Display and YouTube) are therefore not a usable path for sex toy creatives. Build the export, but use it for Responsive Search Ads (15 headlines x 30 chars, 4 descriptions x 90 chars), plus Shopping or free listings where Merchant Center allows (section C).

### B.3 Google Ads API asset upload

- Upload: `AssetService.MutateAssets` with an `Asset` of `type: IMAGE`, a unique `name`, and `image_asset.data` holding raw bytes. You get a resource name back. Uploaded assets **cannot be changed or removed programmatically**; you manage links instead ([Working with assets](https://developers.google.com/google-ads/api/docs/assets/working-with-assets)).
- Link: `AssetGroupAsset` with `field_type` set to HEADLINE, LONG_HEADLINE, DESCRIPTION, BUSINESS_NAME, MARKETING_IMAGE, SQUARE_MARKETING_IMAGE or LOGO.
- Constraint: in non-retail PMax, the `AssetGroup` and the `AssetGroupAsset` links that meet the minimums **must be created in the same bulk mutate request**. Partial failure is not supported for `AssetGroupOperation` ([PMax asset groups](https://developers.google.com/google-ads/api/performance-max/asset-groups)).
- RDAs use `ResponsiveDisplayAdInfo` with the same asset references ([API reference](https://developers.google.com/google-ads/api/reference/rpc/v22/ResponsiveDisplayAdInfo)).

---

## C. Adult and sexual wellness ad policy in 2026

### C.1 Major platforms

| Platform | Sex toys | Adjacent products | Notes |
|---|---|---|---|
| **Meta (FB/IG)** | **Prohibited.** Ads can't promote "sex toys", "erotic products" or genital enhancement ([Meta Health and Wellness policy](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness), [Adult Products](https://transparency.meta.com/policies/ad-standards/content-specific-restrictions/adult-products-or-services)). | Allowed at 18+ when the focus is health, not pleasure: condoms, contraception, menopause products, ED, pain relief during sex, sex education, **lube and pheromones**. Lingerie has no age gate if it passes the nudity policy. | Plus the 2025 data restrictions above, which can block Purchase optimization. Bellesa Boutique's organic IG account was reportedly suspended on 2026-03-28 for using the word "clitoris" ([UltraViolet petition](https://act.weareultraviolet.org/sign/bring_back_bellesa); **verify**). Enforcement skews against women's pleasure brands while ED ads run ([CIJ via FemTech Insider](https://femtechinsider.com/new-cij-report-reveals-major-tech-platforms-suppressing-womens-health-information/)). |
| **Google Search** | **Allowed, restricted.** "Sexual merchandise" (sex toys, enhancers, fetish lingerie) is moderately restricted. It serves by user age, local law and SafeSearch, **Search Network only**; Display, YouTube, Gmail, image ads and Dynamic Display are excluded ([Google sexual content policy](https://support.google.com/adspolicy/answer/6023699?hl=en)). | n/a | Campaigns typically show "Eligible (limited)". A practitioner case study ran Search only (brand, category, competitor terms), with Shopping and Display blocked, and reached about 4.4x ROAS on a $1,250 budget ([Marketing Link case](https://marketing.link/cases/how-to-set-up-google-ads-for-a-sex-shop-and-what-could-go-wrong/); non-US market). |
| **Google Shopping / free listings** | Restricted to users over 18 in countries where allowed. Germany allows it with no sexualized use by models ([Merchant Center adult-oriented content](https://support.google.com/merchants/answer/6150138)). | | US is not on the not-allowed list in that policy, so products must carry the `adult` attribute and will only show with SafeSearch off. **Verify** in the xdipx Merchant Center account. Practitioners report Shopping blocked in other markets. |
| **Microsoft Ads** | **Allowed via the Adult Advertising Program**, approved advertisers only, in US, CA, UK, AU, NZ, IE, FR, DE, TW. Approved adult keywords include "sex toys" and "rabbit vibrator"; realistic sex toys prohibited in creatives ([Microsoft adult content policies](https://advertise.bingads.microsoft.com/zh-tw/resources/policies/tw-en/adult-content-policies-en), [participation form](https://about.ads.microsoft.com/en/forms/policies/adult-advertising-program-participation-form)). | | Search. Apply through the form. |
| **Snapchat** | **Conditionally allowed.** Snap's own example of restricted (not prohibited) content: "vibrator ads that do not use graphic language or imagery", alluding to masturbation without graphic language. **Must be age-gated 18+** ([Snap Ad Policies](https://snap.com/ad-policies?lang=en-US)). | Health and education contexts are looser. | Prohibited: graphic genitalia, exposed nipples or bare buttocks, partially obscured nudity. **The most permissive mainstream social platform for xdipx.** |
| **TikTok** | **Prohibited**: "sex toys, and supplies such as fetish or sexual fantasy costumes", plus enhancement products ([TikTok adult content policy](https://ads.tiktok.com/help/article/tiktok-ads-policy-adult-content?lang=en)). | No allowlist given. | Organic only, at register 5 per the charter. |
| **X** | **Paid ads: prohibited.** X's ads policy prohibits promoting adult sexual content globally, with a country-specific "permitted with restrictions" list ([X ads policy page](https://business.x.com/en/help/ads-policies/ads-content-policies/adult-or-sexual-products-and-services); page returned HTTP 402 to my fetch, so **verify**). | Permitted: safer-sex education, STI awareness, modelled lingerie, erotic novels ([same page, via search snippet](https://business.x.com/en/help/ads-policies/ads-content-policies/adult-or-sexual-products-and-services)). | The **June 2024 change was organic only**: labeled consensual adult content may be posted, but not "prominently displayed" ([Washington Times](https://m.washingtontimes.com/news/2024/jun/4/x-adds-rules-regulating-adult-content/)). It did not open X Ads to sex toys. |
| **Reddit** | **Prohibited since 2019** ("adult-oriented products and services"); NSFW subreddits not targetable ([Free Speech Coalition / YNOT](https://www.freespeechcoalition.com/blog/blog/2019/04/19/reddit-bans-ads-for-adult-oriented-products-and-services-ynot)). Contraception and ED are permitted. | | Brands use Reddit **organically** for trust and search discovery, and say paid "bows down to the same guidelines" ([Storyboard18](https://www.storyboard18.com/how-it-works/viagra-ads-are-okay-but-vibrators-arent-meta-and-google-ad-policies-drive-sexual-wellness-brands-to-reddit-61944.htm)). I could not fetch the live policy, so **verify** whether lube is approvable. |
| **Pinterest** | **Prohibited**: sex toys, body-part-shaped products, sexual enhancement products ([Pinterest guidelines via ConductAtlas](https://conductatlas.com/platform/pinterest-ads/pinterest-advertising-guidelines/provision/CA-P-066064/prohibition-on-advertising-sex-toys-and-adult-products/)). | | |

### C.2 Adult-friendly and alternative networks

| Network | Accepts sex toy ecommerce | Min deposit | Pricing evidence | Fit for $20 to $50/day |
|---|---|---|---|---|
| **ExoClick** | Yes (adult-first; 12B+ daily impressions) | Not confirmed (**verify**) | Minimum bids, Tier 1: native/banner $0.01 CPM or $0.01 CPC; popunder $0.50 CPM; interstitial $0.50 CPM / $0.05 CPC ([Global Dating Insights](https://www.globaldatinginsights.com/knowledge-partners/exogroup/exoclick-introduces-new-minimum-bid-prices/)). Adult network CPMs generally $0.50 to $5 ([AffNinja via search](https://affninja.com/exoclick-review/)). SmartCPM pays 10% over the next bidder. | **Yes.** Best self-serve targeting (site, keyword, device, daypart, frequency cap). |
| **TrafficJunky** (Aylo: Pornhub, YouPorn, RedTube) | Yes | $100 ($25 via PayPal reported) | CPM about $0.50 to $4, bids from $1 ([AffMaven](https://affmaven.com/trafficjunky-review/)) | **Yes**, but the audience is porn-intent, male-skewed and low purchase intent for a $30 cart. Test banners on category pages only. |
| **JuicyAds** | Yes | $25 to $100 by format | US banner run-of-network CPM $0.50 to $3; direct site buys $2 to $8 CPM ([AffNinja JuicyAds](https://affninja.com/juicyads-review/), [AffTank](https://afftank.com/review/juicyads)) | **Yes.** Direct buys on niche toy-review and erotica sites are the most relevant inventory. |
| **Adsterra** | Adult traffic accepted | $100 | Popunder, social bar, push, native, banner ([BloggersPassion](https://bloggerspassion.com/make-money-with-cpm-ads/)) | Weak. Pop and push traffic rarely buys a $30 product. |
| **TrafficStars** | Yes | Not confirmed | Popunder from $0.10 CPM (tier 3) ([AffNinja via search](https://affninja.com/de/trafficstars-review/)) | Weak to medium. |
| **PropellerAds, Clickadu** | Mainstream plus adult pop/push | ~$100 | PropellerAds US CPM $1.50 to $4 ([BloggersPassion](https://bloggerspassion.com/make-money-with-cpm-ads/)) | **No** for this AOV: pop and push, poor intent, brand-safety cost. |
| **EroAdvertising** | Yes | Not found | No reliable 2026 data found | Unknown, **verify**. |
| **MGID** | **No.** Prohibits "adult products, sex toys" and sex shops ([MGID policy](https://help.mgid.com/which-content-is-restricted-or-prohibited-on-mgid)) | | | No. |
| **Taboola / Outbrain** | No (adult products excluded under their standard policies; **verify** current wording) | | | No. |
| **Podcast sponsorships** | Show by show. Sex-positive podcasts take toy sponsors routinely | Flat fee | Host-read $25 to $40 CPM; 30s $18 to $22, 60s $24 to $26 (Libsyn marketplace) ([Awisee](https://awisee.com/blog/podcast-sponsorship-ad-rates/), [Podder](https://podderapp.com/post/podcast-advertising-rates)) | One small show per month at $100 to $300 fits. Use a code plus UTM. |
| **Newsletter sponsorships** | Show by show | Flat fee | Consumer CPM $15 to $35; sub-5K lists $50 to $250 per placement ([beehiiv](https://www.beehiiv.com/blog/newsletter-sponsorship-cost), [Dupple](https://dupple.com/learn/newsletter-advertising-cost-2026)) | **Best fit.** High-trust, editorial, matches Emma's register. |
| **Affiliate / creator** | Yes. Industry norm 8% to 17.6% commission, 30-day cookie (Lovehoney US 12% new / 8.8% existing) ([FlexOffers Lovehoney US](https://www.flexoffers.com/affiliate-programs/lovehoney-us-affiliate-program/)) | None | Pay on sale only | **Best risk profile.** BuzzFeed's sex-positive commerce vertical made a co-branded Bellesa vibrator a top Q4 product ([AdExchanger](https://adexchanger.com/publishers/buzzfeed-and-bellesa-see-an-opportunity-after-big-platforms-ban-sex-toy-ads)). |

**Est. effective CPC on adult display.** Banner CTRs on adult networks are low. At $0.50 to $3 CPM and a 0.1% to 0.4% CTR, effective CPC lands around **$0.15 to $3** (est.). The binding problem is conversion rate, not price. A $33 AOV at ~45% gross margin gives a ~$15 break-even CPA (est.). At a $0.50 CPC that needs a 3.3% conversion rate, which adult pop and push traffic almost never delivers. Use site-targeted banner and native placements on toy-review, erotica and sex-ed sites, with frequency caps.

---

## D. Creative strategy in a regulated category

### D.1 Techniques that got ads approved

1. **Sell the adjacent, allowed product.** On Meta, lube, condoms and massage oil (health framing, 18+) are allowed, while vibrators are not ([Meta Health and Wellness](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness)). Durex's 2025 "Afterglow" framed lube as self-care ([Marketing Beat](https://www.marketing-beat.co.uk/2025/02/10/durex-mccann-valentines/)).
2. **Show the feeling, not the product.** Lovehoney's UK TV work cleared Clearcast with no product or packaging. A couple in a coffee shop carried "Feel the Lovehoney". Their marketing head: "Obviously we cannot show dildo on TV in the UK" ([The Drum 2025](https://www.thedrum.com/news/2025/07/02/obviously-we-can-t-show-dildo-tv-how-lovehoney-satisfied-itself-and-the-censors)). Scripts and storyboards went through regular check-ins with the regulator.
3. **Innuendo plus a reveal.** Lovehoney Australia: entwined lovers all day, then the buzz turns out to be an electric toothbrush ([The Stable](https://www.thestable.com.au/leith-lovehoney-replaces-explicit-with-innuendo-to-avoid-bans/)).
4. **Botanical or object metaphor.** Hims' cactus series ("Hard, made easy.") ran across MTA stations ([STAT](https://statnews.com/2025/10/06/telehealth-companies-shift-from-providing-patient-access-to-selling-drugs/), [Glossy](https://www.glossy.co/beauty/sexual-wellness-brands-take-on-social-media-ad-regulations)). The same phallic-imagery standard got Unbound rejected ([Vice](https://www.vice.com/en/article/mta-bans-sex-toys-ads-dame-unbound)), so metaphor works best for health-framed products. Treat it as a gamble for toys.
5. **Myth-busting education.** Lovehoney's eye-chart billboard, "No, masturbation does not affect eyesight." ([The Drum 2023](https://www.thedrum.com/news/2023/09/11/lovehoney-challenges-sex-ed-with-myth-busting-billboards)).
6. **Stat-led hooks.** Womanizer's #IMasturbate cited a 68% masturbation gap from a 7,000-person, 14-country survey ([Newswire](https://newswire.ca/news-releases/lily-allen-announces-collaboration-with-womanizer-822207920.html)).
7. **Abstract and geometric visual language.** Color-blocked "miniature landscapes" and GIFs built to get past lewd-imagery filters ([LS:N Global](https://lsnglobal.com/briefing/article/21516/sfw-series-addresses-sex-toys-stigma)); euphemism as the main verbal strategy in sex toy Instagram discourse ([University of Turku thesis](https://www.utupub.fi/handle/11111/25300)).
8. **Product on a neutral ground, no body.** Dame's subway set showed toys in blue, green, pink and burgundy against plain backgrounds. Outfront began the campaign, then the MTA reversed and Dame sued ([BuzzFeed News](https://www.buzzfeednews.com/article/nancyvu/dame-sex-toy-company-sue-nyc-mta)). That is fine for adult networks and Snap, still a hard no on Meta.
9. **Broadcast timing and medium.** Lovehoney's "Scream your own name" ran only 7pm to midnight and showed no product ([Decision Marketing](https://www.decisionmarketing.co.uk/?p=107444)).

### D.2 What got brands banned

- **Bondage cues in untargeted media.** Lovehoney's "Silence Is Golden" (ball gag) was banned by the UK ASA ([The Drum](https://www.thedrum.com/news/ad-the-day-lovehoney-s-masturbation-may-billboard-gives-finger-sex-censorship)).
- **Anatomical words in organic posts.** Bellesa's IG suspension, reported as triggered by "clitoris" ([UltraViolet](https://act.weareultraviolet.org/sign/bring_back_bellesa); **verify**).
- **Phallic shapes** on women-led brands (Unbound, MTA) ([Vice](https://www.vice.com/en/article/mta-bans-sex-toys-ads-dame-unbound)).
- **Women's health language.** Repeated Meta rejections even when the copy matched Meta's own allowed examples ([CIJ via FemTech Insider](https://femtechinsider.com/new-cij-report-reveals-major-tech-platforms-suppressing-womens-health-information/)). Half of the 60 startups surveyed had accounts suspended ([Marketing Brew](https://www.marketingbrew.com/stories/2022/01/11/facebook-s-ad-blocking-for-health-products-and-services-could-have-a-gender-bias-research-suggests)).
- **Sexual emoji paired with a solicitation.** Meta's 2019 rule on eggplant, peach and sweat-drops emoji ([CBS LA](https://www.cbsnews.com/losangeles/news/facebook-instagram-ban-sexual-use-of-eggplant-peach-sweat-drops-emojis)).

**Landing page requirements (practitioner consensus, not a published Meta rule; verify).** Meta and Google review the destination. A lube ad that lands on a PDP whose nav, rails and recommendations show vibrators invites rejection or account flags. Build a **clean, health-framed landing variant** (no toy imagery, no toy rails, an age statement, an education block) for every Meta-bound ad. Google Search can point at standard PDPs because the product itself is permitted there.

### D.3 Hooks and slogans brands actually ran (each under 15 words)

| # | Brand | Line | Status | Source |
|---|---|---|---|---|
| 1 | Dame | "Toys, for sex" | Planned subway; MTA refused | [BuzzFeed News](https://www.buzzfeednews.com/article/nancyvu/dame-sex-toy-company-sue-nyc-mta) |
| 2 | Dame | "thank you from the bottom of my vulva" | Review-as-headline; refused | [BuzzFeed News](https://www.buzzfeednews.com/article/nancyvu/dame-sex-toy-company-sue-nyc-mta) |
| 3 | Dame | "91% of men get where they're going while 60% of women… don't" | Stat hook; refused | [Fox News](https://www.foxnews.com/us/womens-sex-toy-company-sues-new-yorks-mta-for-refusing-to-run-its-ads-on-the-subway) |
| 4 | Lovehoney | "Feel the Lovehoney" | Cleared UK TV | [The Drum](https://www.thedrum.com/news/2025/07/02/obviously-we-can-t-show-dildo-tv-how-lovehoney-satisfied-itself-and-the-censors) |
| 5 | Lovehoney | "Scream your own name" | Ran, 7pm to midnight | [Decision Marketing](https://www.decisionmarketing.co.uk/?p=107444) |
| 6 | Lovehoney | "No, masturbation does not affect eyesight." | Ran (billboard) | [The Drum](https://www.thedrum.com/news/2023/09/11/lovehoney-challenges-sex-ed-with-myth-busting-billboards) |
| 7 | Lovehoney | "Silence Is Golden" | Banned by ASA | [The Drum](https://www.thedrum.com/news/ad-the-day-lovehoney-s-masturbation-may-billboard-gives-finger-sex-censorship) |
| 8 | Hims | "Hard, made easy." | Ran (MTA, SF) | [STAT](https://statnews.com/2025/10/06/telehealth-companies-shift-from-providing-patient-access-to-selling-drugs/) |
| 9 | Hims | "Unwrap each other this year." | Ran (holiday film) | [The Drum](https://www.thedrum.com/news/2021/12/02/ad-the-day-ryan-reynolds-s-maximum-effort-tackles-festive-erectile-dysfunction) |
| 10 | Hims | "Have Sexmas" | Ran (campaign title) | [The Drum](https://www.thedrum.com/creative-works/maximum-effort-productions-hims-have-sexmas) |
| 11 | Womanizer | "#IMasturbate" | Ran (PR, social) | [Newswire](https://newswire.ca/news-releases/lily-allen-announces-collaboration-with-womanizer-822207920.html) |
| 12 | Womanizer x Lily Allen | "Free yourself. Feel yourself. Love yourself." | Ran (campaign quote) | [Newswire](https://newswire.ca/news-releases/lily-allen-announces-collaboration-with-womanizer-822207920.html) |
| 13 | Lelo (France) | "Play with your sex, not with your ex" | Ran | [CB News](https://www.cbnews.fr/node/90454) |
| 14 | Durex | "Nothing Feels Better" | Ran on YouTube, Meta, Google Search, 2025 | [Agency Compile](https://agencycompile.com/agencies/level-agency/content/nothing-feels-better-durex) |
| 15 | Durex | "Afterglow" (lube as self-care) | Ran, Valentine's 2025 | [Marketing Beat](https://www.marketing-beat.co.uk/2025/02/10/durex-mccann-valentines/) |
| 16 | Durex | "Feel it, safe and sound" | Ran (student campaign) | [Ads of the World](https://www.adsoftheworld.com/campaigns/feel-it-safe-and-sound) |
| 17 | Durex | "Come Together" | Ran (SG/MY) | [Marketing-Interactive](https://www.marketing-interactive.com/durex-play-cards-digital-stickers-conversations-sex) |
| 18 | Durex Canada | "Unlocking New Pleasures" | Ran (lube) | [Strategy](https://strategyonline.ca/?p=288852) |
| 19 | Maude | "modern intimacy, all people welcome" | Brand line | [Who What Wear](https://www.whowhatwear.com/maude-sex-essentials) |
| 20 | Numan (UK ED) | "Fix Yours" | Ran | [Decision Marketing](https://www.decisionmarketing.co.uk/?p=101655) |

Patterns in the lines that ran: two- to four-word imperatives ("Feel the...", "Fix Yours"), a pun on a holiday or idiom ("Have Sexmas", "Hard, made easy."), myth-busting negations ("No, masturbation does not..."), and pleasure framed as safety or self-care (Durex). The lines that were refused or banned name the body ("vulva"), state outcomes between partners, or use bondage cues. For xdipx paid Meta, the register 3-4 template is a **health or self-care noun plus a sensory verb plus a whitelist CTA**, landing on a clean page. The provocative 9 register stays on owned channels, adult networks and Snap (non-graphic).

---

## E. Measurement

### E.1 Wiring for a small Shopify store

- **Meta Pixel + Conversions API.** Shopify's Facebook & Instagram app has Standard, Enhanced and **Maximum** data sharing. Maximum uses CAPI server-to-server for purchases, which survives ad blockers ([Shopify Help: Facebook data sharing](https://help.shopify.com/en/manual/promoting-marketing/analyze-marketing/meta-data-sharing)). **Headless caveat:** xdipx checkout runs on Shopify, so purchase events fire from Shopify's checkout; the app's storefront PageView/ViewContent events do not cover the React Router storefront. Those need the Pixel in `root.tsx` plus either a server-side CAPI call or the Shopify Customer Events (web pixel) API (**verify** against the current implementation).
- **The sexual wellness restriction.** Since January 2025 Meta can apply Core Setup (strips URL parameters and custom params, which can **remove UTMs**), Partial (blocks Purchase and ATC optimization) or Full restrictions to health and wellness datasets ([Polar Analytics](https://www.polaranalytics.com/post/2025-metas-tracking-restrictions-for-health-wellness-are-here----heres-how-to-fix-it), [Angler](https://getangler.ai/blog/what-metas-2025-data-restrictions-mean-for-health-and-wellness-brands)). The workaround vendors sell is neutral-named custom events sent server-side ([Aimerce](https://www.aimerce.ai/blogs/what-to-know-2025-meta-health-and-wellness-data-sharing-restrictions)). That sits near circumvention, so treat it as an owner policy call, not a default.
- **Google Ads.** Use the Google & YouTube app's conversion tracking plus **Enhanced Conversions** (Settings > Google Ads settings > Enhanced conversions > Turn on) ([Google Help 13494537](https://support.google.com/google-ads/answer/13494537)). Alternative: import GA4 purchase key events into Google Ads. Do not count both as primary conversions, or every sale double-counts.
- **UTM convention for the Ad Studio** (recommended):
  `utm_source={meta|google|bing|snap|exoclick|juicyads|trafficjunky|newsletter-<slug>|podcast-<slug>}` · `utm_medium={paid_social|cpc|display|native|sponsorship|affiliate}` · `utm_campaign=<ad_studio_campaign_id>` · `utm_content=<creative_id>` · `utm_term=<keyword or audience>`. Meta macros: `utm_campaign={{campaign.id}}&utm_content={{ad.id}}`. Persist the creative id on the Shopify order (cart attribute or note attribute), so attribution survives Meta stripping URL parameters, and so kill rules can read **Shopify orders by creative id**, the one source no platform can restrict.

### E.2 Kill and scale templates for small budgets

The inputs and their sources:

- Kill at **spend of 2x to 3x target CPA with zero conversions**. This is a common practitioner rule: hold at 2x with one conversion, kill at 3x with none ([AdManage](https://admanage.ai/blog/when-to-kill-a-facebook-ad), [Flighted](https://www.flighted.co/blog/how-to-know-when-to-pause-a-meta-ad)). Madgicx's Stop Loss is the same shape ([Madgicx](https://academy.madgicx.com/lessons/madgicx-automation-tactics)).
- Raise budget **at most about 20% per change** to avoid resetting learning. Meta's learning phase needs about **50 optimization events in 7 days** after the last significant edit ([Meta Help: learning phase](https://www.facebook.com/business/help/112167992830700); 20% figure is practitioner convention, [Benly](https://benly.ai/learn/meta-ads/learning-phase-optimization)).
- Use **3- to 7-day lookbacks**, not one day ([Cropink on Meta rules](https://cropink.com/meta-automated-rules)). Pair every kill with a **revive** rule for delayed attribution (Madgicx Revive, Birch Safety Net).
- CTR context: WordStream 2025 retail benchmarks are 1.59% CTR, $0.70 CPC, 3.26% CVR ([WordStream](https://www.wordstream.com/blog/facebook-ads-benchmarks-2025)). Ecommerce median CPM is about $14.19 (Triple Whale, via [WordStream](https://www.wordstream.com/blog/facebook-ads-benchmarks-2025)). A 0.5% CTR floor sits about a third of the retail average, so it works as a "clearly broken creative" threshold, not a tuning target.

**xdipx defaults (est., derived from the above; store as editable valves):**

Let AOV = trailing 30-day Shopify AOV (about $33), GM = gross margin (about 45%), so **break-even CPA (BE) = AOV x GM, about $15**, and break-even ROAS = 1/GM, about 2.2x. Shipping inflates platform ROAS (see the Shop Campaigns note in memory), so compute ROAS from net revenue.

| Rule | Level | Condition | Lookback | Action |
|---|---|---|---|---|
| R1 Hard kill | Ad | spend at least 2 x BE (~$30) AND Shopify purchases attributed = 0 | lifetime, minimum 48h live | Pause |
| R2 Broken creative | Ad | impressions at least 2,000 AND link CTR < 0.5% | lifetime | Pause |
| R3 Unprofitable | Ad | spend at least 3 x BE AND ROAS < 0.8 x break-even ROAS | 7 days | Pause |
| R4 Revive | Ad | paused by R1 or R3 in last 7d AND a late-attributed purchase now gives ROAS at or above break-even | 7 days | Re-enable once; never twice |
| R5 Scale | Ad set | ROAS at least 1.3 x break-even (~2.9x) AND at least 3 purchases | 7 days | Budget +20%, at most once per 72h, cap at the daily valve |
| R6 Brake | Ad set | ROAS < break-even in both the 3d and 7d windows | 3 and 7 days | Budget -30% |
| R7 Spend guard | Account | today's spend > daily cap OR CPM > 2x its 7-day median | today | Pause all plus owner alert |
| R8 Fatigue | Ad | frequency > 3 AND CTR down at least 30% vs its first 3 days | 7 days | Flag "refresh" (no pause) |

The brief's "kill if spend > 2x AOV" (about $52 to $80) is **looser than break-even**. At a $33 AOV it allows roughly $66 of spend with no sale, about 4x break-even CPA. Use 2x BE as the default and keep 2x AOV as an option for a "patient" mode. At $20/day, R1 fires around day 2 for a dud. That is the right speed for this budget.

---

## Patterns to copy (shortlist for a 375px owner)

1. **Thumbnail-first card feed** (Motion, Triple Whale). On a phone each creative is one full-width card: image on top, then hook, headline and CTA, then one line of metrics (spend · CTR · purchases · ROAS). No tables in the review flow.
2. **Predicted score badge as a pre-filter, not a verdict** (AdCreative.ai, Pencil). Show the agent's 0-100 score on the card, sort the queue by it, and let the owner override. Keep the score visible later, so the agent's calibration can be checked against real CTR.
3. **One-thumb rating** (swipe or 1-5 stars, with ✓ / ✗ big buttons). Approve, reject or "more like this". Rejection asks for a one-tap reason chip (off-voice, policy risk, ugly, wrong product), and the reasons feed back into generation.
4. **Brief in, variants out, with the brief pinned** (Pencil, Atria Raya, Foreplay Briefs). Every variant card links back to its brief (angle, product, platform, register) so the owner judges against intent.
5. **Modular combination matrix** (Marpipe). Hooks x images x headlines as chips; the owner approves elements, not only finished ads, and the system composes. Report winners per element.
6. **Policy lane badge on every card.** "Meta-safe (register 3-4)", "Snap 18+", "Search text only", "Adult network". A creative gets these lanes from a policy check before the owner ever sees it, so nothing Meta-ineligible is offered a "Push to Meta" button.
7. **Scale / iterate / kill labels on live ads** (Atria Radar). Three states, with the rule that fired shown in plain words ("Paused: $31 spent, 0 orders, R1").
8. **Paired kill and revive rules shown as one recipe** (Madgicx, Birch). Rules display as sentences with editable numbers ("Pause when spend passes [2] x break-even with [0] orders after [48]h"), and the revive partner sits right under it.
9. **Explicit lookback chip on every metric.** "7d" or "Today" next to every number, so a scale decision is never made off a one-day spike.
10. **Approve != launch.** A separate "Push" step per destination: Meta via API in PAUSED state, then an "Activate" tap; Google and Bing get CSV export. This mirrors the owner-gated money valves.
11. **Weekly leaderboard + launch analysis** (Motion). The top 5 and bottom 5 creatives of the week as a swipeable strip, plus "how did this week's launches do at day 3".
12. **Daily budget burn bar.** A sticky top bar with spend today vs cap and orders today, the single most-checked number.
13. **Swipe file with source tags** (Foreplay). Competitor and inspiration ads saved with a brand and technique tag (innuendo, myth-bust, botanical metaphor) that agents can cite in briefs.
14. **Naming-convention-driven grouping** (Triple Whale, Motion). Creative ids encode angle_product_format_register, so any report can roll up by angle with no manual tagging.

---

## Where xdipx can legally run provocative ads

"Register ceiling" uses the Emma charter scale (`docs/emma-voice.md`, paid ads default 3-4 per `docs/ads-policy.md`). "Est. CPC" figures marked est. are my derivations; others are cited above.

| Platform | Sex toys allowed? | Register ceiling | Est. CPC | Notes |
|---|---|---|---|---|
| Meta (FB/IG) paid | **No.** Lube, condoms and health products only, 18+ | **3-4** (health and self-care framing) | ~$0.70 retail benchmark ([WordStream](https://www.wordstream.com/blog/facebook-ads-benchmarks-2025)); CPM ~$14 | Clean landing page required; check the data-restriction tier first |
| Google Search | **Yes**, restricted: 18+, SafeSearch, Search only | **4-5** (factual product copy; no explicit terms in ad text) | est. $0.80 to $3; all-industry search average $2.69 ([Semrush](https://www.semrush.com/blog/google-ads-cost)). Pull real numbers from Keyword Planner | Highest intent; RSA export is the main Google path |
| Google Shopping / free listings | Restricted, 18+, adult attribute (**verify** in US) | Product data only | est. $0.30 to $1.50 | Free listings cost nothing; check eligibility first |
| Google Display / PMax / YouTube | **No** | n/a | n/a | Policy excludes these networks |
| Microsoft Ads | **Yes**, via the Adult Advertising Program (US included) | **4-5**; no realistic toy imagery | est. $0.40 to $2 (typically below Google) | Apply with the participation form |
| Snapchat | **Conditionally.** Non-graphic vibrator ads OK, 18+ | **6-7** (allusion to masturbation OK; no graphic language or nudity) | est. $0.50 to $2 | Most permissive mainstream social platform; test lane |
| TikTok paid | No | n/a | n/a | Organic only (5) |
| X paid | No (adult sexual content prohibited in ads; **verify**) | n/a | n/a | 2024 change was organic only |
| Reddit paid | No (adult products banned since 2019) | n/a | n/a | Organic community presence only |
| Pinterest | No | n/a | n/a | |
| ExoClick | **Yes** | **8-9** (no nudity under xdipx's own definition) | est. $0.10 to $1.50 (CPM $0.50 to $5) | Best adult self-serve targeting; site-target, frequency cap |
| JuicyAds | **Yes** | **8-9** | est. $0.15 to $2 (CPM $0.50 to $8) | Direct buys on niche toy-review sites |
| TrafficJunky | **Yes** | **8-9** | est. $0.20 to $3 (CPM $0.50 to $4) | Porn-intent audience; low cart intent |
| Adsterra / PropellerAds / Clickadu / TrafficStars | Yes (pop, push, native) | 8-9 | est. under $0.50, low quality | Not recommended at this AOV |
| MGID / Taboola / Outbrain | No | n/a | n/a | |
| Newsletters (sex-ed, relationships, culture) | Yes, per publisher | **7-9** per publisher norms | Flat $50 to $300 (CPM $15 to $35) | Best register match for Emma |
| Podcasts (sex-positive shows) | Yes, per show | **7-9** host-read | CPM $18 to $40 | Promo code plus UTM |
| Affiliate / creators | Yes | Creator's own, within charter | 8% to 15% of sale | Zero-risk spend; Shopify Collabs or similar |

**Recommended first test at $20 to $50/day (est. allocation, owner decision):** $10 to $15/day Google Search (category plus long-tail product terms), $5 to $10/day Microsoft Adult Program once approved, $5 to $15/day Snap 18+ test with non-graphic toy creative, $5 to $10/day ExoClick or JuicyAds site-targeted banners at register 8-9. Meta only as a lube or health line with a clean landing page, after checking the dataset restriction tier. Add one newsletter sponsorship a month from the same budget. Kill rules R1 to R8 above, read from Shopify orders by creative id.

---

## Open items to verify (could not confirm from primary source)

- X Ads adult policy full text (HTTP 402 on fetch).
- Reddit live advertising policy text for lube and sexual wellness (fetch refused).
- Google Merchant Center US status for sex toys in Shopping ads vs free listings, and the `adult` attribute behavior.
- Exact Meta bulk-import and Google Ads Editor header spellings for this account (export one ad from each and use that as the template).
- xdipx's Meta dataset restriction tier (Events Manager, dataset > settings).
- ExoClick, TrafficStars and EroAdvertising current minimum deposits.
- Bellesa 2026-03-28 suspension details (secondary sources only).
