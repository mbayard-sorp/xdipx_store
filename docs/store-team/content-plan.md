# Notebook Content Plan

> Binding operating plan for the `content-writer` agent (daily Notebook post). Loads after the gate, alongside `docs/store-team/mission-brief.md` and `docs/emma-voice.md`. The voice charter outranks this file for any customer-facing words. Advisory sibling to the homepage `merch-calendar`; the marketing calendar is the shared clock.

## 1. Mission and AEO role

The store's technical LLM surface is already strong: 4,111 product `.md` twins, `llms.txt`, and full JSON-LD. The gap is the answer layer. One Notebook post, no guides, no comparisons. LLM answer engines (ChatGPT, Perplexity, Claude) cite buying-guide and comparison content far more than product pages, and Google AI Overviews largely suppress adult queries, so those three chat engines are the battleground. Every daily post is one more answer-shaped page an engine can lift a sentence from with a citation back to xdipx. Volume plus structure is the whole strategy: answer the question the way a person asks it, embed an honest in-stock product, link into a collection, and let the JSON-LD do the rest.

Cadence ties to the weekly theme calendar so the whole store tells one story. When `merch-calendar` sets a theme week (the current one is Air-Pulse 101), the Monday guide slot targets that family's top question, the homepage features it, and the Notebook builds the durable citable page underneath it. Themes are editorial curricula, not sales events (charter: "teaches first, the offer rides along"). The post earns citations for weeks after the theme moves on; that compounding library is the point.

## 2. Weekly slot themes

One post per day, seven per week. Guides remain the anchor format (they carry the ItemList JSON-LD and win the highest-intent queries); the owner added two editorial formats in 2026-07 — the weekly podcast review and the twice-weekly Real Talk problem→resolution narrative (see §8).

| Day | Category | Slot intent |
|---|---|---|
| Mon | guides | Anchor guide. Syncs to the marketing-calendar theme week (see rule below). |
| Tue | real-talk | Problem → root cause → resolution narrative (§8B). |
| Wed | guides | Category explainer matching one of the 24 collections. |
| Thu | podcast-notes | Weekly podcast review from the pending `podcastReviewBrief` (§8A). No brief pending → fall back to a care post. |
| Fri | real-talk | Second problem → resolution narrative (§8B). |
| Sat | care | Cleaning, storage, material safety, sharing. |
| Sun | comparisons | Head-to-head; alternate with wellness-basics when the comparisons queue is thin, or overflow guide if the theme needs two. |

Weekly mix: 2 guides, 2 real-talk, 1 podcast-notes, 1 care, 1 comparisons/wellness-basics. When a flex slot opens (no pending podcast brief, thin queues), it reverts to a guide — guides stay the priority format.

**Theme-sync rule.** At Monday run start, read `marketing_calendar` for the active theme. The Monday guides slot must target that theme's product family and its top LLM question. During Air-Pulse 101 week, the Monday guide answers an air-pulsation query (for example "how does a clitoral suction toy work"). If the Sunday flex slot is needed, use it for a second angle on the same theme. Off-theme weeks default to the backlog order below.

## 3. 30-day topic backlog

**Selection order (since the keyword-bank wiring):** the daily writer picks from the Sanity
`seoContentBrief` queue first (planned weekly by the seo-curator routine from approved keyword
clusters); this backlog is the fallback floor when the queue has nothing queued, and the slot
themes in §2 plus the standing rules in §7 remain binding either way. Sunday planning also
considers the Saturday trend-scout's pending `trendTopicBrief` proposals (adopt/skip/expire rules
in `docs/store-team/routine-seo-curation.md` Step 4b), so live community discourse can shape the
queue without bypassing it.

Slugs and titles are answer-shaped to match how people phrase questions to an LLM. Collection handles are representative of the 24 live collections and must be validated against the live list before linking. No prices in any body copy.

**Standing rule (added 2026-08-03).** Validate every section-3 collection handle against the live collection list before linking; `couples` and `vibrators` are verified 200. `/collections/remote` (referenced in rows 6, 22, 25, and 27) returned 404 as of 2026-07-17; verify the handle before linking rather than assuming it still resolves.

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

## 4. Series and franchises

The Notebook groups posts into named editorial series (Sanity `blogSeries` docs, surfaced as
"Part N of M" kickers, series rails, and `/notebook/series/{slug}` landings). Series are a
franchising layer over the backlog, not a new content type: the daily post is written exactly as
before, and series membership is an optional `blogPostExtras` doc attached afterward. Franchise
concepts, names, and cover art direction live in `docs/notebook-team/notebook-art-direction.md`
(section 8) and `docs/notebook-team/image-brief.md`; this section only governs how the writer
relates to them.

Launch franchises and their category mapping:

| Series | Slug | Categories it draws from |
|---|---|---|
| First Times | `first-times` | guides (beginner "how do you start / choose your first" cluster) |
| How It Works | `how-it-works` | guides (mechanism explainers, the highest-value LLM-citation shape) |
| Field Notes | `field-notes` | care + wellness-basics |
| Real Talk | `real-talk` | real-talk (the §8B problem and resolution narratives) |
| This or That | `this-or-that` | comparisons (reserved; not seeded at launch) |

Rules:

- **Attachment is optional, never required.** A post publishes on its normal cadence whether or
  not it joins a series. Nothing in the publish gate checks for series membership.
- **The writer may flag a fit, a human or the seed script attaches.** When a new post clearly
  belongs to a launch franchise (its target query sits in that franchise's cluster), note the fit
  in the run summary. Attachment itself is a `blogPostExtras` doc (`series` reference +
  `seriesOrder`), created by `scripts/seed-notebook-content.ts`, an editor in Studio, or a future
  approved instruction to the writer. Do not create series docs ad hoc; new franchises are an
  editorial decision, not a per-post one.
- **Order is beginner-first.** Within a series, `posts[]` order (and `seriesOrder`) reads from
  least to most experience assumed, not by publish date.
- **Series pages are citable surfaces.** Series landings carry CollectionPage + ordered ItemList
  JSON-LD, so keeping a franchise's cluster complete (guide + comparison + care angles) compounds
  the same way the §5 authority clusters do.

## 5. Authority-building priorities

Build topical clusters (guide + comparison + care all linking to the same collection) around these first. Depth on a few collections earns category-query citations faster than one post each across 24.

1. **Air Pulse and Suction** (`air-pulse-suction`). Highest branded-generic query volume in the category ("clitoral suction toy"), the current theme week, and a mechanism that is genuinely explainable in Emma's voice. First cluster to own.
2. **Wands** (`wands`). Evergreen, broad appeal, gateway product, high "how to use a wand" volume. Strong internal-link hub to bullets and air-pulse.
3. **Lubricants** (`lubricants`). Every customer needs it, comparison-rich (silicone vs water, warming, anal), and it overlaps care and every other cluster as an attach embed. Low unit margin but high velocity and cross-link value.
4. **Rabbits / Dual Action** (`rabbits`). Iconic, high "best rabbit vibrator" intent, clear comparison framing against single-stimulation toys.
5. **Prostate Toys** (`prostate-toys`). Underserved by competitors, so the citation gap is winnable, and for-him depth is thin across the market. High-intent, beginner-anxious queries that reward honest, plain guidance.
6. **Couples and Wearable / Remote** (`couples`, `remote`). Differentiator with higher AOV, and the long-distance / app-controlled query trend is rising and under-answered.

Below 300 sessions/week the retro leans on margin math, stock depth, and these heuristics rather than GA4 weighting, and the brief should say so.

## 6. KPIs for the weekly retro

- **Publish reliability.** Posts published vs planned (target 7/7). Missed days get a reason, not a silent zero.
- **Gate pass rates.** Share of posts passing `emma-empathy-reviewer` (voice) and `sex-wellness-reviewer` (accuracy) on first submit, tracked separately. A falling rate is a prompt problem; file an `instructions` suggestion, do not hand-fix.
- **Indexed page count.** Notebook URLs and their `.md` twins in the sitemap and `llms.txt`, week over week.
- **LLM-citation spot checks.** A fixed 20-query tracker run in ChatGPT, Perplexity, and Claude (for example "how does a clitoral suction toy work", "silicone vs water based lube"), at least 5 of them drawn from the Real Talk target-query column (§8B). Log whether xdipx is cited and which page.
- **GA4 referrals.** Sessions and any assisted conversions from `chatgpt.com`, `perplexity.ai`, and `claude.ai` referrers. Weighted only at or above 300 sessions/week; below that, report raw counts and treat as directional.
- **Notebook engagement.** GA4 custom events from the redesign: `notebook_subscribe` (email capture by location), `notebook_embed_click` (post → PDP click-through), `notebook_series_click`, and `notebook_read_depth` (25/50/75/100). Same 300 sessions/week weighting rule; these are the signals that say whether the design earns its keep.

## 7. Standing rules

- **Category maps to JSON-LD.** `guides` posts get ItemList JSON-LD from their product embeds automatically, so any ranked buying guide uses `blogCategory: guides`. Do not put a ranked list in `comparisons`, `care`, or `wellness-basics`.
- **FAQ section is mandatory** on every post. Use answer-shaped question H2s throughout, not statement headings.
- **In-stock embeds only.** At least one honest, currently in-stock product per post. Never embed an out-of-stock or draft product.
- **Honest Emma.** AI guide with no lived experience per `docs/emma-voice.md`. Speak from specs, materials, and review patterns. Never "I tried / tested / own it".
- **Accuracy-gated, with real sources.** Every draft passes the `sex-wellness-reviewer` accuracy gate alongside the voice gate (anatomy/physiology, verifiable statistics, materials safety, realistic expectations). When the gate returns citations on PASS, the post carries a `## Sources` section with 1-2 real named sources (mechanically appended, never invented); zero citations means no Sources section, never padding. No backfill: published posts are not retro-edited to add sources.
- **First person, never third person about Emma.** Emma is the author and writes as "I" or the editorial "we". The copy never refers to her by name or narrates her as a character. No headings or sentences like "Where does Emma add nuance?", "What Emma recommends", or "Emma's take"; name the section by its substance instead ("Where this needs a caveat"). We do not comment on Emma.
- **No medical claims.** Body-safety and material facts only. No treatment, diagnosis, or health-outcome promises. Name materials plainly (medical-grade silicone, glass, stainless steel).
- **No prices in body text.** Pricing lives on the PDP and in the embed component, never in prose. No discount framing that would trip MAP rules.
- **Internal links every post.** At least one collection link and one PDP, using canonical `/products/{slug}` and `/collections/{handle}`. The embedded `blogProductEmbed.productHandle` is also what powers the inbound PDP/collection backlinks — a wrong handle silently breaks them. Full rules: `docs/store-team/internal-linking.md`.
- **No em-dashes, no countdowns, no urgency, CTAs from the whitelist only.** Billing descriptor is always XDIPX.

## 8. Editorial formats (owner-added 2026-07)

Both formats live in new `blogCategory` documents (`blogCategory-podcast-notes` "Podcast Notes",
`blogCategory-real-talk` "Real Talk") — content documents, not schema changes. Seed them once
before the first post of each type. All §7 standing rules apply unchanged; the notes below are
additive.

### 8A. Podcast Notes (weekly, Thursday)

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

### 8B. Real Talk (twice weekly, Tuesday + Friday)

A problem → root cause → resolution narrative that ends, where honest, at products that actually
help. Structure is plain H2 prose — no custom Sanity block. **Essay-shaped, not answer-shaped**
(owner-codified 2026-07-28, superseding the question-H2 mandate for this format only; guides and
the other categories stay answer-shaped per the blog addendum):

0. **Direct-answer capsule.** Two sentences at the very top that answer the target query
   directly — the quotable block for LLM/AEO citation. The essay below is what gets read; the
   capsule is what gets cited.
1. **The problem, scene first — illustrative, never sourced-frequency.** Open with a real-sounding
   scene or moment of recognition in the reader's world before any explanation, framed
   **illustratively** ("It is a familiar scene. Someone opens a site and freezes at the first
   choice."). Prefer that scene phrasing over any "what people tell us / what shows up in questions"
   or "more than any other question" framing: the writer has no access to support mail and cannot
   verify a customer-frequency claim, so the charter (which outranks this plan) reads it as
   unsourced customer-feedback and it has BLOCKed the voice gate on first submit. Steer to the
   illustrative scene to lift the first-submit pass rate. Statement H2s are allowed in this format.
   The title still matches the target query closely, and the FAQ carries the question-form variants
   (with FAQPage JSON-LD), so citability survives the essay shape. Never first-person anecdote (Emma
   has no lived experience — the rule is extra load-bearing in this format; her hero-image
   depictions are fictional expression and don't change this).
   - **Watch note (cadence):** avoid the "the one you keep reaching for" cadence, adjacent to the
     retired "keeps coming back to" tic. It reads as an unsourced habit claim about the reader and
     rotates out like any other repeating tic.
2. **The root cause, plainly and with authority.** No diagnosis language, no medical overreach;
   include a "worth seeing a clinician if…" line whenever the topic borders on health. Variance
   in experience is stated boldly, never hedged.
3. **What helps** — 2-3 concrete approaches (habits, communication, technique). **Embed cap: at
   most ONE `blogProductEmbed` per Real Talk post**, and it must pass the earned-embed test:
   (E1) the sentence immediately before the embed names a felt state, not a product property;
   (E2) the embed's own paragraph carries at least as many reader-state clauses as
   product-property clauses; (E3) the embed copy resolves the objection the section raised, in
   that section's own words. Approaches without an honest embed link a collection instead.
   **Products appear only in this resolution section, never in the problem framing** — that is
   the anti-sleaze rule, **and it binds the hero image too**: Real Talk heroes are §0-H human
   heroes per `docs/notebook-team/image-brief.md`, never a product hero promoting a remedy to
   the thesis.
4. FAQ section as always — this is where the question-shaped material concentrates.

**Upstream substance (Real Talk only):** before drafting, the `intimacy-advisor` contributor
returns the emotional arc, the reader's specific unnamed fear, what clinicians commonly observe,
and validation lines for the writer to draw from (routine Step 3.5). It contributes; it never
gates.

Format rules added 2026-07-21 (owner-approved):

- **One target query per story.** Every Real Talk post targets exactly one query, phrased the way
  a person actually asks an LLM (the Target query column below). The title or the problem H2
  matches that phrasing closely; the FAQ picks up adjacent variants. This is what makes a
  narrative citable instead of merely readable.
- **Series membership.** Real Talk posts belong to the `real-talk` series (§4). The writer flags
  the fit in the run summary as usual; attachment stays a `blogPostExtras` doc via the seed script
  or Studio. Reading order is lightest-topic-first rather than beginner-first.
- **Clinician line is mandatory on † topics.** Rows marked † below border on health; the "worth
  seeing a clinician if…" line in the root-cause section is required, not judgment-call, on those.
- **Clinician line also applies without the dagger (added 2026-08-03).** Care/hygiene Real Talk
  topics that touch bacteria, irritation, or infection risk carry the "worth seeing a clinician
  if…" line even when the row is not marked †. Write it in on the first draft; do not spend a
  shared rewrite cycle adding it later.

Topic bank (30; work top to bottom within the Tue/Fri rhythm, reorder to serve the theme week,
extend freely — additions need a slug, problem, and target query):

| # | Slug | Problem | Target query |
|---|---|---|---|
| 1 | what-to-do-when-desire-levels-dont-match | Mismatched libido logistics in a long-term relationship | "my partner and I have mismatched libidos what do we do" |
| 2 | why-first-toy-shopping-feels-overwhelming | First-toy overwhelm: too many options, no vocabulary | "first sex toy shopping feels overwhelming where do I start" |
| 3 | what-helps-with-dryness-during-sex | Dryness and discomfort, and when lube is the whole answer † | "what helps with dryness during sex" |
| 4 | why-does-my-toy-smell-and-how-do-i-fix-it | Toy-care anxiety: smells, residue, material worries | "why does my sex toy smell and how do I fix it" |
| 5 | reconnecting-after-a-baby | Post-partum reconnection, patience, and pressure † | "how do couples reconnect sexually after a baby" |
| 6 | what-if-a-toy-is-too-intense | Overstimulation: settings, buffers, and gentler picks | "my vibrator is too intense what do I do" |
| 7 | how-do-couples-talk-about-trying-toys | Raising the topic with a partner without it landing wrong | "how do I bring up sex toys with my partner" |
| 8 | what-size-should-you-actually-start-with | Sizing confusion and the case for starting small | "what size sex toy should a beginner start with" |
| 9 | when-vibration-feels-like-too-much-noise | Discretion worries: noise, storage, shared walls | "how loud are vibrators and how do I keep things quiet" |
| 10 | why-cant-i-finish-with-a-partner | Orgasm gap frustrations, pressure, and pacing | "why can I orgasm alone but not with my partner" |
| 11 | what-helps-when-menopause-changes-sex | Menopause-era changes: dryness, sensitivity, desire † | "how does menopause change sex and what helps" |
| 12 | what-helps-when-stress-kills-your-sex-drive | Stress and burnout flattening desire † | "stress has killed my sex drive what helps" |
| 13 | what-to-do-when-medication-changes-your-libido | Medication side effects on libido and orgasm † | "my antidepressant lowered my libido what can I do" |
| 14 | why-does-penetration-sometimes-hurt | Discomfort or pain with penetration † | "why does sex sometimes hurt and what helps" |
| 15 | what-helps-when-you-finish-faster-than-you-want | Finishing sooner than wanted, and the pressure spiral † | "how to last longer in bed" |
| 16 | what-to-do-when-orgasm-takes-longer-than-it-used-to | Orgasm taking longer with age or medication † | "why does it take longer to orgasm as I get older" |
| 17 | can-a-vibrator-make-you-less-sensitive | The desensitization worry, and what the research says † | "can using a vibrator too much make you less sensitive" |
| 18 | how-do-long-distance-couples-stay-intimate | Long-distance intimacy logistics | "how do couples stay intimate long distance" |
| 19 | what-to-do-when-sex-feels-routine | The long-term relationship rut | "how do we get out of a sexual rut in a long relationship" |
| 20 | how-do-you-bring-up-a-fantasy-with-a-partner | Naming a fantasy without it landing wrong | "how do I tell my partner about a fantasy" |
| 21 | what-if-your-partner-doesnt-want-to-use-toys | A reluctant partner who hears toys as criticism | "my partner does not want to use sex toys what do I do" |
| 22 | what-if-a-partner-feels-replaced-by-a-toy | Partner insecurity about a vibrator | "my partner feels threatened by my vibrator" |
| 23 | is-scheduling-sex-a-good-idea | The spontaneity myth vs the calendar reality | "does scheduling sex actually work" |
| 24 | what-if-you-like-different-kinds-of-touch | Mismatched stimulation preferences in one bed | "my partner and I like different kinds of touch" |
| 25 | what-helps-you-relax-enough-to-enjoy-sex | Staying stuck in your head, unable to be present | "how do I relax and stay present during sex" |
| 26 | what-if-you-feel-self-conscious-during-sex | Body self-consciousness dimming everything | "how do I stop feeling self conscious in bed" |
| 27 | how-do-you-restart-after-a-long-dry-spell | Restarting solo or partnered sex after a long break | "how to get back into sex after a long time without it" |
| 28 | how-do-you-choose-toys-when-mobility-is-limited | Grip, reach, and mobility limits | "sex toys that work with arthritis or limited mobility" |
| 29 | how-do-you-keep-toys-private-in-a-shared-home | Privacy with roommates or kids in the house | "how do I keep sex toys private at home" |
| 30 | can-you-travel-with-a-sex-toy | Travel worry: security lines, packing, batteries | "can you bring a sex toy on a plane" |

† = health-adjacent; the "worth seeing a clinician if…" line is mandatory.

Bank composition: roughly a third health-adjacent, a third relationship and communication, a third
practical confidence. Rows 1-10 are the original launch bank and seed the `real-talk` series in
lightest-first order; rows 11-30 extend it. High-volume LLM queries (14, 15, 17, 30) are the
citation bets; treat them with extra care on sourcing and the clinician line.
