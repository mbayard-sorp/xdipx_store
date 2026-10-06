# Ad creative concept bank (2026-10-03)

Status: concept bank for the paid-ads lane, written 2026-10-03 at owner direction. Nothing in it is
live, scheduled, or approved for spend. `docs/emma-voice.md`, `docs/ads-policy.md`,
`docs/design-doctrine.md` and `docs/store-team/instagram-campaigns.md` §3.2a/§3.2c are binding and
outrank this file. Where this file and one of them disagree, this file is the stale one.

Owner direction, as briefed: interesting and provocative images, messaging that is arousing, edgy,
register 9 and fun, slogans and catchy phrases on products, super close-up zooms that hide the toy,
bodyscapes too close for anatomy to read, new ways to market what we sell, and the ideas he has not
thought of yet.

## 0. Read this first: where the ladder actually stands

The brief asks for one concept rendered at the ceiling each destination allows. Before the concepts,
here is what each destination allows today, because three of the assumptions in the brief do not
survive `docs/ads-policy.md`.

| Tier | Destinations | Words | Pictures | Notes |
|---|---|---|---|---|
| **R3-4, mainstream paid** | Google Search text ads; Google Shopping (phase two); Shop Campaigns; Meta paid **only** for health-carve-out SKUs (lube, moisturizer, kegel trainers) | Education, mechanism, health. No pleasure claim, no act named | Google Search carries **no image at all**. Shopping and Shop Campaigns show Shopify media position 0: product as object on a clean or single-tint ground, no body, no skin, no text in pixels. Meta carve-out: product as object, a hand at most, no on-skin frame | The pleasure catalog never runs on Meta, TikTok or X paid. X paid is prohibited even though X organic is permissive |
| **R6-7, rented and adult-network** | X organic; vetted adult ad networks; newsletter and creator sponsorships | Evocative tease, acts implied, X may name more than Instagram | X: identical to Instagram's §3.2a fence until sensitive-media labeling ships (ticket #10277). Adult networks: §3.2a/§3.2c is our own ceiling there | **Owner decision needed:** the charter's paid row says 3-4 and the marketing addendum says the full register runs only on owned channels. This bank proposes 6-7 for adult networks. It is a proposal until codified |
| **R9, owned** | Site landing pages, email, opted-in SMS, email and SMS retargeting flows; Instagram organic carries the same concepts at "9 by implication" | Acts named plainly, explicit arousal, temptation closer, never crude | §3.2a with §3.2c, bodyscape included | Instagram organic is not an ad surface; it is listed because every concept here should also feed it |

Three corrections to the brief, stated plainly so nobody builds on them:

1. **"Zoom in to hide that they are toys" is an aesthetic everywhere and a disguise nowhere.** On a
   paid platform, abstracting a product so a reviewer cannot tell what it is would be exactly the
   evasion `ads-policy.md` bans ("never wellness-wash a pleasure product, reviewers follow the
   landing page"; §3.2a: "anything built to defeat a classifier"). The ad clicks through to a sex
   toy store, so the reviewer finds out anyway and the account pays for it. Macro abstraction is a
   strong look on owned surfaces, X, adult networks and Instagram. It is not a way onto Meta.
2. **"Body parts not identifiable" is not the test.** On paid creative, any product resting on bare
   skin is ineligible whether or not the body part reads (`ads-policy.md` §Creative rules). On
   organic and owned surfaces the bodyscape is already licensed by §3.2c, and the stop list is
   judged on the shipped pixels, not on whether a viewer can name the zone. Bodyscape therefore has
   no R3-4 rendering. Its R3-4 rung is a product-only frame.
3. **"Retargeting at 9 on owned pixel audiences" does not exist on Meta.** A pixel audience is still
   served on Meta's inventory, and the creative still has to clear Meta's adult-products ban. Register
   9 retargeting runs through email and SMS flows (browse abandonment, cart abandonment, post-purchase)
   and through any adult network that supports its own retargeting pixel. Klaviyo currently has zero
   flows built, so the R9 retargeting channel is a build, not a switch.

## 1. Products this bank is grounded in

Pulled 2026-10-03 from the live Storefront API (in stock, best-selling sort). Prices move daily
under the pricing agent, so no price below may be baked into an image or an ad. `dial` is the stored
`xdipx.product_type_dial` value.

| Product | Handle | Shopify type | dial | Price today |
|---|---|---|---|---|
| Womanizer Liberty 2 Air Pulsation Clitoral Stimulator Purple | `womanizer-liberty-2-purple` | Suction Vibrator | vibrator | $94.99 |
| LELO SONA 3 Sonic Clitoral Stimulator Purple | `lelo-sona-3-clitoral-stimulator-purple` | Suction Vibrator | vibrator | $158.99 |
| ROMP Lipstick Pleasure Air Clitoral Stimulator | `romp-lipstick-pleasure-air-stimulator` | Suction Vibrator | vibrator | $53.99 |
| Wild Rose The Classic Silicone Suction Vibrator Red | `wild-rose-the-classic-suction-vibrator-red` | Suction Vibrator | vibrator | $44.99 |
| Le Wand Powerful Petite Plug-In Corded Wand Massager White | `le-wand-powerful-petite-plug-in-white` | Wand Massager | vibrator | $108.99 |
| VUSH Majesty 2 Rechargeable Waterproof Wand Vibrator | `vush-majesty-2-wand-vibrator` | Wand Massager | vibrator | $80.99 |
| VeDO Wini Rechargeable Mini Wand, Tease Me Turquoise | `vedo-wini-rechargeable-mini-wand-tease-me-turquoise` | Wand Massager | vibrator | $55.99 |
| Dame Zee Rechargeable Bullet Vibrator Periwinkle | `dame-zee-bullet-vibrator-periwinkle` | Bullet Vibrator | vibrator | $21.99 |
| Evolved Shiver Dual-Ended Wand & G-Spot Vibrator Purple | `evolved-shiver-silicone-rechargeable-purple` | Wand Massager | vibrator | $100.99 |
| Sliquid Naturals H2O Intimate Lubricant 8.5oz | `naturals-h2o-intimate-lubricant-8-5-oz` | Lubricant | lube | $15.99 |
| LELO Water-Based Personal Moisturizer with Aloe 75ml | `lelo-water-based-personal-moisturizer-75-ml-2-5-oz` | Lubricant | lube | $14.99 |
| ID Sensation Warming Water-Based Lubricant 4.4oz | `id-sensation-warming-water-based-lubricant` | Lubricant | lube | $4.99 |
| Fantasy Lingerie Glow In My Sight Rhinestone Cut-Out Bra & Panty Set S/M | `fantasy-lingerie-glow-in-my-sight-wide-net-mesh-cut-out-bra-strappy-panty-with-rhinestone-clasp-s-m` | Bra & Panty Set | wear | $28.99 |
| Sportsheets Sex & Mischief Pearl Garters | `sportsheets-sex-mischief-peaches-n-creame-pearl-garters` | Accessory | wear | $25.99 |
| Dame Eva II Hands-Free Couples Clitoral Vibrator Ice | `dame-eva-couples-vibrator-ice` | Clitoral Vibrator | couples | $116.99 |
| We-Vibe Sync 2 Remote Control Couples Vibrator Green Velvet | `we-vibe-sync-2-rechargeable-remote-control-couples-vibrator-green-velvet` | Rabbit Vibrator | couples | $152.99 |
| We-Vibe Shared Touch Wearable Couples Vibrator Purple | `we-vibe-shared-touch-purple` | Vibrator | couples | $116.99 |
| Arcwave Zing Vibrating Open-Sleeve Masturbator | `arcwave-zing` | Stroker | stroker | $134.99 |
| b-Vibe Butties Shake Slimline Vibrating Prostate Plug | `b-vibe-shake` | Vibrating Anal Toy | anal | $53.99 |
| LELO F1S V3 XL Vibrating Male Stroker Console | `lelo-f1s-v3-xl-red` | Stroker | stroker | $173.99 |
| LEVELZ Bulb Loop Silicone Prostate Massager Small | `levelz-bulb-with-loop-silicone-prostate-massager-small-black` | Prostate Massager | anal | $8.99 |
| LELO BEADS Plus Kegel Training Ball Set | `lelo-beads-plus-kegel-balls-set` | Kegel Trainer | wellness | $80.99 |
| Sportsheets Steele Balls Stainless Steel Kegel Weight Set | `sportsheets-sex-mischief-steele-balls-stainless-steel` | Kegel Exerciser | wellness | $17.99 |

Two data facts that shape the concepts:

- **Air-pulsation and wand SKUs carry `dial: vibrator`,** not the `air-pulsation` or `wand` values
  CLAUDE.md lists. Any ad pipeline that picks products by dial will not find them. Pick by Shopify
  type or title until the dial is backfilled.
- **The `reviews` table holds one approved review**, unverified, reading "This worked great. Felt
  amazing." under the title "This is the review!", which looks like a test row. Review-quote ads are
  impossible today without fabricating proof, which doctrine §6 forbids. See §4 item 12.

## 2. Campaign concepts

Fourteen concepts. The brief asked for ten and named twelve that had to be included; the last two
(Spec Sheet and Second Spring) are here because they are the only two that make Meta paid usable at
all. Every concept lists its ladder against the tiers in §0.

### 2.1 Sculpture Hall (macro product abstraction)

**Idea:** shoot the toy so close it reads as a gallery object: a curve, a seam, a pool of light on
silicone, then reveal the name in the type.

**Visual system:** archetype B taken to macro. One product, filling the frame past its own edges,
on a coral-soft or plum-soft field, hard directional light so the shadow becomes a second form. No
body. The product's real colour does the work (Womanizer Liberty 2 purple on coral-soft, Le Wand
Petite white on plum-soft). Interest floor: P7 scale surprise, P4 named hour, P8 one colour wrong on
purpose, P9 edge implies a bigger object.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Shop Campaigns, Shopping | Not as position 0. A product listing has to show the product whole. The macro runs as image 2 or 3 on the PDP | Shop title only |
| R3-4 | Meta carve-out | Lube or LELO BEADS Plus only, macro of the bottle cap or the steel bead, honest and identifiable on a second look | "LELO BEADS Plus, Six Weights" |
| R6-7 | X, adult networks | Full macro, the reveal line names the product | "Le Wand Petite: plug it in and forget the charger." |
| R9 | Email header, landing page hero | Macro opens the email, second frame is the same product on skin (§3.2c) | "Corded, so your orgasm never waits on a battery." |

**Products:** anything with a strong silhouette and finish. Womanizer Liberty 2, LELO SONA 3, Le
Wand Petite, LEVELZ Bulb, LELO BEADS Plus, Steele Balls (polished steel photographs like jewellery).

**Why it converts:** it stops the scroll on curiosity rather than on heat, which is the one hook
that works at every tier. Premium finish shots also justify the $80 to $170 price points that the
store's ~$33 median basket is failing to reach.

**Risk:** the disguise trap in §0 item 1. On owned surfaces, a frame so abstract nobody can tell
which product it sells breaks doctrine §4.3's "the product is the hero" composition rule, so the
reveal frame or the type has to name it.

### 2.2 Body Map (bodyscape close-ups)

**Idea:** the body is the landscape and the product is the only object in it, cropped so close the
picture reads as curve and light before it reads as a person.

**Visual system:** §3.2c bodyscape exactly as specified there: one body zone, product forward,
large and sharp, contact zone bare, styled from the cast member's closet in `cast-wardrobe.md`.
Zones rotate (hip hollow, small of the back, sternum, inner wrist, top of thigh, shoulder blade). No
face. Daylight. The ground lock does not apply to an on-skin crop; the hour of the light and one
sheet or surface edge carry the world.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | none | No rendering exists. Paid creative bans on-skin frames outright. Use Sculpture Hall instead | n/a |
| R6-7 | X organic, adult networks | §3.2c bodyscape, mid-charge zones (wrist, shoulder, small of the back) | "Majesty 2. Press, and the hour disappears." |
| R9 | Email, SMS art, landing page, Instagram organic | Ceiling zones per §3.2a (hip hollow, under-curve of the breast at the top edge, back with the tops of the cheeks) | "Majesty 2: press close, and your thighs start shaking first." |

**Products:** air pulsation (Womanizer Liberty 2 in the hip hollow is a proven reference shape,
library assets 602 and 640), wands, Dame Zee at the collarbone, LELO BEADS Plus in a palm, ROMP
Lipstick at the collarbone because the disguise is what people buy.

**Why it converts:** it is the treatment the owner has already validated on social, and it lets a
customer picture the moment of use, which a packshot never does.

**Risk:** a model renders wide about half the time. The crop is the closer: crop the render to the
briefed zone and gate the crop, never the raw render. Placement follows use (§3.2c): a rose goes
in a hand, not on a thigh.

### 2.3 Say It Plain (typographic-only ads)

**Idea:** the slogan is the art. Big Newsreader type on a flat coral-soft, plum-soft or white field,
one italic plum word, nothing else.

**Visual system:** a designed typographic ad, built in a layout template, never generated. Newsreader
display, DM Sans for the small line, a JetBrains Mono kicker, the `.em` plum italic on exactly one
word, the CTA in DM Sans. Coral budget rule from doctrine §3: one coral element per frame at most.
This is the only concept where words sit in the pixels, and they sit there because a designer set
them, which is the exception the doctrine allows.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Meta carve-out (lube, kegel), Google RSA text | Type card for Meta; plain RSA headlines for Google (no glyphs: Google rejects → and ♥) | "Which Lube Suits Silicone?" |
| R6-7 | X, adult networks, newsletter placements | Type card | "Sex toy. Two words, and nobody fainted." |
| R9 | Email headers, SMS MMS art, landing page section breaks | Type card, the italic word carries the heat | "Two in the afternoon is a fine hour for an orgasm." |

**Products:** brand-level first, then one product per card. Pairs with every slogan in §3.

**Why it converts:** zero image spend, zero vision-gate risk, instant A/B across tiers, and it is
the purest carrier of the voice, which is the thing competitors cannot copy.

**Risk:** a type card for a pleasure product on Meta is still a pleasure ad. The R3-4 rung is
lube and kegel only.

### 2.4 Orchard (fruit, flower and object metaphor)

**Idea:** the oldest workaround in the category, done with craft: a halved fig, an orchid throat,
honey pulling off a dipper, a split peach in hard window light.

**Visual system:** archetype D (single-concept metaphor macro) on social; archetype E (surreal
hybrid: a rabbit vibrator nested in an orchid, a wand as a lighthouse over a silk sea) on owned
surfaces only. Ground lock and high-key daylight bind. On social the metaphor is never composited
into the same frame as a product and the caption never names it (§3.3 and the social addendum).

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | none | Suggestive produce is the exact pattern Meta's adult-content review removes, and Google Search has no image | n/a |
| R6-7 | Adult networks; X organic within the 2-per-rolling-7 cap for standalone metaphor | Archetype D, product in a separate frame or slide | "Wild Rose, kept within reach." (product slide) |
| R9 | Email, landing page, OG share images | Archetype E hybrid, product in frame | "Wild Rose: a mouth in petal-soft silicone." |

**Products:** Wild Rose (the rose is already a metaphor, so the hybrid writes itself), Womanizer
Liberty 2, ID Sensation Warming (honey), Sliquid H2O (a water bead on a petal).

**Why it converts:** shareable. An image a reader forwards to a friend is free distribution, and the
OG image travels into group chats the brand cannot buy its way into.

**Risk:** the doctrine bans fruit as a housewares prop. One piece of fruit as the single concept is
archetype D; a bowl of it on a table is the retired July 2026 look. Never put produce and a product
in one social frame.

### 2.5 The Morning After (domestic stills)

**Idea:** the scene one minute after: evidence that something good happened here, with nobody in
frame.

**Visual system:** archetype C bright scene with the interest floor's narrative group doing the
work: P1 evidence of a person (a robe belt on the floor, one earring on the sheet), P2 interrupted
state (charging cable still connected, lid off and beside the lube), P9 a frame edge implying the
room. Daylight at a named hour. **No mugs, no coffee, no breakfast tray**: tableware is banned and
it is the first thing a model reaches for on this brief. Not always the bedroom either; the
location bank's no-repeat-in-8 rule applies.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Meta carve-out | Lube only: Sliquid H2O, cap off and beside it, on a bathroom shelf in morning light. No body | "Sliquid H2O, Water-Based Lube" |
| R6-7 | X, adult networks | The product on its charger beside a slip strap, 8am raking light | "Tuesday, 2pm, door open. Nobody's business." |
| R9 | Email (post-purchase and win-back), landing page | Same scene plus a bare shoulder at the frame edge, §3.2a | "Leave the set on. They'll work around it." |

**Products:** Le Wand Petite (the cord still plugged in is P2 for free), Dame Eva II, the Fantasy
Lingerie set on the floor, Sliquid H2O.

**Why it converts:** the reader writes the story. That is the charter's "fire the fantasy, then step
back" in one picture.

**Risk:** the story test. If a reviewer cannot say what happened one second before, the frame is
catalog-on-a-table wearing a bedroom costume.

### 2.6 Hands Only (couples)

**Idea:** two people, only their hands and forearms in frame, passing a product or a remote between
them.

**Visual system:** archetype A with two hands. Different skin tones and ages across the set,
adult age markers stated in every prompt. The hand-off is the story: one hand offering the We-Vibe
Sync 2 remote, the other reaching. Ring on one hand, a watch on the other (P1). Coral-soft or plum-soft
wall, hard window shadow.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA text; Shop title | Text only for Google. No hand imagery on Shop position 0 | "Remote-Controlled Couples Toys" |
| R6-7 | X, adult networks | Two hands, one remote, a sheet edge | "Sync 2: settle who holds the remote." |
| R9 | Email, landing page | Hands on a hip and a waist with Eva II resting against the hip bone, §3.2a two-people licence | "Hand over the remote. Every orgasm is theirs to time." |

**Products:** We-Vibe Sync 2, Dame Eva II, We-Vibe Shared Touch. The long-distance variant (one
hand in each of two split frames, two cities in the window light) needs an app-connected SKU and a
verified range claim before any line mentions distance; LELO F2S is titled "App-Connected", nothing
else in this pull states it.

**Why it converts:** couples buyers spend more (both couples SKUs here are over $115) and the
hands-only frame is the cheapest way to show two people without a single policy question.

**Risk:** §3.7a. A man alone never carries a `female`-classified product; in a two-hand frame he
holds it against her skin or hands it to her.

### 2.7 Statement Reads XDIPX (discretion as the product)

**Owner correction (2026-10-05, ad-owner-notes rule 1).** The three lines in the table below are
retired as written. The owner turned down "Billing Reads XDIPX" and creatives carrying "The box says
nothing. You won't be quiet." A replacement leads with a catchy line about the product and keeps the
discretion fact to a second clause or a supporting line, run through the humanizer before it ships.

**Idea:** sell the thing every first-time buyer is worried about: the box, the label, the bank line.

**Visual system:** typographic plus one prop. A plain shipping box on a coral-soft field, shot like
a luxury unboxing, lid closed. Or a type card mimicking a bank statement line, with "XDIPX" the only
legible merchant. No product in frame at R3-4, which is what makes it the most broadly runnable
concept in the bank.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA (Theme C of the existing bank); Meta carve-out landing on a lube PDP | Plain box, closed | "Billing Reads XDIPX" |
| R6-7 | X, adult networks, newsletter placements | Box with the lid lifted one centimetre, product colour glowing through the gap | "The box is boring on purpose." |
| R9 | Email to first-time browsers, cart abandonment | Box open, product on skin beside it | "The box says nothing. You won't be quiet." |

**Products:** brand-level; pair with any first-purchase SKU (Dame Zee, Sliquid H2O).

**Why it converts:** it removes the objection that stops the first purchase, and it carries the
thesis directly ("the door doesn't have to stay closed").

**Risk:** whisper-language. "No one will ever know" is banned by trust canon 1; discretion is
courtesy, not secrecy. Every line here has to pass that.

### 2.8 Frequency (sound and vibration made visible)

**Idea:** show what a motor does by what it does to water: standing ripples, beads of water
dancing on the silicone head, a droplet frozen mid-jump.

**Visual system:** macro, product as object, water as the second element. Faraday ripples in a
shallow film of water on the product's own surface, or beads standing on the head of LELO SONA 3.
High-speed look, 1/8000 freeze, coral-soft field. No body at R3-4 and R6-7. The water is a physics
shot, not lube texture, so it stays clean at every tier.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA text; PDP image 2 | Text: education on sonic versus pulsation. Picture lives on the PDP | "Sonic Stimulators, Plainly" |
| R6-7 | X, adult networks | Water beads jumping off SONA 3 | "SONA 3. Cancel the three o'clock." |
| R9 | Email, landing page | Same physics on skin: a droplet trembling on a hip bone beside the product, §3.2c | "SONA 3: the slow climb, then the long fall." |

**Products:** LELO SONA 3, Womanizer Liberty 2, VUSH Majesty 2, Le Wand Petite.

**Why it converts:** it answers "how strong is it" without a spec number, and motion-ready stills
convert straight into a 3-second loop for video.

**Risk:** spec claims. Any line about quietness or intensity needs a spec from the feed, and the
voice charter keeps mechanism language out of R9 selling copy.

### 2.9 For Him, Plainly

**Idea:** men's toys shot and written with the same confidence as everything else on the shelf,
with no locker-room wink and no apology.

**Visual system:** archetype C and §3.2c with a male cast member: bare chest (male nipples are not
nudity), forearm, the small of his back, a hand around the Arcwave Zing. Same palette, same daylight,
same type system as the women's concepts, which is the whole point.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA; Shop title | Text only; Shop position 0 is the packshot | "Prostate Massagers 101" |
| R6-7 | X, adult networks, men's-interest newsletters | Zing held in a hand against a bare forearm | "Men's toys, shelved next to everyone else's." |
| R9 | Email, landing page | Bodyscape on his lower back with Butties Shake resting there, cleft closed by the pose per §3.2a | "Zing: both hands free, nothing left to do but finish." |

**Products:** Arcwave Zing, b-Vibe Butties Shake, LELO F1S V3 XL, LEVELZ Bulb.

**Why it converts:** competitors split men's toys into a jokey or a porny aisle. Treating them like
premium objects is open ground, and strokers carry high ticket prices.

**Risk:** §3.2a forbids product against genitalia, so a stroker's honest placement is a hand, a
thigh or a nightstand, never its use zone.

### 2.10 The Gift (anniversary and occasion)

**Idea:** the present you open after the guests leave.

**Visual system:** archetype B with a ribbon: the product, half unwrapped, tissue pulled back, a
gift tag left blank (no text negative on the tag). On owned surfaces a second person's hand pulls the
ribbon. Calendar moments come from `merch-calendar`, never with a countdown or "last day to order".

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA (gift-intent searches); Shop | Text; Shop position 0 untouched | "Discreet Anniversary Gifts" |
| R6-7 | X, adult networks, gift-guide newsletters | Box half unwrapped, product colour visible | "The gift they open after the guests leave." |
| R9 | Email (anniversary segment), landing page | Two hands, ribbon, product against a collarbone | "Unwrap it together and spend the anniversary in bed." |

**Products:** Dame Eva II, We-Vibe Shared Touch, the Pearl Garters plus Sliquid H2O as a bundle,
the Lovehoney x We-Vibe advent set when in season.

**Why it converts:** gift intent is real search demand with a higher basket, and gifting gives a
first-time buyer a reason that is not about themselves.

**Risk:** "last chance for Valentine's" is urgency theater and stays banned. Shipping-time facts
are a support statement, not a countdown.

### 2.11 Overheard at the Counter (scripted shop exchange, visibly ours)

**Idea:** one short exchange between the shop and a customer, set as a typographic card. The owner
killed the text-message version on 2026-10-03 because a fake chat UI reads as fabricated proof. This
keeps the comedy and drops the disguise: no bubbles, no phone frame, no implied real person.

**Visual system:** a type card in the Say It Plain family. A JetBrains Mono kicker "At the xdipx
counter", the customer's line in DM Sans, the shop's answer in Newsreader with one italic plum word,
nothing else on a coral-soft, plum-soft or white field. The exchange is written by us and reads as
the brand talking. No names, no avatars, no timestamps, no "real customer" framing.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Meta carve-out | Two lines about lube | "Is lube weird to buy?" / "It's skincare for the parts that have more fun." |
| R6-7 | X, adult networks | Two lines | "Does it come in a plain box?" / "Plainer than your mail." |
| R9 | Email, SMS | Two lines, the answer names the act | "What does the cord change?" / "Nothing runs flat halfway through your orgasm." |

**Products:** ROMP Lipstick, Le Wand Petite, Sliquid H2O, Dame Zee.

**Why it converts:** the comedy disarms the shame before the product arrives, and a shop talking
is a claim nobody can mistake for a testimonial.

**Risk:** drift back toward a chat UI. If a designer adds a bubble, a name or a photo, it is the
killed concept again. Emma never appears as a participant who has used anything.

### 2.12 Ask Emma (quiz ads to /discover)

**Idea:** the ad is the first question of The Compass, and the click is the answer.

**Visual system:** a two-option type card ("Fast or slow?", "Inside or outside?", "Solo or
together?") with two tappable halves, each linking to `/discover` with the answer pre-set in a UTM
or query param (never personal data in the URL). Emma's name sits on the card as the guide who
matches against specs and reviews, never as someone who knows the catalog cold.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Google RSA headline linking to /discover | Text | "Find Your Fit" (no glyph on Google) |
| R6-7 | Adult networks, X, newsletters | Two-option card | "Fast or slow? Pick one, and Emma matches the rest. Find your fit →" |
| R9 | Email to non-buyers, SMS | Card with a bodyscape behind it at 30 percent | "Slow and deep, or quick and sure? Emma's matching either. Show me" |

**Products:** catalog-wide; the Compass picks.

**Why it converts:** a quiz click is a low-commitment yes, and the Compass can capture an email
before the product page, which turns rented traffic into an owned audience.

**Risk:** the quiz's first screen has to match the ad's question, or the message match breaks and
the bounce pays for nothing.

### 2.13 Spec Sheet (comparison ads)

**Idea:** two products side by side on a clean field with five honest rows (power source, material,
size, water rating, best for), and the reader picks.

**Visual system:** archetype B diptych plus a typeset table in JetBrains Mono. Product photos are
real packshots normalised to the ground lock. This is the knowledge pillar made visual, and it is
the most paid-native concept in the bank.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Meta carve-out (Sliquid H2O versus LELO moisturizer); Google RSA "compare" ad groups | Diptych, factual rows only | "Water-Based or Aloe? Compared" |
| R6-7 | X, adult networks | Le Wand Petite versus VUSH Majesty 2: corded versus rechargeable | "Corded or cordless? One of these never runs flat." |
| R9 | Email, landing page | Same table, the last row rewritten as desire | Last row: "Best for: the afternoon you don't get up from." |

**Products:** natural pairs. Le Wand Petite and VUSH Majesty 2; Womanizer Liberty 2 and LELO SONA 3;
Sliquid H2O and LELO moisturizer; LEVELZ Bulb and b-Vibe Butties Shake.

**Why it converts:** comparison shoppers are close to buying, and a table answers the question that
otherwise sends them to a competitor's review site.

**Risk:** every row must trace to feed data or the label. A blank cell beats an invented one.

### 2.14 Second Spring (midlife, post-partum and menopause wellness)

**Idea:** comfort and pelvic-floor care, framed as sexual health for women whose bodies changed.
This is the one concept built to fit Meta's health carve-out honestly.

**Visual system:** archetype A and B: a hand holding LELO moisturizer with aloe, LELO BEADS Plus in a
palm, morning light, an adult woman's hand with age shown plainly (rings, knuckles, a watch).
Sincere register. The levity license does not apply: doctrine §4.2 keeps wit off health-heavy
surfaces.

| Tier | Destination | Picture | Words |
|---|---|---|---|
| R3-4 | Meta carve-out (25+ floor, clinical framing, health landing page); Google RSA | Hand and product, no body | "Pelvic Floor Training Weights" |
| R6-7 | X, newsletters for midlife readers | Same, warmer light | "Steele Balls turn errands into reps." |
| R9 | Email to an opted-in segment | Bodyscape stays sincere: product in a palm against a bare stomach | "Wear the weight to the market, come home already warm." |

**Products:** LELO Water-Based Personal Moisturizer with Aloe, Sliquid H2O, LELO BEADS Plus,
Sportsheets Steele Balls.

**Why it converts:** an under-served audience with real need, and the only door onto Meta's
inventory this store has.

**Risk:** the highest compliance load in the bank. No efficacy or medical claim beyond the label
("relieves", "restores", "tightens" are out unless labeled). The landing page must be a lube or
kegel PDP or a wellness collection that carries no pleasure catalog above the fold, because Meta's
reviewer follows the click. The pixel, CAPI and the 232 Shop-approved products live on the same
Meta business, so a rejected-ad pattern risks all of it. Owner decision before any spend.

## 3. Slogan bank

74 lines. R3-4 lines are written to fit a 30-character Google RSA headline and carry no glyphs.
R6-7 lines suit X and adult networks. R9 lines are for owned surfaces only. Every line has been
checked against the charter's banned tics and against every other line in this bank; no phrase
repeats. Use each line once per campaign and retire it after (the fresh-language rule doubles as a
fatigue control).

**Air pulsation (Womanizer Liberty 2, LELO SONA 3, ROMP Lipstick Pleasure Air, Wild Rose)**

1. [R3-4] Air Pulsation, Explained
2. [R3-4] Sonic Stimulators, Plainly
3. [R3-4] Liberty 2, a Travel Vibrator
4. [R3-4] ROMP Lipstick, Purse-Sized
5. [R6-7] Liberty 2 fits the carry-on. Pack accordingly.
6. [R6-7] ROMP Lipstick. Reapply as needed.
7. [R6-7] Wild Rose, kept within reach.
8. [R6-7] SONA 3. Cancel the three o'clock.
9. [R9] Womanizer Liberty 2: oral, packed for the trip.
10. [R9] SONA 3: the slow climb, then the long fall.
11. [R9] Wild Rose: a mouth in petal-soft silicone.
12. [R9] Lipstick-sized. The orgasm is full-size.

**Wands (Le Wand Petite, VUSH Majesty 2, VeDO Wini)**

13. [R3-4] Plug-In Wand, No Recharging
14. [R3-4] Wand Massagers, Compared
15. [R3-4] VeDO Wini, a Palm-Sized Wand
16. [R6-7] Le Wand Petite: plug it in and forget the charger.
17. [R6-7] Majesty 2. Press, and the hour disappears.
18. [R6-7] Wini fits a palm and fills a whole Sunday.
19. [R9] Corded, so your orgasm never waits on a battery.
20. [R9] Majesty 2: press close, and your thighs start shaking first.
21. [R9] Mini wand, and your whole body answers.

**Vibrators and bullets (Dame Zee, Evolved Shiver)**

22. [R3-4] Dame Zee: Rechargeable Bullet
23. [R3-4] How Dual-Ended Vibrators Work
24. [R6-7] Dame Zee rides in the coin pocket.
25. [R6-7] Shiver: two ends, so nobody has to choose.
26. [R9] So small, and somehow it still undoes you.
27. [R9] Shiver: filled inside, buzzing outside, both at once.

**Lube (Sliquid Naturals H2O, LELO moisturizer with aloe, ID Sensation Warming)**

28. [R3-4] Sliquid H2O, Water-Based Lube
29. [R3-4] Which Lube Suits Silicone?
30. [R3-4] LELO Moisturizer With Aloe
31. [R3-4] Warming Lube, Water-Based
32. [R6-7] ID Sensation warms on contact.
33. [R6-7] The bottle that belongs beside every toy.
34. [R6-7] Sliquid H2O, for skin that runs sensitive.
35. [R9] Slick fingers, and wetter than you planned.
36. [R9] Warmth spreading wherever their hands go next.
37. [R9] Aloe-soft glide, and every stroke goes deeper.

**Wear (Fantasy Lingerie Glow In My Sight set, Sportsheets Pearl Garters)**

38. [R3-4] Glow-in-the-Dark Lingerie
39. [R3-4] Faux Leather Pearl Garters
40. [R6-7] Lights off is optional. It glows anyway.
41. [R6-7] Pearls, clipped right where the stocking ends.
42. [R6-7] Mesh cut-outs and one rhinestone clasp to undo.
43. [R9] Pearls on your thighs, their mouth between them.
44. [R9] Leave the set on. They'll work around it.

**Couples (Dame Eva II, We-Vibe Sync 2, We-Vibe Shared Touch)**

45. [R3-4] Hands-Free Couples Vibrator
46. [R3-4] Remote-Controlled Couples Toys
47. [R6-7] Eva II stays put, so you both get to move.
48. [R6-7] Sync 2: settle who holds the remote.
49. [R9] Eva II hums against her while you're inside her.
50. [R9] Hand over the remote. Every orgasm is theirs to time.
51. [R9] Shared Touch: you both tremble, and nobody's holding it.

**For him (Arcwave Zing, b-Vibe Butties Shake, LELO F1S V3 XL, LEVELZ Bulb)**

52. [R3-4] Arcwave Zing: Two Motors
53. [R3-4] Prostate Massagers 101
54. [R3-4] Hands-Free Stroker Guide
55. [R6-7] Butties Shake: new territory, zero shame.
56. [R6-7] LELO F1S. Set it, lie back, stay a while.
57. [R6-7] Men's toys, shelved next to everyone else's.
58. [R9] Zing: both hands free, nothing left to do but finish.
59. [R9] Butties Shake: a release from somewhere new.
60. [R9] LEVELZ Bulb: one small curve, a much longer finish.

**Wellness (LELO BEADS Plus, Sportsheets Steele Balls)**

61. [R3-4] Pelvic Floor Training Weights
62. [R3-4] LELO BEADS Plus, Six Weights
63. [R6-7] Steele Balls turn errands into reps.
64. [R9] Wear the weight to the market, come home already warm.

**Gifting**

65. [R3-4] Discreet Anniversary Gifts
66. [R6-7] The gift they open after the guests leave.
67. [R9] Unwrap it together and spend the anniversary in bed.

**Discretion and brand**

68. [R3-4] Billing Reads XDIPX
69. [R3-4] Shipped in a Plain Box
70. [R6-7] Your bank statement sees five letters.
71. [R6-7] The box is boring on purpose.
72. [R6-7] Tuesday, 2pm, door open. Nobody's business.
73. [R9] The box says nothing. You won't be quiet.
74. [R9] Two in the afternoon is a fine hour for an orgasm.

Checks to rerun on any edit: R3-4 lines at or under 30 characters; no "sexy" or "sex" as an
adjective; no "Buy now"; no countdown or scarcity of time; no "land" for a sensation; none of the
charter's retired tics ("minus the mercy", "the whole way down", "orgasm after orgasm", "is
waiting", "keeps coming back"); no line claiming Emma tried anything; no price in any line.

## 4. Hook formulas

Fifteen reusable shapes. Each template is followed by one filled example and its tier.

1. **The plain word.** "[Category noun]. [A plain, unbothered reaction]."
   [R6-7] "Sex toy. Two words, and nobody fainted."
2. **Spec as poetry.** "[Fact]. [Fact]. [What the reader's body or day does with it]."
   [R9] "Two motors. One open sleeve. Your hands stay behind your head." (Arcwave Zing)
3. **The searched question.** "[A question people type into Google]?"
   [R3-4] "Suction or sonic: what's the difference?"
4. **Permission.** "You're allowed to [want or buy the thing] [at an ordinary time or place]."
   [R6-7] "You're allowed to buy a vibrator on your lunch break."
5. **The shopkeeper's confession.** "Full disclosure: [the plain commercial truth]." The brand
   confesses, never Emma, and never about having used anything.
   [R6-7] "Full disclosure: we sell sex toys, and we'd like to sell you one."
6. **You know the category.** "You know what a [category] does. [The one detail that is new]."
   [R6-7] "You know what a wand does. This one plugs into the wall." (Le Wand Petite)
7. **The myth, corrected.** "[A belief people actually hold]? [The fact]."
   [R3-4] "Think lube means something's wrong? It makes nearly every toy smoother."
8. **Scale surprise.** "Smaller than [an everyday object], and [the outcome]."
   [R9] "Smaller than your phone, and it will still take you apart." (Dame Zee)
9. **Daylight.** "[Weekday], [hour], [an ordinary sunlit place]. [Product, ready]."
   [R6-7] "Wednesday, 3pm, sun across the bed. Wini, charged."
10. **The short list.** "[Product], [companion], and [condition]. That's the plan." Only when the
    meaning really has three parts.
    [R9] "Eva II, the warming lube, and the door left open. That's the plan."
11. **The price anchor.** "[Product] costs less than [an ordinary expense]." Owned surfaces only,
    with the price rendered live from Shopify at send time, never typed. Never on Google.
    [R6-7] "Dame Zee costs less than the cab home."
12. **The number with a source.** "[A real statistic the charter or a cited study carries]. [Product]
    as the answer."
    [R6-7] "95% and 65%. That's the orgasm gap. Eva II was made for the second number." (stat from the
    charter's social addendum; cite the study on the landing page)
13. **The overheard line (ours, never a customer's).** "[A question anyone might ask at the counter]" / "[The shop's answer]." Written as the brand speaking, never attributed to a customer.
    [R6-7] "Does it come in a plain box?" / "Plainer than your mail."
14. **Pick one.** "[Option A] or [option B]? Pick one, and Emma matches the rest." Drives to /discover.
    [R6-7] "Fast or slow? Pick one, and Emma matches the rest. Find your fit →"
15. **Sensation first, name second.** "[Two or three sensory facts]. [Product name]." The product is
    always named in the same line, so it never becomes the "gets where? closes what?" gesture the
    charter bans.
    [R9] "Warm, slick, and steady against you. It's the Wild Rose."

## 5. What you haven't thought of

Fifteen ideas, tagged by area.

1. **[Operations] Text lives in a layout layer, not in the generated image.** Build one HTML
   template set (Newsreader, DM Sans, JetBrains Mono, the coral and plum tokens) and render ads by
   compositing a slogan onto a text-free plate with a headless browser. One plate then serves every
   tier and every slogan, the doctrine's no-text-in-pixels rule holds, and swapping a line costs
   nothing. This is what makes "slogans on products" possible at volume.
2. **[Operations] Rate the concept before rendering it.** Score each brief against the interest floor
   (four properties, one narrative) and the stop list before spending a generation. Doctrine §4.1
   budgets about 1.5 calls per keeper; killing the weak brief in text saves the other half.
3. **[Distribution] Shop Campaigns is the biggest creative surface you already have, and its creative
   is your catalog.** Shopify builds those ads from media position 0 and the product title. The highest
   return creative job in this lane is archetype B color-block packshots across the approved catalog,
   run through `scripts/sweep-packshot-primaries.ts` so no Nalpac carton is primary. Keep
   third-party placements off.
4. **[Distribution] Bundles as the ad unit.** The median basket is about $33 and the Google unhold
   gate is a $45 AOV. Advertise "Le Wand Petite plus Sliquid H2O" as one thing, with one landing page.
   The ad fixes AOV instead of buying into it.
5. **[Measurement] Fix attribution before spending a dollar.** GA4 purchases arrive Unassigned today
   (no session id reaches the purchase event). UTMs are mandatory on adult networks, and every concept
   gets its own `utm_content` so the creative, not just the channel, is measured.
6. **[Measurement] Judge Shop Campaigns on contribution, not reported ROAS.** Shop's ROAS includes
   shipping and tax; with roughly $5 shipping the profit break-even is near 2.7x.
7. **[Distribution] One landing page per concept.** Reviewers and customers both follow the click.
   A Spec Sheet ad lands on the comparison, a Second Spring ad on a wellness collection with no
   pleasure catalog above the fold, a Body Map email on the PDP with the same zone in its gallery.
8. **[Operations] A creative fatigue clock.** Each line in §3 runs once per campaign and retires.
   For paid, refresh a creative when click-through falls a set fraction below its first-week rate,
   and log the retirement so a later run cannot reuse it.
9. **[Distribution] The R9 retargeting channel is a Klaviyo build.** Browse abandonment and cart
   abandonment flows, each email opening on a bodyscape of the exact product the reader left. Zero
   flows exist today, so this is the cheapest register-9 placement available and it is unbuilt.
10. **[Distribution] Newsletter sponsorships and whitelisted creators.** Adult-friendly and
    sex-education newsletters and the podcasts on `docs/store-team/podcast-shortlist.md` take
    sponsorship reads at R6-7. Disclosure is required, and the creator's own platform rules apply on
    top of ours.
11. **[Distribution] Reddit, organic and human-run.** Paid is effectively closed. Communities that
    allow vendors take an honest Spec Sheet post or an AMA-style answer thread far better than an
    ad. Read each subreddit's rules first; a per-community ban is the cost of skipping that.
12. **[Creative] Review-quote ads need real reviews first.** One approved review exists and it looks
    like a test row. Review invites never went out until five were hand-made today. Get the invite
    flow running; until then every proof component stays empty, never fabricated.
13. **[Creative] Weather and season as hooks, never as deadlines.** The first cold weekend ("staying
    in" frames, a wand under a duvet edge in grey light), the first heatwave (Sliquid H2O, water beads,
    bright noon). Pull themes from `merch-calendar`. No "this weekend only".
14. **[Risk] Never test pleasure creative on the Meta business that holds the pixel and the Shop.**
    The pixel, CAPI and 232 Shop-approved products all sit there. A pattern of rejected pleasure ads
    puts all three at risk for impressions the policy will never allow anyway.
15. **[Distribution] X gets wider imagery when ticket #10277 ships.** Today X's picture fence is
    Instagram's because the store cannot flag media as sensitive. Shipping the flag is the change that
    makes X the natural home for the R6-7 rungs of this bank.

## 6. Prompt spec for image generation

For `media-manager`. Every prompt starts from the base block, then adds its concept block. The
typographic concepts (2.3, 2.7 type cards, 2.11, 2.12, 2.13 tables) are not generated: they are
layout templates, and only their product plates are rendered.

### 6.1 Base block (every prompt)

- **Archetype:** declared before prompting (A, B, C, D, E, or on-skin per §3.2c).
- **Ground:** coral-soft (#FFE6DD), plum-soft (#F3E8FB) or bright white plaster. Never write the
  word "paper" in a prompt. Fabric named by colour and weave from `docs/store-team/cast-wardrobe.md`,
  never "warm off-white linen". An on-skin close crop has no ground; the hour of the light and one
  sheet or surface edge carry the world.
- **Light:** high-key daylight at a named hour, hard directional edge so the shadow has shape. Never
  candlelit, never near-black.
- **Product:** the real Shopify photo as `productImageUrl`, passed again in `extraImageUrls`. Scale
  stated from real dimensions relative to a hand. Shape, colour and finish faithful to the reference;
  scale may be played for wit per doctrine §4.2 except on Second Spring.
- **People:** adult age markers stated in words; vary age, body type and skin tone across a set;
  identity from the cast `referencePhoto`, never from the prompt. §3.7a cast-product match.
- **Ceiling:** on-skin and bodyscape frames follow `instagram-campaigns.md` §3.2a and §3.2c, read
  fresh before each brief. The negatives below copy its stop list as of 2026-10-03; §3.2a wins if it
  has moved.
- **Standard negatives:** no watermark, no caption, no invented text, no letters, no barcode, no
  shipping label, no ingredient panel, no retail carton, no handwriting on any prop surface, no mugs,
  no cups, no bowls, no candles, no napkins, no styled tables, no candlelight, no dark room.
- **On-skin negatives (add on every frame with a body):** no visible or outlined female nipple,
  areola edge or sheer fabric over it; no visible or outlined labia, penis or anus; no hand on
  genitals over or under clothing; no product against genitalia or on any nipple; no fluid near
  genitalia; no depicted sex act; no pubic hair above a lingerie line; no bulky knit, towel or draped
  bedding on the body; no unbriefed marks, redness or bruising; no youthful or age-ambiguous face or
  body.
- **Crop rule:** render, then crop to the briefed zone; the vision gate judges the crop that ships.
- **Paid variant:** any image for a Meta carve-out ad or Shopify media position 0 drops every body
  except at most one hand, and drops all on-skin language.

### 6.2 Per-concept blocks

| Concept | Subject and composition | Lens and light | Palette | Interest floor | Extra negatives |
|---|---|---|---|---|---|
| 2.1 Sculpture Hall | One product filling the frame past its edges, one curve and one seam in sharp focus | 100mm macro, f/4, hard side light at 9am | Product colour on the opposing tint (purple on coral-soft, white on plum-soft) | P4, P7, P8, P9 | no second object, no body |
| 2.2 Body Map | One body zone, product resting under its own weight on bare skin, closet piece closing one frame edge | 85mm, f/2.2, window light at a named hour, camera along the body's plane | Skin plus one closet colour that contrasts with it | P1 (closet piece), P4, P10 | standard on-skin set; no face unless briefed |
| 2.4 Orchard | One fig, orchid or honey pull, single concept, off-axis (D); or one invented hybrid with the product (E, owned only) | 100mm macro, f/5.6, raking 8am light | Coral-soft or plum-soft wall as raw plaster | P4, P6, P7 | no bowl, no plate, no second fruit; on social never in a product frame |
| 2.5 Morning After | Product mid-interruption: cable still plugged in, lid beside the bottle, robe belt on the floor | 35mm, f/2.8, low sun at 8am or 4pm | Bright white plaster, one plum-soft textile | P1, P2, P9, P4 | no tableware of any kind, no person in frame at R3-4 and R6-7 |
| 2.6 Hands Only | Two adult hands, different skin tones, one offering the product or remote, one reaching | 50mm, f/2.8, hard window shadow across both | Coral-soft wall | P1 (ring, watch), P2, P9 | no third hand, no face, hands anatomically correct |
| 2.7 Statement Reads XDIPX | Plain box shot like jewellery, lid lifted one centimetre at R6-7 | 85mm, f/4, single hard key | Box on coral-soft | P2, P6 | no logo, no label, no tape print, no text on the box |
| 2.8 Frequency | Water beads standing on the product's head mid-jump, ripple rings in a thin water film | 100mm macro, 1/8000 freeze look, backlit | Plum-soft field, clear water | P2, P5, P7 | no lube texture, no bowl or glass, no body at R6-7 |
| 2.9 For Him, Plainly | Adult man, bare chest, forearm or lower back, product in hand or resting on the back | 85mm, f/2.2, morning side light | Skin plus one closet colour | P1, P4, P10 | standard on-skin set; product never at the groin; cleft closed by pose |
| 2.10 The Gift | Product half unwrapped, tissue pulled back, blank tag, ribbon mid-pull by a second hand on owned | 50mm, f/2.8, soft daylight with a hard edge | Plum-soft tissue on coral-soft | P2, P3 (the blank tag), P9 | no writing on the tag, no holiday clichés |
| 2.11, 2.12, 2.13 plates | The product alone on its tint, for compositing into the template | 85mm, f/5.6, even high-key with one shadow edge | Per template | B baseline | no text, no props |
| 2.14 Second Spring | An adult woman's hand, age shown plainly, holding the moisturizer or a kegel weight; palm against a bare stomach on owned only | 50mm, f/2.8, morning window light | Bright white plaster, sage accent object at most | P1, P4 | no wit, no scale exaggeration, no clinical props |

## 7. Owner decisions this bank needs

1. Adult networks: approve R6-7 words with the §3.2a picture ceiling, or hold them at 3-4. The charter
   currently reserves the full register for owned channels.
2. Meta: approve or decline Second Spring and the lube carve-out ads, knowing a rejection pattern
   reaches the pixel and the Meta Shops on the same business.
3. The Group Chat concept was killed by the owner on 2026-10-03 and replaced by 2.11 Overheard at
   the Counter. No decision outstanding.
4. Klaviyo browse and cart abandonment flows: the build that makes R9 retargeting real.
