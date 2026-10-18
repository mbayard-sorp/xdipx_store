# Paid Meta lead funnel: go/no-go audit, 2026-10-18

Owner ask: audit the funnel end to end before any spend, measure every claim against the live
system, route every gap to an owner and file it. Everything below was measured on 2026-10-18
between 11:10 and 11:45 MST with the Meta Ads MCP (read-only), the Shopify Admin and Storefront
APIs, the Klaviyo API, the Vercel env listing, GA4, the production database, curl against the
live hosts, and one marked test lead in a browser. Meta was not written to. No email or SMS was
sent. No Shopify discount was changed. One stale owner blocker (399, the Instagram link, now done)
was cleared.

## The call: NO-GO today. GO once the five P0 items below are done.

Door A, the half of the funnel that captures the email, has never worked on production. The test
lead on curious.xdipx.com/hello fell into a "Page not found" page: the form's POST goes to
`/api/lead.data` and the bridge host gate only knew `/api/lead`. Behind that 404 sat two more
faults that would have failed every lead anyway (BotID would 403 the same `.data` path, and the
Klaviyo payload was rejected with a 400). All three are fixed in
[PR #1674](https://github.com/mbayard-sorp/xdipx_store/pull/1674), verified locally against the
live Klaviyo account and the live Conversions API token. Nothing else in the funnel can be judged
until that merges and a test lead passes on the real host.

What flips it to GO: PR #1674 deployed and QA's production test lead green (ticket #16142); the
HOLD campaign out of the Ads Manager draft (blocker 729); the first welcome email live on the
paid-leads list (ticket #16143 plus the go-live click); the two exclusion audiences on the ad set
(blocker 730); and the ad copy matching the code (blocker 735). Then publish the four-ad campaign
at the budget decided in blocker 732.

## What was measured and what is true

**Landing (M1).** `curious.xdipx.com/hello` returns 200 with no redirect for a phone UA, a desktop
UA, Facebook's crawler and bare curl, and all four get a byte-identical page (same MD5). Canonical
points at itself, `noindex` on the page and the header, the bridge root is a 404 and robots.txt is
served. The UTM set in the ad URL is captured to the `__xdipx_utm` cookie on the first hit and
reaches the lead record (seen on the Klaviyo profile as `utm_source=meta`, `utm_medium=paid_social`,
`utm_campaign=curious_lead`, `utm_content=<creative>`). The terms render twice, next to the form and
next to the revealed code: "15% off your order of $30 or more. One use per customer. Excludes
Lovense and Playground." The SMS checkbox is unchecked by default (checked `false` in the live
DOM), the SMS consent text carries frequency, rates, STOP/HELP and "not required to buy", and the
email consent line links the privacy policy. At 375px the page stacks cleanly: chips, Door A, Door
B, consent banner. The age gate shows first on a fresh device. Rate limit is 5 POSTs per IP per
hour through KV; a 429 maps to "Too many tries from here"; a Klaviyo failure maps to "Something
went wrong on our side"; a duplicate email is an upsert in Klaviyo, not an error; a returning
customer is not detected anywhere (see exclusions and the first-order claim).

**Door A path, as found.** POST `/api/lead.data` from the real page: 404 from the Express bridge
gate (`bridgeHostSupportPath` accepted `/api/lead` only). With the gate fixed, BotID's client only
attaches its challenge header to paths that match the protect list exactly, and the list had
`/api/lead` but not `/api/lead.data`, so `checkBotId()` on production would answer `isBot` and the
route would 403 every real visitor. With both fixed, Klaviyo answered 400: the subscription job
endpoint rejects `first_name` and `properties` on its profile objects, and `subscribeLead`,
`subscribeToList` and `subscribeToSms` all sent them, so every attributed subscribe in the estate
failed (the waitlist and review forms post through the same `.data` path and the same Klaviyo
shape, which fits the zero reviews and the empty waitlist list over the last 90 days). After the
fix, locally: profile `01M584J9KNMCEK27EM9Z9JYE5X` created with first name, `interest=wands`,
`lead_source=curious-hello`, `lead_offer_code=CURIOUS15` and the four `utm_*`; subscribed to list
`UHiJc9`; CAPI Lead accepted by Meta with event id `83f53a6c-eb18-47f6-8118-42dd314e7efc`, the
browser pixel queued `Lead` with the same `eventID`, GA4 got `generate_lead`, and the panel
revealed the code with the `/discount/CURIOUS15?redirect=/collections/wands?utm_...` link.

**Meta (read-only).** Both campaigns are staged in one Ads Manager draft, every object with status
ACTIVE in the draft, all 52 ads NEEDS_VALIDATION (that is Meta's pre-publish review; it does not
clear before publishing). The main ad set is OUTCOME_LEADS, CBO $10/day, lowest cost, optimizing
for pixel event LEAD, US, age 25 to 65, Advantage+ audience off, Facebook and Instagram, CTA
SIGN_UP, AI disclosure opted in, page 1181080778417899 and Instagram 17841439221839423 on every
creative. The four ad bodies run at register 3-4 (what it is, who it is for, the offer, the
exclusions named) with no act names and no pleasure claims; they do say "15% off your first
order", which the code does not enforce. Links resolve to `/hello?utm_...&utm_content=imgNN` for all
52 ads. Custom audiences: none exist. The pixel has received ViewContent, AddToCart,
InitiateCheckout, PageView and Purchase in the last 7 days and no Lead; the Lead sent during this
audit was accepted ("received and processed normally") but was not yet in the hourly stats at
11:40 MST. The Shopify-managed Advantage+ Sales campaign 120249603764920056 is PAUSED with $0.25
spent; Shopify's Growth automation created it and can re-enable it.

**Shopify.** CURIOUS15 (1382557155499): ACTIVE since 2026-10-18 16:07 UTC, 15%, once per customer,
all customers eligible, minimum subtotal $30, applies to collection 339706347691 "CURIOUS15
eligible" (vendor is not Lovense and not Playground), 5,878 products, combines with nothing, no end
date, 0 uses. `/discount/CURIOUS15?redirect=/collections/wands` answers 302 to the target and sets
the cart cookie; the Storefront API shows the new cart carrying `CURIOUS15` (applicable=false on an
empty cart, as expected; Shopify evaluates the $30 and the collection at checkout). Once per
customer is enforced by Shopify at checkout against the customer's email, so a guest with a second
email can reuse it; that is the platform's limit. MAP: the eligible collection includes MAP=MSRP
products from vendors other than the two excluded ones. The feed has 1,774 SKUs where MAP equals
MSRP; a random 25 of them in Shopify included Dame Com ($119, MAP $119), Dame Hug ($79, MAP $79),
LELO Surfer 2 ($118.99, MAP $119), Shinesty ($29.99, MAP $29.99) and Womanizer Next ($125.99, MAP
$139), all ACTIVE, none flagged `map_restricted`, all 15%-off-able. Lovense Calor (sku 80318,
$119 = MAP) is ACTIVE without the flag too, so the "48 flagged" set does not even cover its two
vendors. Other live codes: `buyonshop10` (10% all, no limit), `FIRSTLOOK10`, `OCTSURPRISE` (15%),
`DRESSUP25` (25%), and `HKK1P6EV0AEJ`: 75% off everything, no end date, no usage limit, used once.

**Klaviyo.** `KLAVIYO_LIST_ID_PAID_LEADS` is set in Vercel production and preview (the "unset"
claim is only true locally). List `UHiJc9` "Paid leads (curious.xdipx.com)": single opt-in, 0
profiles before this audit, no flow triggers on it, so a Door A lead receives nothing. Three flows
are live: Cart Abandonment, Post-Purchase, and "Welcome Series (Email)" (`XpAtS7`), created
2026-10-18 00:22 UTC on list `RLFrJY` "Email List" (46 profiles) from Klaviyo's stock K60 templates
("Welcome to the family!", "Let's stay connected", "Check out our best sellers"), sending from
hello@xdipx.com. That copy is not the charter's and never passed the voice gate.
`KLAVIYO_SMS_LIST_ID` is not set in production at all, so an SMS opt-in on /hello writes a
`consent_log` row and a phone on the profile and nothing else; the account's "Text Messaging List"
is double opt-in with 0 profiles. Blockers 561 (AUP) and 564 (sending domain) are still open and
gate the first real send. Placed Order is syncing (the metric exists and has events).

**Door B.** `/start` returns 200, `private, no-store`, sets `xdipx_interest` and the UTM cookie
from `?interest=` and `?utm_*`, and every one of the seven tiles links to a live collection
(first-time, suction-air-pulse, wands, couples-vibrators, anal, for-him, games-romance), each 200
with a full 24-product first page, with the UTMs carried on the href. The only capture on Door B is
the GA4 `select_promotion` event (`start_interest`) and the cookie; no email, no Lead. That is by
design, and it means Door B can only be measured as sessions and purchases in GA4.

**Measurement.** A Meta ad cannot be followed to an order today. GA4 attributes 36 of 42 purchases
in 90 days to "(not set)" because the purchase is sent server-side without a session join (ticket
#12670's gap); `order_attribution` has `utm_source` on 2 of 34 orders and `landing_site` on all
34; the pixel Purchase fires from the webhook with the stored `_fbp`/`_fbc` and will attribute in
Meta's own reporting for consented sessions. The join that does exist is Klaviyo: the lead profile
carries `utm_content` and `interest`, and Placed Order now syncs, so lead-to-order by creative is
reportable from Klaviyo. Nobody builds that report yet (ticket #16145).

**Economics (90 days, measured).** 40 orders, $1,638.61 revenue including shipping and tax,
COGS $895.44, profit $743.17, so a 45.4% gross margin and COGS at 66% of product sales. Product
AOV $30.65; $40.97 with shipping and tax; shipping charged $8.53 per order against about $5
freight. 14 of 34 orders were under the $30 minimum, so the code is irrelevant to 41% of the
baskets the store actually gets. A qualifying basket contributes about $9.33 at $30, $10.97 at
$40 and $12.61 at $50 after the discount, COGS, freight, and processing. Break-even cost per lead:
at 3% lead-to-order $0.29 to $0.45; at 5% $0.48 to $0.75; at 10% $0.97 to $1.49. Meta's learning
phase wants about 50 Leads a week; $10/day is $70/week and needs a $1.40 CPL to get there. A cold
account in this category should expect $3 to $8 per lead, so $10/day buys 9 to 23 leads a week and
never leaves learning, and 14 days at $10/day ($140) buys 18 to 47 leads and 1 or 2 orders. The
first order does not pay for the lead at any realistic CPL; the test buys the list and the CPL
number, and only a second order per lead (the welcome series' job) makes the channel pay.
Recommendation: $25/day for 14 days ($350), kill at CPL above $8 on day 7, and treat the first 14
days as a CPL read, not a ROAS read.

## Gaps, ranked

Each row: evidence, owner, fix, filing. Blockers are on the owner list (`/admin/blockers`);
tickets are on the improvement bus.

### P0: before any spend

| # | Gap | Evidence | Owner | Fix | Filed |
|---|---|---|---|---|---|
| P0-1 | Door A cannot capture a lead on production: gate 404s `/api/lead.data`, BotID would 403 it, Klaviyo rejects the payload | Test lead 11:19 MST fell to "Page not found"; curl confirms the gate; BotID client source matches paths exactly; Klaviyo 400 in server log | ads team, rr7-engineer; QA verifies on production | PR #1674 (gate `.data` twin, BotID `.data` twins for lead/waitlist/reviews, `upsertProfile` via profile-import) | Ticket #16142 (pr_open) |
| P0-2 | The HOLD campaign (48 failing ads) sits in the same Ads Manager draft as the main campaign, status ACTIVE; one Publish click takes both live | Meta draft read: 2 campaigns, 2 ad sets, 52 ads, all `status.new=ACTIVE` | Owner | Discard the HOLD campaign's staged changes (or set it Off in the draft) before publishing; confirm only 120249748010640056 remains staged | Blocker 729 |
| P0-3 | No welcome email: list UHiJc9 has no flow, so a lead gets the code on screen and nothing after | Klaviyo flows list; list has 0 profiles and no trigger | email team builds the draft; owner sets it live; 561/564 gate the first send | Email 1 immediately (code, terms, the picked shelf by `interest`), email 2 day 3, exit on Placed Order; Emma voice through the reviewer | Ticket #16143; blockers 561, 564 (existing) |
| P0-4 | No exclusions: existing customers and subscribers can take the 15% | `ads_get_ad_account_custom_audiences` is empty; code eligible to all customers | Owner (agents never write to Meta) | Customer list from Shopify export plus Klaviyo subscriber audiences, both excluded on the ad set; now a standing rule (M8) | Blocker 730 |
| P0-5 | Ads say "15% off your first order"; the code is once per customer for anyone; age cap 65 on the ad set | Four draft bodies; discount `allCustomers=true`; ad set `age_max=65` | Owner (money and brand) | Edit the four bodies to "your order of $30+" or restrict the code to zero-order customers; drop the age cap | Blocker 735 |

### P1: week one

| # | Gap | Evidence | Owner | Fix | Filed |
|---|---|---|---|---|---|
| P1-1 | Budget cannot learn: $10/day needs a $1.40 CPL for 50 Leads/week | Economics above | Owner (money) | $25/day for 14 days, kill at CPL > $8 on day 7, or label $10/day a smoke test | Blocker 732 |
| P1-2 | CURIOUS15 reaches MAP=MSRP products from Dame, LELO, Womanizer and others | 25-SKU sample; 1,774 MAP=MSRP SKUs in feed; only Lovense/Playground excluded | Owner ruling, then product team | Rule the honoured-MAP vendor list (also settles 279/429/431); extend the collection rule and the flag | Blocker 733; ticket #16147 |
| P1-3 | SMS consent is collected but never subscribed: `KLAVIYO_SMS_LIST_ID` unset in production | `vercel env ls production`; `subscribeToSms` returns early | Owner (credential) | Set the env to the double-opt-in list, redeploy, confirm quiet hours | Blocker 731 (probe `env_present`) |
| P1-4 | A stock Klaviyo welcome series is live on the Email List with "Welcome to the family!" copy | Flow `XpAtS7` definition and template names | Owner pauses; email team rewrites | Set the flow to draft now; three Emma templates to swap in | Blocker 736; ticket #16144 |
| P1-5 | No lead-to-order attribution: GA4 purchases unassigned, `utm_source` on 2 of 34 orders | GA4 90d; `order_attribution` | ads team (rr7-engineer) | Lead funnel report from Klaviyo (leads by `utm_content` and `interest`, Placed Order after `lead_captured_at`), Door B from GA4 `select_promotion` | Ticket #16145 |
| P1-6 | Shopify Growth can re-enable the raw-catalog Advantage+ campaign (fails M5) | Campaign PAUSED, $0.25; created by Growth; re-enabled once before | Owner | Disconnect Meta from Shopify Growth/Autopilot; delete or archive the campaign | Blocker 734 |
| P1-7 | Tickets filed to the ads team sit at `proposed`: `ads_team_auto_approve_suggestions` is false (since 2026-10-04) | `pipeline_settings` row | Owner (valve) | Flip the valve, or approve #16145 by hand; PR-linked #16142 is unaffected | Blocker 551 (existing) |

### P2: later

| # | Gap | Evidence | Owner | Fix | Filed |
|---|---|---|---|---|---|
| P2-1 | A 75% off code with no limit and no end date is live (`HKK1P6EV0AEJ`) | Shopify active codes read | Owner (money) | Deactivate or cap | Blocker 737 |
| P2-2 | The bridge host shows the storefront's daily-deal 404 on a route error (M1) | Seen during the failed test lead | ads team, rr7-engineer | Funnel-native error boundary on `bridge.$slug.tsx` | Ticket #16146 |
| P2-3 | `map_restricted` misses live Lovense products (Calor) and every vendor beyond two | Shopify sample | product team, shopify-ops | Sweep script, dry run then apply behind the MAP ruling | Ticket #16147 |
| P2-4 | `META_TEST_EVENT_CODE` holds a placeholder; a preview deploy's events land in the production dataset "processed normally" | Meta's warning on the local send | Owner (console) | Paste the live Test Events code from Events Manager into Vercel, or unset it | Needs Mike line below |
| P2-5 | Door B is untracked beyond GA4 `select_promotion` and a cookie | `/start` code | ads team | Covered by the attribution report (#16145); no email capture on Door B by design | (in #16145) |
| P2-6 | Once per customer is checkout-email based; a guest with a second email can reuse the code | Shopify platform behaviour | Nobody | Accept; the welcome series, not the code, is the retention lever | Noted |
| P2-7 | The Klaviyo account is shared with unrelated businesses (roof replacement, foundation repair lists) | Lists read | Owner (brand/legal) | Already known; keep the AUP confirmation (561) specific to this store | Blocker 561 (existing) |

## Needs Mike (one line each)

- Blocker 729: drop the HOLD campaign out of the Ads Manager draft (console).
- Blocker 730: build the two exclusion audiences and add them to the ad set (console).
- Blocker 735: "first order" copy or a first-order code, and remove the 65 age cap (brand, money).
- Blocker 732: $25/day for 14 days with a day-7 kill at CPL > $8, or $10/day as a smoke test (money).
- Blocker 733: the vendor list whose MAP the store honours at checkout (money, also settles 279/429/431).
- Blocker 731: set `KLAVIYO_SMS_LIST_ID` in Vercel production (credential).
- Blocker 736: pause the stock Welcome Series until the Emma templates land (brand).
- Blocker 734: disconnect Meta from Shopify Growth and delete the Advantage+ campaign (console).
- Blocker 737: deactivate or cap the 75% code (money).
- Blockers 561 and 564 (existing): Klaviyo AUP note and the branded sending domain, both before the first welcome send.
- Blocker 551 (existing): flip `ads_team_auto_approve_suggestions` on, or approve #16145 by hand (valve).
- Set a real `META_TEST_EVENT_CODE` in Vercel or unset it (console).
- Merge PR #1674 if the release engine has not by the time you read this; it touches no protected path, so the engine merges it once QA marks #16142 verified.

## What the test identity touched (for cleanup)

- Production, 11:19 MST, curious.xdipx.com/hello: no lead was captured (the 404). One
  `consent_log` row (id 464, `all`, policy 1.0) and the consent, UTM and `_fbp` cookies in the
  audit browser. The browser pixel sent only PageView.
- Local server against live services, 11:32 MST: Klaviyo profile `01M584J9KNMCEK27EM9Z9JYE5X`,
  email `funnel-audit-20261018@example.com`, first name `AUDIT-TEST`, properties `interest=wands`,
  `lead_source=curious-hello`, `lead_offer_code=CURIOUS15`, `lead_captured_at`, `utm_source=meta`,
  `utm_medium=paid_social`, `utm_campaign=curious_lead`, `utm_content=audit-local`; email consent
  SUBSCRIBED via API at 18:35:48 UTC; member of list `UHiJc9`. No phone, no SMS consent, no SMS
  list. Delete the profile in Klaviyo to clean up. A probe subscribe for
  `funnel-audit-20261018@xdipx.com` created no profile.
- Meta dataset 1619122322498289: one CAPI Lead, event id `83f53a6c-eb18-47f6-8118-42dd314e7efc`,
  `content_name=curious-hello`, `content_category=wands`, hashed email and first name, accepted
  into the production dataset (the local test-event code is a placeholder, so it was not diverted
  to Test Events). The browser pixel queued the matching Lead from `localhost`. It cannot be
  deleted; it is one event.
- GA4 property 532477050: one `generate_lead` (`lead_location=bridge`) and page views from hostname
  `localhost`. Two more `consent_log` rows (465, 466) from the local runs.
- Shopify: one empty cart (`hWNI7bJlXZgMvqVOog14efzu`) created by the `/discount` probe with
  CURIOUS15 attached; no order, no customer.
- Owner blocker 399 (Instagram link) cleared with a note; nine blockers filed (729 to 737); six
  tickets filed (#16142 to #16147).

## Standing direction codified

`docs/ads-policy.md` §Meta strategic lane now has M8 (exclusions always, offer claim matches the
code, no failing creative in a shared draft, a proven test lead before spend, budget sized to
learning, optimize only for a received event, 25+ with no cap), with a changelog entry, and the
daily ads routine's gate table and the ads-manager agent definition point at M1 to M8.

## Follow-through, all-hands session later the same day

Owner direction: "Use the /all-hands team to fill in as many gaps as possible and work with me to
complete any actions I need to complete." What moved:

| Gap | Done by agents | Still the owner's |
|---|---|---|
| P0-1 Door A fix | PR #1674 CI green, ticket #16142 QA-verified; the release engine merges it. Post-deploy production test lead still to run | Nothing, unless the engine stalls |
| P0-3 welcome email | PR #1679: flow `SCL5eV` created as a draft in Klaviyo (trigger Added to List `UHiJc9`, email 1 at once with the code and the picked shelf, email 2 day 3, zero-order filter), templates `V8QfHr` and `QUXs5Q`, all strings through the voice gate; tickets #16143 at pr_open | Blocker 741: set the flow live |
| P1-4 stock welcome series | Three Emma templates `UvPd6N`, `S6ngXG`, `XtDVv9` saved in Klaviyo; ticket #16144 at pr_open | Blocker 736 (pause) and 742 (swap) |
| P1-5 attribution report | PR #1677: `GET /api/team/lead-funnel-report`, card on the Ad Studio Spend tab, routine paragraph; ticket #16145 at pr_open | Nothing |
| P2-2 bridge error boundary | PR #1676; ticket #16146 at pr_open | Nothing |
| P2-3 and P1-2 MAP | PR #1678: sweep script plus two dry runs in `docs/audits/map-restricted-sweep-dry-run-2026-10-18.md`; ticket #16147 at pr_open. Lovense has 3 unflagged products (Calor, Kraken 6-pack, Gemini); Dame has 25 of 27 at MAP; LELO 4 above MAP and 27 below; Womanizer and We-Vibe all priced below their stored MAP; Satisfyer has no MAP data at all | Blocker 733: the vendor ruling. The data says Dame is the one exposure that matters |
| M8 standing direction | PR #1675, ticket #16148 QA-verified | Owner merge: `docs/ads-policy.md` is outside the agent allowlist |
