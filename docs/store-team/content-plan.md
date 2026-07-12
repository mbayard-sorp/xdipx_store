# Notebook Content Plan

> Binding operating plan for the `content-writer` agent (daily Notebook post). Loads after the gate, alongside `docs/store-team/mission-brief.md` and `docs/emma-voice.md`. The voice charter outranks this file for any customer-facing words. Advisory sibling to the homepage `merch-calendar`; the marketing calendar is the shared clock.

## 1. Mission and AEO role

The store's technical LLM surface is already strong: 4,111 product `.md` twins, `llms.txt`, and full JSON-LD. The gap is the answer layer. One Notebook post, no guides, no comparisons. LLM answer engines (ChatGPT, Perplexity, Claude) cite buying-guide and comparison content far more than product pages, and Google AI Overviews largely suppress adult queries, so those three chat engines are the battleground. Every daily post is one more answer-shaped page an engine can lift a sentence from with a citation back to xdipx. Volume plus structure is the whole strategy: answer the question the way a person asks it, embed an honest in-stock product, link into a collection, and let the JSON-LD do the rest.

Cadence ties to the weekly theme calendar so the whole store tells one story. When `merch-calendar` sets a theme week (the current one is Air-Pulse 101), the Monday guide slot targets that family's top question, the homepage features it, and the Notebook builds the durable citable page underneath it. Themes are editorial curricula, not sales events (charter: "teaches first, the offer rides along"). The post earns citations for weeks after the theme moves on; that compounding library is the point.

## 2. Weekly slot themes

One post per day, seven per week. Guides remain the anchor format (they carry the ItemList JSON-LD and win the highest-intent queries); the owner added two editorial formats in 2026-07 — the weekly podcast review and the twice-weekly Real Talk problem→resolution narrative (see §7).

| Day | Category | Slot intent |
|---|---|---|
| Mon | guides | Anchor guide. Syncs to the marketing-calendar theme week (see rule below). |
| Tue | real-talk | Problem → root cause → resolution narrative (§7B). |
| Wed | guides | Category explainer matching one of the 24 collections. |
| Thu | podcast-notes | Weekly podcast review from the pending `podcastReviewBrief` (§7A). No brief pending → fall back to a care post. |
| Fri | real-talk | Second problem → resolution narrative (§7B). |
| Sat | care | Cleaning, storage, material safety, sharing. |
| Sun | comparisons | Head-to-head; alternate with wellness-basics when the comparisons queue is thin, or overflow guide if the theme needs two. |

Weekly mix: 2 guides, 2 real-talk, 1 podcast-notes, 1 care, 1 comparisons/wellness-basics. When a flex slot opens (no pending podcast brief, thin queues), it reverts to a guide — guides stay the priority format.

**Theme-sync rule.** At Monday run start, read `marketing_calendar` for the active theme. The Monday guides slot must target that theme's product family and its top LLM question. During Air-Pulse 101 week, the Monday guide answers an air-pulsation query (for example "how does a clitoral suction toy work"). If the Sunday flex slot is needed, use it for a second angle on the same theme. Off-theme weeks default to the backlog order below.

## 3. 30-day topic backlog

**Selection order (since the keyword-bank wiring):** the daily writer picks from the Sanity
`seoContentBrief` queue first (planned weekly by the seo-curator routine from approved keyword
clusters); this backlog is the fallback floor when the queue has nothing queued, and the slot
themes in §2 plus the standing rules in §6 remain binding either way.

Slugs and titles are answer-shaped to match how people phrase questions to an LLM. Collection handles are representative of the 24 live collections and must be validated against the live list before linking. No prices in any body copy.

| # | Slug | Working title | Category | Target query | Embed (handles / types) | Internal links |
|---|---|---|---|---|---|---|
| 1 | how-to-choose-your-first-sex-toy | How Do You Choose Your First Sex Toy? | guides | "what sex toy should I buy first" | beginner bullet, small air-pulse, glass | /collections/vibrators, /collections/air-pulse-suction |
| 2 | how-does-a-clitoral-suction-toy-work | How Does a Clitoral Suction Toy Work? | guides | "how do air pulse toys work" | 2-3 air-pulse | /collections/air-pulse-suction |
| 3 | air-pulse-vs-clitoral-vibrator | Air Pulse vs Clitoral Vibrator: Which Is Right for You? | comparisons | "air pulse vs vibrator" | 1 air-pulse, 1 finger-clit | /collections/air-pulse-suction, /collections/vibrators |
| 4 | how-do-you-use-a-wand-massager | How Do You Use a Wand Massager? | guides | "how to use a wand vibrator" | 2 wands | /collections/wands |
| 5 | how-do-you-clean-a-sex-toy | How Do You Clean a Sex Toy? | care | "how to clean a sex toy" | toy cleaner, 1 silicone toy | /collections/lubricants, /collections/wands |
| 6 | what-does-a-couples-vibrator-do | What Does a Couples Vibrator Do? | guides | "best vibrator to use with a partner" | wearable, remote | /collections/couples, /collections/remote |
| 7 | is-silicone-body-safe | Is Silicone Body-Safe? What to Look For | wellness-basics | "is silicone body safe" | 2 medical-grade silicone | /collections/vibrators, /collections/dildos |
| 8 | wand-vs-bullet-vibrator | Wand vs Bullet Vibrator: How to Pick | comparisons | "wand or bullet vibrator" | 1 wand, 1 bullet | /collections/wands, /collections/bullets-eggs |
| 9 | what-is-a-rabbit-vibrator | What Is a Rabbit Vibrator, and Who Is It For? | guides | "what does a rabbit vibrator do" | 2 rabbits | /collections/rabbits |
| 10 | how-do-you-store-sex-toys-discreetly | How Do You Store Sex Toys Discreetly? | care | "how to store sex toys" | storage pouch, cleaner | /collections/lubricants |
| 11 | how-do-you-start-prostate-play | How Do You Start Prostate Play Safely? | guides | "how to use a prostate massager" | 2 prostate, lube | /collections/prostate-toys, /collections/lubricants |
| 12 | silicone-vs-water-based-lube | Silicone vs Water-Based Lube: Which Should You Use? | comparisons | "silicone or water based lube" | 1 water, 1 silicone | /collections/lubricants |
| 13 | which-lube-should-i-use | Which Lube Should You Use, and When? | guides | "which lube is best" | water, silicone, hybrid | /collections/lubricants |
| 14 | do-kegel-exercisers-work | Do Kegel Exercisers Actually Work? | wellness-basics | "do kegel balls work" | 1 kegel set | /collections/wellness |
| 15 | how-do-you-choose-a-g-spot-vibrator | How Do You Choose a G-Spot Vibrator? | guides | "best toy for g-spot" | 2 g-spot | /collections/vibrators |
| 16 | butt-plug-vs-anal-beads | Butt Plug vs Anal Beads: What's the Difference? | comparisons | "butt plug vs anal beads" | 1 plug, 1 beads | /collections/anal |
| 17 | how-do-you-start-anal-play | How Do You Start Anal Play as a Beginner? | guides | "how to start anal play safely" | small plug, anal lube | /collections/anal, /collections/lubricants |
| 18 | can-you-share-sex-toys-safely | Can You Share Sex Toys Safely? | care | "is it safe to share sex toys" | condoms, cleaner | /collections/condoms, /collections/lubricants |
| 19 | what-does-a-cock-ring-do | What Does a Cock Ring Do? | guides | "how does a cock ring work" | 2 cock-rings | /collections/cock-rings |
| 20 | glass-vs-silicone-toys | Glass vs Silicone Toys: How Do They Compare? | comparisons | "glass or silicone dildo" | 1 glass, 1 silicone | /collections/dildos |
| 21 | what-is-a-bullet-vibrator-good-for | What Is a Bullet Vibrator Good For? | guides | "what is a bullet vibrator" | 2 bullets | /collections/bullets-eggs |
| 22 | how-do-app-controlled-vibrators-work | How Do App-Controlled Vibrators Work? | guides | "how do remote app vibrators work" | 2 remote | /collections/remote |
| 23 | how-do-you-care-for-silicone-toys | How Do You Care for Silicone Toys? | care | "silicone toy care and lube compatibility" | 1 silicone toy, water lube | /collections/lubricants, /collections/vibrators |
| 24 | how-do-you-choose-a-stroker | How Do You Choose a Stroker? | guides | "what is a male masturbator" | 2 strokers | /collections/strokers |
| 25 | remote-vs-app-controlled-toys | Remote vs App-Controlled: Which Long-Distance Toy? | comparisons | "remote or app controlled toy" | 1 remote, 1 app | /collections/remote, /collections/couples |
| 26 | what-is-a-body-safe-material | Which Sex Toy Materials Are Body-Safe? | wellness-basics | "safe sex toy materials" | silicone, glass, steel | /collections/dildos, /collections/vibrators |
| 27 | how-do-you-shop-for-couples-long-distance | How Do Long-Distance Couples Shop for Toys? | guides | "best long distance toy for couples" | 2 remote/app | /collections/remote, /collections/couples |
| 28 | how-do-you-start-with-restraints | How Do You Start With Restraints and Bondage? | guides | "how to start bondage safely" | soft restraint, blindfold | /collections/restraints |
| 29 | rabbit-vs-dual-stimulation-vibrator | Rabbit vs Dual-Stimulation: What's the Difference? | comparisons | "rabbit vs dual stimulation vibrator" | 1 rabbit, 1 dual | /collections/rabbits, /collections/vibrators |
| 30 | what-is-a-good-first-toy-gift | What Makes a Good First Sex Toy Gift? | guides | "sex toy gift ideas for a partner" | bullet, air-pulse, lube | /collections/vibrators, /collections/lubricants |

Backlog composition: 16 guides, 8 comparisons, 4 care, 2 wellness-basics. Reorder freely to serve the theme week; keep the guide majority intact.

## 4. Authority-building priorities

Build topical clusters (guide + comparison + care all linking to the same collection) around these first. Depth on a few collections earns category-query citations faster than one post each across 24.

1. **Air Pulse and Suction** (`air-pulse-suction`). Highest branded-generic query volume in the category ("clitoral suction toy"), the current theme week, and a mechanism that is genuinely explainable in Emma's voice. First cluster to own.
2. **Wands** (`wands`). Evergreen, broad appeal, gateway product, high "how to use a wand" volume. Strong internal-link hub to bullets and air-pulse.
3. **Lubricants** (`lubricants`). Every customer needs it, comparison-rich (silicone vs water, warming, anal), and it overlaps care and every other cluster as an attach embed. Low unit margin but high velocity and cross-link value.
4. **Rabbits / Dual Action** (`rabbits`). Iconic, high "best rabbit vibrator" intent, clear comparison framing against single-stimulation toys.
5. **Prostate Toys** (`prostate-toys`). Underserved by competitors, so the citation gap is winnable, and for-him depth is thin across the market. High-intent, beginner-anxious queries that reward honest, plain guidance.
6. **Couples and Wearable / Remote** (`couples`, `remote`). Differentiator with higher AOV, and the long-distance / app-controlled query trend is rising and under-answered.

Below 300 sessions/week the retro leans on margin math, stock depth, and these heuristics rather than GA4 weighting, and the brief should say so.

## 5. KPIs for the weekly retro

- **Publish reliability.** Posts published vs planned (target 7/7). Missed days get a reason, not a silent zero.
- **Voice-gate pass rate.** Share of posts passing `emma-empathy-reviewer` on first submit. A falling rate is a prompt problem; file an `instructions` suggestion, do not hand-fix.
- **Indexed page count.** Notebook URLs and their `.md` twins in the sitemap and `llms.txt`, week over week.
- **LLM-citation spot checks.** A fixed 20-query tracker run in ChatGPT, Perplexity, and Claude (for example "how does a clitoral suction toy work", "silicone vs water based lube"). Log whether xdipx is cited and which page.
- **GA4 referrals.** Sessions and any assisted conversions from `chatgpt.com`, `perplexity.ai`, and `claude.ai` referrers. Weighted only at or above 300 sessions/week; below that, report raw counts and treat as directional.

## 6. Standing rules

- **Category maps to JSON-LD.** `guides` posts get ItemList JSON-LD from their product embeds automatically, so any ranked buying guide uses `blogCategory: guides`. Do not put a ranked list in `comparisons`, `care`, or `wellness-basics`.
- **FAQ section is mandatory** on every post. Use answer-shaped question H2s throughout, not statement headings.
- **In-stock embeds only.** At least one honest, currently in-stock product per post. Never embed an out-of-stock or draft product.
- **Honest Emma.** AI guide with no lived experience per `docs/emma-voice.md`. Speak from specs, materials, and review patterns. Never "I tried / tested / own it".
- **No medical claims.** Body-safety and material facts only. No treatment, diagnosis, or health-outcome promises. Name materials plainly (medical-grade silicone, glass, stainless steel).
- **No prices in body text.** Pricing lives on the PDP and in the embed component, never in prose. No discount framing that would trip MAP rules.
- **Internal links every post.** At least one collection link and one PDP, using canonical `/products/{slug}` and `/collections/{handle}`.
- **No em-dashes, no countdowns, no urgency, CTAs from the whitelist only.** Billing descriptor is always XDIPX.

## 7. Editorial formats (owner-added 2026-07)

Both formats live in new `blogCategory` documents (`blogCategory-podcast-notes` "Podcast Notes",
`blogCategory-real-talk` "Real Talk") — content documents, not schema changes. Seed them once
before the first post of each type. All §6 standing rules apply unchanged; the notes below are
additive.

### 7A. Podcast Notes (weekly, Thursday)

The post is written from the week's pending `podcastReviewBrief` (produced Wednesday by the
`podcast-reviewer` routine, `docs/store-team/routine-podcast-weekly.md`). Shape:

1. **What the episode is** — show, hosts (credentials as stated), episode link, one-paragraph setup.
2. **What they got right** — the takeaways Emma affirms, in her own words, quoting sparingly.
3. **Where Emma adds nuance** — the agree/pushback angles from the brief; attributed claims,
   plain-spoken counterpoints, no medical overreach.
4. **Products that fit this conversation** — `blogProductEmbed` blocks drawn from the brief's
   `productAngles`, only where the episode's themes genuinely lead there, in-stock verified.
5. FAQ section as always.

Rules: review-and-commentary framing (link the episode, quote sparingly, never imply the show
endorses xdipx); if the brief says `sourceQuality:'show-notes'`, the post says it reviewed the
episode's published notes; mark the brief `drafted` on claim and `published` + `blogPostRef` when
live. No pending brief on Thursday → the slot falls back to care and the retro notes it.

### 7B. Real Talk (twice weekly, Tuesday + Friday)

A problem → root cause → resolution narrative that ends, where honest, at products that actually
help. Structure is plain H2 prose — no custom Sanity block; heading-structured answers are what
LLM engines lift, and a custom block would add renderer work for nothing:

1. **H2: The problem** — stated in the reader's words, empathetic and specific. "What people tell
   us / what shows up in questions", never first-person anecdote (Emma has no lived experience —
   the rule is extra load-bearing in this format).
2. **H2: What's actually going on** — the root cause explained plainly. No diagnosis language, no
   medical overreach; include a "worth seeing a clinician if…" line whenever the topic borders on
   health.
3. **H2: What helps** — 2-3 concrete approaches (habits, communication, technique), each
   optionally paired with ONE honest, in-stock `blogProductEmbed` that genuinely serves that
   approach. **Products appear only in this resolution section, never in the problem framing** —
   that is the anti-sleaze rule.
4. FAQ section as always.

Starter topics (pick, reorder, and extend freely):

| Slug | Problem |
|---|---|
| what-to-do-when-desire-levels-dont-match | Mismatched libido logistics in a long-term relationship |
| why-first-toy-shopping-feels-overwhelming | First-toy overwhelm: too many options, no vocabulary |
| what-helps-with-dryness-during-sex | Dryness and discomfort, and when lube is the whole answer |
| why-does-my-toy-smell-and-how-do-i-fix-it | Toy-care anxiety: smells, residue, material worries |
| reconnecting-after-a-baby | Post-partum reconnection, patience, and pressure |
| what-if-a-toy-is-too-intense | Overstimulation: settings, buffers, and gentler picks |
| how-do-couples-talk-about-trying-toys | Raising the topic with a partner without it landing wrong |
| what-size-should-you-actually-start-with | Sizing confusion and the case for starting small |
| when-vibration-feels-like-too-much-noise | Discretion worries: noise, storage, shared walls |
| why-cant-i-finish-with-a-partner | Orgasm gap frustrations, pressure, and pacing |
