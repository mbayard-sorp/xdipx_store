# Competitor Instagram Teardown (August 2026)

**Status: reference, not binding.** Where this file and `docs/emma-voice.md`,
`docs/design-doctrine.md`, `docs/ads-policy.md`, or any publish gate disagree, those win. This is
the social counterpart to `docs/homepage-team/competitor-teardown-2026-07-live.md`: evidence about
what the category actually does, gathered so the social team plans against reality instead of
instinct.

Commissioned by owner direction 2026-08-17, verbatim: *"I'd like to have the /all-hands team
conduct research on our competitors instagram accounts and see what they've been posting. It should
help inform us of where we should be taking our account."*

**Sourcing rule, applied throughout.** Every claim is tagged `viewed-directly` (a logged-out fetch
of the profile actually rendered it), `coverage-only` (a third party described it), or
`unavailable` (blocked, and recorded as blocked). Handles are null when unverified, because a wrong
handle published into a tagging registry is worse than no handle. Post-level captions were almost
never retrievable; most per-post detail below is image alt-text or baked-in image text, and it is
labelled as such. Grid samples are 10 to 12 visible posts per account, not full audits.

---

## 0. The number that reframes the question

Before any competitor: **xdipx's own Instagram account had never been measured.** The engagement
capture path (`POST /api/team/social-post {"op":"engagement"}`, backed by
`app/lib/social-engagement.server.ts` and the `metrics_json` column from migration 079) was built,
tested, and shipped, and then **nothing ever called it**. No cron, no routine playbook, no script.
It was invoked for the first time in this session.

The first reading, now persisted to `social_posts.metrics_json`:

| Post | Date | Reach | Likes | Comments | Saves |
|---|---|---|---|---|---|
| id17 | 2026-08-08 | 4 | 0 | 0 | 0 |
| id24 | 2026-08-09 | 4 | 0 | 0 | 0 |
| id25 | 2026-08-09 | 7 | 0 | 0 | 0 |
| id47 | 2026-08-16 | 4 | 0 | 0 | 0 |
| id49 | 2026-08-16 | 7 | 0 | 0 | 0 |
| id50 | 2026-08-17 | 1 | 0 | 0 | 0 |
| **Total** | | **27** | **0** | **0** | **0** |

Six published posts in the account's life, 27 people reached in total, and not one like, comment,
or save. The most recent post reached one person.

Two things follow, and they order everything else in this document.

1. **No competitor format is worth copying until distribution exists.** Adopting Dame's carousel
   spec changes nothing at a reach of 4. Format is the second problem.
2. **The strategy has been running blind since day one.** `routine-social-daily.md` Step 7 lists
   engagement as a retro signal "once it is captured," and `instagram-campaigns.md` §7 still states
   "No engagement is captured. `social_posts` has no metrics column and nothing reads Instagram
   insights." That sentence is stale: the column exists, the read works, and it returns real
   numbers. The loop has been told it is blind while holding a working instrument.

---

## 1. The finding everything else agrees with: the category's big accounts are not product accounts

Across four independently-researched slices, product-forward share of grid and account size are
inversely correlated, and close to monotonically so.

| Account | Followers | Product-forward share of grid | Source |
|---|---|---|---|
| VUSH `@vush_official` | 747K | not accessible | `coverage-only` |
| Lovehoney `@lovehoneyofficial` | 422K | ~8% | `viewed-directly` |
| LELO `@lelo_official` | 289K | not assessed | `coverage-only` |
| Spectrum Boutique `@shopspectrumboutique` | 178K | not accessible | `coverage-only` |
| Wild Flower `@wildflowersex` | 134K | not accessible | `coverage-only` |
| Womanizer `@womanizerglobal` | 187K | near zero | `viewed-directly` |
| Foria `@foriawellness` | 160K | ~40% (60% educational) | `viewed-directly` |
| Adam & Eve `@therealadamandeve` | 133K | ~8% (50% educational) | `viewed-directly` |
| Satisfyer `@satisfyercom` | 109K | near zero | `viewed-directly` |
| Dame `@dameproducts` | 100K | ~50% | `viewed-directly` |
| Maude `@getmaude` | 100K | carousel-dominant, mixed | `viewed-directly` |
| We-Vibe `@wevibe` | 98K | ~20% (40% education) | `viewed-directly` |
| Doc Johnson `@docjohnsonusa` | 97K | near zero | `viewed-directly` |
| Pure Romance `@officialpureromance` | 82K | ~50% | `viewed-directly` |
| Smitten Kitten `@smittenkittenmn` | 78K | not accessible | `viewed-directly` (embeds) |
| Smile Makers `@smilemakerscollection` | 59K | mixed | `viewed-directly` |
| Honey Play Box `@honeyplaybox_official` | 43K | not accessible | `coverage-only` |
| Femme Funn `@femmefunn` | 30K | ~40% | `viewed-directly` |
| Babeland `@babeland_toys` | 27K | not accessible | `coverage-only` |
| Cake `@hellocake` | 24K | mixed | `viewed-directly` |
| Kindra `@ourkindra` | 17K | clinical-expert-led | `viewed-directly` |
| Peepshow Toys `@peepshowtoys` | 15K | not accessible | `coverage-only` |
| Early to Bed `@early2bed.shop` | 6.9K | not accessible | `coverage-only` |
| Too Timid `@tootimid` | 6.8K | ~55% + URL burned into creative | `viewed-directly` |
| Self Serve `@selfservetoys` | 6.7K | not accessible | `coverage-only` |
| SHAG `@weloveshag` | 6.0K | not accessible | `viewed-directly` (embeds) |
| **xdipx `@hello_xdipx`** | **unread** | **100%** | **`viewed-directly`, all 6 posts** |

"Not accessible" means the account is age-gated, so no grid could be sampled. It is never an
estimate. Roughly a third of the peer set could not be sampled at all, which is itself the finding
in §2.4.

**Engagement benchmarks worth holding onto** (`coverage-only`): Spectrum Boutique runs ~0.87%
engagement (avg 1,059 likes, 9 comments on 178K). Smitten Kitten's measured posts run 0.26% to 0.7%
(202 to 553 likes on 78K). Bellesa was reported at ~1.10%. So roughly **0.3% to 1.1% is the
category's normal band**, and a healthy small account in this space is not a high-engagement
account. xdipx's current rate is undefined because the denominator is zero.

Lovehoney is the strongest single data point because the causation is documented rather than
inferred. Its agency's own case study (`coverage-only`) names the prior state as "low engagement
and a stagnant follower base" caused by a "focus on sales and product promotion," and credits the
rebuild to "illustration graphics, lo-fi content, content creators, and reactive posts," reporting
370K+ follower growth since 2019. The largest retailer in the category grew by removing product
from its grid.

Three manufacturers who *must* sell hardware, Womanizer, Doc Johnson and Satisfyer, have all
independently concluded that the way to survive Instagram is to stop photographing the hardware.
Their volume post is a typographic meme card.

**Where xdipx actually sits.** All six published posts are product-forward: We-Vibe Chorus, Tantus
Duchess O2, Dame Arc, Nu Sensuelle, Pom, Ferri, and two three-toy group shots. Zero are the
product-free resource post. This is not a small drift from policy, it is the inverse of it:
`instagram-campaigns.md` §4a already caps product-forward at half a day's set and already requires
that **slot A, the resource post, ships every day including a one-post day**. That rule has never
once executed.

**Zero carousels have ever shipped either**, despite carousel publishing being implemented and unit
tested (`app/lib/social-publish/instagram.server.ts`, 2 to 10 slides), despite §3.3 specifying a
six-slide arc, and despite the owner asking on 2026-08-16 for "slides with sex advice or toy
advice."

---

## 2. Account safety: the part that can end the account

### 2.1 The Bellesa precedent

`@bellesaco`, a sexual-wellness retailer with roughly 700K followers and ten years of content, was
suspended on 2026-03-28. Meta's stated violation was "sexually explicit language in organic
content." The specific term the company says triggered it was **"clitoris."** The appeal was
reviewed and upheld. Corroborated across two independent outlets (`coverage-only`):
[Riverfront Times](https://www.riverfronttimes.com/metabannedbellesa/) and
[Xtra Magazine](https://xtramagazine.com/video/bellesa-instagram-ban-sexual-health-281447).

**Correction to that reporting, verified here.** `@bellesaco` resolves today as an existing but
age-gated profile ("Restricted profile. It's unavailable for certain audiences. Log in to
continue."), not as a deleted handle (`viewed-directly`, 2026-08-18). So the account came back
through a path the coverage does not record. The enforcement event is real and corroborated; the
permanence is not. Cite the ban, do not cite the deletion as final.

What survives either reading, and what matters: **the trigger was organic content, not an ad; the
trigger was a correct anatomical noun in retail context; and Meta's own educational carve-out was
not applied.**

Base rate, so this reads as the norm rather than the tail: the Center for Intimacy Justice 2025
report (n=159 across 180+ countries) found 63% of sexual-health groups had organic content removed
from Meta and 84% of businesses had ads rejected (`coverage-only`, percentages behind a DocSend and
not independently resolved).

### 2.2 The written policy line

Meta's [Community Standards, Adult Sexual Solicitation](https://transparency.meta.com/policies/community-standards/sexual-solicitation/)
(`viewed-directly`, page states last updated 2025-05-15) draws the line xdipx is judged on:

- **Prohibited, removal tier:** "Sexually explicit language that uses explicit or graphic detail
  about: Genitals, States of sexual arousal (e.g., wetness or erection), Sexual Encounters."
- **Restricted, 18+ age-gate tier:** "content discussing sexual practices or experiences";
  "sexually suggestive language referring to sexual encounters."

Discussing practice costs reach. Graphic detail about genitals costs the account.

The separate [Health & Wellness ad standard](https://transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/)
(`viewed-directly`) prohibits ads promoting "sexual arousal products that focus on sexual pleasure
or enhancement," naming sex toys, while permitting content where "the focus is on health and the
medical efficacy." **xdipx's catalog is categorically unadvertisable on Meta**, which matches
`docs/ads-policy.md` and should be treated as permanent, not as a thing to retry.

The "Meta loosened its sexual health policy" story is real but dates to October 2022 and covers
health-framed *ads*, not toys. It is not current cover.

### 2.3 Our exposure, measured

The deterministic publish gate (`app/lib/social-publish-gate.server.ts`) runs twelve checks:
`sale-price`, `sale-discount`, `sale-promo-code`, `sale-cta`, `sale-pdp-link`, `image-provenance`,
`caption-too-long`, `stock-unverifiable`, `stock-out`, `emoji-anatomy`, `lived-experience`,
`repetition`.

It blocks the peach and eggplant emoji. **It has no check at all on the vocabulary that got Bellesa
banned.**

Scanning all 56 rows in `social_posts` for removal-tier vocabulary: five rows carry it. Two are
Instagram rows (id8, id11) and both were rejected for unrelated reasons, so nothing has shipped.
Nothing systematic prevented it either.

And the collision is already on the calendar: the IG campaign scheduled for **2026-09-20, "The
Orgasm Gap, Closed," is scoped on `marketing_calendar` to "clitoral anatomy, foreplay."** That
campaign, as written, will generate exactly the content class that removed a 700K-follower account
in this category five months ago.

### 2.4 The age-gate pattern

Accounts split cleanly into publicly-rendering and age-gated. Age-gated accounts return "It's
unavailable for certain audiences. Log in to continue." and are invisible to every logged-out
visitor and to search.

**Age-gated (`viewed-directly`):** SheVibe, sextoy.com, Unbound, Bellesa, Emojibator, Tantus,
Screaming O, Fun Factory US, Sex With Emily, Spectrum Boutique, Babeland, Wild Flower, VUSH,
Peepshow Toys.
**Public (`viewed-directly`):** Lovehoney, Adam & Eve, Pure Romance, Too Timid, Dame, Maude, Foria,
Smile Makers, Cake, Kindra, Womanizer, We-Vibe, Satisfyer, Doc Johnson, Femme Funn, System JO,
XR Brands, Smitten Kitten, SHAG.

**Fourteen of thirty-three accounts, including most of xdipx's closest peer set, are invisible to
logged-out visitors and cannot be embedded anywhere.**

Two correlations, both hypotheses rather than proven rules, and they do not conflict:

- **Handle and bio.** The gated accounts tend to carry the category in the handle or bio; the
  public ones do not, or they glyph-substitute it. Womanizer runs 187K followers on a bio reading
  "The suction t\*y that changes everything." Lovehoney keeps plain English in the bio and pushes
  leetspeak down into disposable image text. Pure Romance spends its bio, the one string Meta
  indexes for profile search, on "#1 S3x T0y Brand" and is a quarter of Lovehoney's size.
- **Grid content.** Among the curated boutiques specifically, the two ungated accounts (Smitten
  Kitten, SHAG) are the two leading with education, community and humour rather than product and
  explicit language, while the five product-and-explicit-forward boutiques are all gated. Small n,
  no causal evidence, worth testing.

Both point the same way, and both favour the direction §1 already argues for.

**Deletion is a live risk in this set, not a historical one.** Wild Flower's account was locked and
deleted without warning on 2019-01-10 at 67K followers, with Instagram giving no reason, and was
reinstated within 48 hours only after industry and follower pressure (`coverage-only`). Founder Amy
Boyajian: "One of the first rules of business is to be where your customers are, and our customers
are (unfortunately) on Instagram." The pattern across Wild Flower and Bellesa is the same: no
warning, no stated reason, and reinstatement, when it comes, comes from public pressure rather than
from the appeal process.

**@hello_xdipx renders no content to a logged-out fetch and returns zero search-index presence**
(`viewed-directly`, 2026-08-18). No explicit restriction banner was returned either, so this is
unresolved between "brand-new thin account" and "age-gated." It is a thirty-second check from a
logged-out phone browser and it is on the owner blocker list.

Note for defensive registration: `@xdipx` is already taken by an unrelated personal account
(`viewed-directly`).

---

## 3. Formats worth stealing, with the account that proves each

### 3.1 The product-free advice carousel

The category's saves engine, and the exact thing the owner asked for. Grounded parameters
(`coverage-only`, carousel-mechanics sources, not reverse-engineered from a specific competitor,
because post-level fetches were blocked): 8 to 10 slides, at most ~20 words and 60pt+ type per
slide, one idea per slide, consistent layout, slide 1 works as a magazine cover and decides the
stop. Saves are among the strongest 2026 ranking signals, which is why advice carousels outperform.

**xdipx template, eight slides, built on the existing doctrine grounds:**

1. **Cover.** One reader question in the reader's own words. Newsreader display, 60pt+, on flat
   `coral-soft` or `plum-soft`. No product, no logo, no face. Under 12 words.
2. **The reframe.** One sentence naming the worry underneath the question. `paper` ground.
3 to 6. **Four numbered beats.** One sentence each, mono numeral top-left per the `.kicker` class,
   DM Sans beneath. Alternate `paper` and `paper-2` so the swipe has rhythm.
7. **The honest caveat.** What this does not fix, or when to see a clinician. The credibility slide.
8. **Sign-off.** Emma aside plus one whitelist CTA.

Caption restates the cover question in line one so it survives two-line truncation, then three or
four short lines, then a save prompt. No face: Emma is an AI guide with no lived experience.

This needs no new capability. `instagram-campaigns.md` §3.3 already specifies a six-slide arc and
§3 line 253 already licenses "typography over a flat campaign plate," with the standing rule that
**every word is rendered typography over a clean plate and a generated word is a defect**. The
competitor evidence says that policy is right and the pipeline simply is not exercising it.

### 3.2 The named, dated, non-product recurring series

**Dame proves it** with *Damescopes*, a monthly horoscope carousel bylined to an outside astrologer
and given two of its ten permanent story-highlight slots. It fills the calendar with on-brand
content that needs no new SKU and no new photography. Dame also runs *No Bad Sex*, a Substack
promoted on-grid as its own carousel and pinned as a highlight.

**Foria proves the hook shape** with Reel and carousel covers that are one large all-caps headline
and no product: "WHY STRESS KILLS YOUR LIBIDO", "THE ULTIMATE POST-SHOWER RITUAL", "5 MISTAKES
PEOPLE MAKE WHEN INITIATING", "BIG O'S YOU'VE NEVER HEARD OF". Mistake-framed and numbered-list
framed, saves-bait by construction, at roughly 60% educational mix.

### 3.3 Highlights as the merchandising shelf while the grid stays non-product

**We-Vibe proves it** with one highlight per SKU (`Pivot2`, `Verge2`, `ChorusPro`) plus a
`How-To 💜` rail. **Femme Funn** runs `Reviews / Tips / Toys / Lube / Femme Fans`. **Doc Johnson**
runs `SHOP / Press / AMA`. **Adam & Eve** goes furthest and quarantines `SALE!` into a highlight so
it never touches the grid.

The grid absorbs the reach risk; the highlight rail does the catalog work and never expires. For a
multi-vendor retailer this is stronger than for a manufacturer, because xdipx can build highlights
by **category across vendors** rather than by SKU.

### 3.4 A named authority in the bio, licensing the education

**Adam & Eve proves it**: a full quarter of its bio is "Dr. Jenni Skyler, resident therapist," and
that is what lets half its grid read as health education rather than ad copy. xdipx's honest
equivalent is not a fabricated credential. It is naming the **sourcing standard**: Emma is an AI
guide who reads specs and cites sources, and the Notebook's accuracy gate
(`sex-wellness-reviewer`) is a real, describable process.

### 3.5 Commerce entirely displaced to link-in-bio

Every publicly-rendering account does this. Not one carried a price, percentage, or promo code in
any observed organic surface. This validates the existing `docs/ads-policy.md` §Organic social rule
and the deterministic `sale-*` gate checks; no change needed, and it is worth recording that the
category unanimously agrees with a rule xdipx sometimes experiences as a constraint.

### 3.6 The customer-question series on a fixed repeatable set

**Smitten Kitten proves it** with `#Skcustomerprobs`: a staffer answers a real customer question on
camera, shot **under the same neon sign every single time**. The fixed frame is the continuity
device, and it costs nothing to hold.

This is the closest thing in the whole study to a format xdipx can run honestly. The question shape
lets Emma speak with authority about *the reader's* experience rather than her own, which is exactly
the shape her charter constraint requires. A fixed set gives visual continuity with no face at all,
which maps onto the existing `cropSignature` and `lightSignature` locks in §3 of
`instagram-campaigns.md`. **SHAG** runs the text version, opening captions by quoting the customer:
"People often ask what some of our best sellers in the shop are."

### 3.7 The spec-checklist caption

**SHAG proves it.** Their überlube post opens on the customer question, then runs six ✅ lines of
material, compatibility and safety fact (silicone formula needs no preservatives; long-lasting;
body- and condom-friendly; dissipates with no sticky residue; recommended by leading doctors; scent-
and colour-free), then hashtags.

This converts catalog knowledge into authority **without Emma ever claiming she tried anything**. It
is the single most charter-compatible caption structure found in the study, and xdipx already holds
the underlying data in its enrichment metafields.

### 3.8 The `VISUAL DESCRIPTION:` caption block

**Smitten Kitten proves it**, writing accessibility descriptions into the caption body rather than
hiding them in alt-text: "VISUAL DESCRIPTION: white non binary person with blue/green/white hair, a
black hat, talking to the camera influencer style underneath the smitten kitten neon sign."

Three wins at once: it is real accessibility work, it is additional crawlable on-charter text, and
it is the one caption element an AI guide writes better and more consistently at four posts a day
than a human staffer does.

### 3.9 The tension worth naming: polish is not what travelled

Smitten Kitten's biggest moment was a **one-take, unedited video** correcting a false Google result
about their shop. 3.4M views inside three weeks, 5,000+ new followers, and they turned it into a
running series that "all did exceptionally well." Their own retro, verbatim: "This confirmed our
theory that you shouldn't think too hard when promoting yourself other than just being yourself.
Because who knows when your moment will show up on your doorstep? Just post that sh\*t and run."
Their social lead on why: "with everything going on politically and economically, people are in a
very tense place... those unhinged little moments on the internet really take off, even more so as
things get worse."

xdipx's pipeline is the opposite: a locked visual scheme decided before post 1, a cast-composite
generation path, an art-direction ceiling, a design gate, a voice gate, and a publish gate. That
machinery is correct for a **brand asset** and it is why the grid will look like one publication
rather than fourteen strangers. It is also, structurally, incapable of producing the thing that
actually moved the needle for the closest comparable shop in this study.

State it plainly rather than resolving it here: the reactive, unpolished, same-day post is a real
lane with real evidence behind it, and xdipx currently has no path to one. Note also that the
outlier was an outlier: Smitten Kitten's baseline engagement is 0.26% to 0.7%, *below* Spectrum's
0.87%. Do not plan on virality. Do notice that the door is closed.

---

## 4. What to refuse

1. **The explicitness register that age-gates the account.** Unbound, Bellesa, Emojibator, SheVibe
   and sextoy.com are all invisible to logged-out shoppers. At xdipx's size that register costs the
   entire discovery funnel.
2. **Burning the store URL into the creative.** Too Timid burned `www.TooTimid.com` into its
   2026-08-03 image and is the smallest account in the retail slice at 6.8K with roughly five posts
   in all of 2026.
3. **Leetspeak in the bio.** Pure Romance spends its highest-value indexed string on "#1 S3x T0y
   Brand" and it has not bought a larger account than Lovehoney's plain English. Note also that
   Instagram's 2026 teen-account expansion extends search blocking to **misspelled variants**, so
   euphemism does not reliably buy back discoverability, it only makes the copy worse.
4. **Maude's caption-less grid**, where baked type carries the whole message. Coverage indicates
   Maude's editorial platform "wasn't contributing enough towards measurable customer acquisition."
   A sub-1K account copying that silence forfeits its only searchable, voice-bearing surface.
5. **The founder-as-face model.** Spectrum Boutique's founder posts as `@thongria` with 280K+
   followers, *more than the 178K store account*. That audience is loyal to a real named person.
   xdipx has none, so every imitation of it becomes a fabricated human, which the charter forbids
   and which is also the one tier the design doctrine already says AI cannot honestly replicate.
6. **Influencer-and-celebrity-seeded growth.** VUSH reached 747K this way (a Cardi B video
   integration, and creator seeding from 10K to ~1M followers that press describes as deliberately
   brand-unaligned). It buys reach a $26-AOV store cannot amortise, and it moves the voice onto
   creators who are not bound by the charter.

---

## 5. Where this contradicts a standing document

**Maker relations is not the cheap reach lane the strategy says it is.**

`social-crossplatform-strategy.md` §4 opens: "a manufacturer reshare or influencer quote is the
single cheapest reach event available to this store," and `routine-social-daily.md` makes Featured
Brand of the Week a standing weekly cadence whose stated point is "reciprocal notice from the
brand's social team."

The evidence is a clean sweep against it. Across five directly-viewed manufacturer grids: **zero
retailer tags, zero "available at" posts, zero retailer reposts, zero "shop our partners"
surfaces.** And the registry itself cannot deliver reach:

- Tantus, Screaming O, Fun Factory US: **age-gated**, so a tag returns no logged-out discovery at
  all.
- System JO (5.7K) and XR Brands (3.7K): public but negligible.
- Femme Funn: actively D2C-competitive, its bio sells free two-day shipping against its own retail
  channel. Tagging them promotes a competitor.
- Womanizer and We-Vibe (both Lovehoney Group): pure brand-culture grids with no commerce surface a
  retailer could enter.

Honest limit: comment threads, tagged-post tabs and story reposts are all login-walled, and those
are exactly where reciprocity would show if it exists. LELO (289K, "beyond shame" positioning) is
entirely unassessed and is the most plausible partner in the set.

**Recommended correction:** demote maker-tagging from a weekly cadence duty to a zero-cost habit.
Tag verified makers because it costs nothing and occasionally converts; do not build a routine, a
slot, or a KPI around expecting reciprocal reach. Redirect the effort into two outreach items that
are business development rather than social:

- **Satisfyer's store finder.** Satisfyer's only bio link is a store finder, not a PDP. It is the
  one brand in the set structurally pointing social traffic at third-party retail. Getting xdipx
  listed is an email, and it would deliver more than any tag.
- **Doc Johnson's channel relationship.** "Five Decades of Pleasure - Powered by Partnership," a
  `SHOP` and a `Press` highlight, and the highest following ratio in the set. Weak evidence of an
  outbound habit, worth one pitch.

Both belong in `offsite-scout`'s brand-partner outreach lane, not in the social routine.

---

## 6. Handle traps

Five of ten guessed manufacturer handles resolved to the wrong entity. Treat every unverified
handle as wrong until a fetch proves otherwise, and keep
`docs/store-team/brand-ig-handles.json` the only citable source.

| Guess | Actually |
|---|---|
| `@lovehoney` | parked decoy, 0 followers, private. Real: `@lovehoneyofficial` |
| `@adamandeve` | not theirs. Real: `@therealadamandeve` |
| `@pureromance` | an individual consultant. Real: `@officialpureromance` |
| `@satisfyer` | a private individual, "Lee Wakely". Real: `@satisfyercom` |
| `@lelo` | meme account. `@officiallelo` is a musician |
| `@fun.factory.official` | a German dance band |
| `@bvibe` | unrelated 10-follower account |
| `@normal.co` | dormant 4-follower account, unrelated |
| `@thevaginawhisperer` | real handle is `@the.vagina.whisperer` |
| `@dr.tarasuwinyattichaiporn` | does not resolve. Real: `@luvbites.co` |
| `@spectrumboutique` | a Palm Springs clothing store. Real: `@shopspectrumboutique` |
| `@babeland` | a personal account, "Mariah". Real: `@babeland_toys` |
| `@honeyplaybox` | 11 followers. Real: `@honeyplaybox_official` |
| `@shagbrooklyn` | not theirs. Real: `@weloveshag` |
| `@earlytobedchicago` | not theirs. Real: `@early2bed.shop` |
| `@vush.official` | real handle is `@vush_official` |

Fourteen of roughly twenty-four guessed handles across the whole study resolved to the wrong
entity. Guessing is not a viable method here.

Defensive registration is a live practice in this category: Shan Boodram parked `@shanboody`
alongside her real `@shanboodram` with the bio "I didn't want anyone stealing my alias."

---

## 7. Where to take the account

The owner's question, answered directly. In priority order, because the order is the argument.

1. **Turn the instrument on.** Call the engagement op every run and read it in the retro. Without it
   every decision below is a guess, and the loop has been guessing since 2026-08-08.
2. **Fix the account-safety hole before the reach problem.** The Sep 20 campaign is scoped to
   content that removed a 700K-follower account in this category. Reach of 27 is a bad week;
   losing the handle is the end of the channel.
3. **Ship slot A.** The resource post, product-free, every day, as
   `instagram-campaigns.md` §4a already requires. This is the single change with the most evidence
   behind it in the whole study, it is already policy, and it has never once executed.
4. **Ship carousels.** The publisher supports 2 to 10 slides and is unit tested. The arc is
   specified. The typography-over-clean-plate rule already licenses the format. Nothing is missing
   but execution.
5. **Build the highlight shelf.** Category highlights across vendors, so the grid can go non-product
   without the catalog disappearing. Cheap, permanent, and it never expires.
6. **Adopt the three caption conventions**: the customer question as the opener, the spec checklist
   as the body, the `VISUAL DESCRIPTION:` block as the close.
7. **Stop expecting reach from maker tags**, and move that effort to the Satisfyer store-finder
   listing and the Doc Johnson channel email.

And one thing to hold in view rather than act on: **Instagram is a low-ceiling brand and trust
surface for xdipx, not an acquisition channel.** The catalog is categorically unadvertisable on
Meta, the teen-account expansion restricts recommendation of exactly this content class and extends
search blocking to misspellings, a third of the peer set is invisible to logged-out visitors, and
the category's normal engagement band is 0.3% to 1.1%. Every post should route to something xdipx
owns, because the surface is rented and revocable, and Bellesa and Wild Flower both prove the
revocation comes without warning.

---

## 8. Method limits, stated plainly

- Post-level caption fetches (`/p/<shortcode>/embed/captioned/`) worked for exactly two accounts,
  Smitten Kitten and SHAG, and failed everywhere else. Use the bare embed form; account-prefixed
  embed URLs 404 universally. Elsewhere, per-post detail here is image alt-text or baked-in image
  text.
- Like, comment and view counts are not exposed on logged-out grids, so "what worked" is structural
  inference rather than measurement for all but those two accounts.
- `/reels/` sub-pages rendered nothing for any account. Stories, comment threads, tagged-post tabs
  and story reposts are all login-walled, which is exactly where maker reciprocity would show if it
  exists (see §5).
- Fourteen accounts were age-gated and returned no data. They are recorded as `unavailable` and
  never estimated, so no posting-mix percentage appears for any of them.
- Third-party mirrors (picuki, starngage, yooying, imginn) all returned 403. Search-engine snippets
  of Instagram's `og:description` still carry follower counts and bio text, and are the source for
  most `coverage-only` rows.
- Follower counts are single-point reads on 2026-08-17/18 and will drift.
- Closing the posting-mix gap for the age-gated peer set requires an authenticated session or a paid
  social-listening tool. Neither exists today and neither is proposed here.

Re-run cadence: quarterly, or when an account in the set is removed or visibly pivots. The
`social-trend-scout` routine's competitor lane is coverage-only by design and does not replace an
account-level teardown.
