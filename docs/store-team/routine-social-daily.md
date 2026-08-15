# Routine — Social Drafts (social-media-manager)

The playbook for the scheduled social routine. Entry agent: `social-media-manager`. **You draft; you
never publish.** Every post you write lands in `social_posts` as `status:'draft'`,
`review_status:'pending_review'`. What happens next is not yours: on Instagram the independent
`social-publish-gate` decides (Step 6.5) and, when `instagram_autopublish_enabled` is on, the hourly
publish job ships what it approved. On every other platform the owner still acts in `/admin/socials`.

That separation is the design, not a formality. The drafter deciding what ships is the failure mode
the gate was built to remove, so there is no live-posting step in this playbook and none may be
added. §Posting posture below records the owner's 2026-08-11 decision to stop being the bottleneck
and what replaced his click.

This is the **internal review period**: the owner's decisions and written feedback on each draft
are the team's training signal. Read them verbatim, rework what they ask for, and let the patterns
change how you draft.

Runs on the **Max subscription**. Recommended cadence: daily (the frequency config sizes each run).

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"social","runType":"social"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=social&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load doctrine + context (data only)

1. `docs/emma-voice.md` + the **social addendum** (mandatory, before any words), or the LinkedIn
   addendum for that lane. Missing → STOP and report.
2. `docs/ads-policy.md` §Organic social + §Creative (mandatory). These bind organic drafts, not
   just paid, and the platform's live rules outrank both when they are stricter.
3. `docs/store-team/mission-brief.md`; the strategy brief (`GET /api/team/brief`), including its
   **Social Plan** section when present, which sizes the day's volume.
4. `docs/store-team/instagram-campaigns.md` (mandatory before any Instagram drafting): the standing
   campaign schedule, the pillar and format library, the rotation rule, and the continuity rule.
   Missing → STOP and report.
5. Calendar (`GET /api/team/calendar`), current featured products/deals.
6. Today's quota: `POST /api/team/social-post {"op":"config"}` → per-platform posts/day
   (`social_freq_*`; 0 = skip that platform entirely).
7. Review outcomes: `POST /api/team/social-post {"op":"list"}` — `reviewStatus`, `feedback`, and
   `editedText` per row are the owner's verdicts on your last drafts.
8. LinkedIn only (when `social_freq_linkedin` > 0): pending research briefs (Sanity GROQ)
   `*[_type=="researchBrief" && status=="pending" && targetPlatform=="linkedin"]` — the weekly
   adult-business-researcher fills this queue (`docs/store-team/routine-research-weekly.md`).

## Posting posture (read before Step 2b, Step 2.5, and Step 7)

Owner direction 2026-08-11: **"I don't want to be the bottle neck for posts to go out. I'll review
them once they are live and give feedback to the team."**

That is a decision to remove the pre-publish human gate on Instagram, and it is the owner's to make.
It is not a valve flip, because of one fact that is easy to miss: **nothing sets
`review_status:'approved'` except the owner's own click in the Social Studio.** Remove the click and
nothing ever becomes approved, so a publish job would find nothing to publish. Something has to fill
that slot, and what fills it is an independent pre-publish gate, not an absence.

**All four prerequisites now exist. The posture is decided by one valve.** They were:

1. A social image-generation path, so posts stop carrying retired bare-SKU packshots.
   **Built** — `scripts/gen-social-image.ts` (Step 5).
2. An **independent pre-publish gate** that is the thing that writes `approved`. Not the drafting
   agent grading its own homework, and not the voice gate, which reviews strings and is structurally
   blind to imagery, live stock state, and repetition across posts.
   **Built** — the `social-publish-gate` agent plus its deterministic half, run at Step 6.5 below.
3. A publish job with a publish-time stock re-check, an image-provenance check, a daily publish cap
   independent of the drafting quota, and its own kill switch.
   **Built** — `/cron/social-publish`, hourly, behind `instagram_autopublish_enabled`.
4. The owner can leave feedback on a **posted** row, so his stated loop can close.
   **Built** — the live-post verdict in the Social Studio.

So the live question is no longer "what is missing" but "is the valve on", and the routine **reads
it rather than assuming either answer**: `POST /api/team/social-post {"op":"config"}` at Step 2, and
the Social tab of `/admin/homepage-team` is where the owner flips it.

- **Valve OFF:** drafts land `pending_review`, the gate still runs at Step 6.5, and approved posts
  wait for the owner's click in `/admin/socials`. Say plainly in the run summary that posts are
  waiting on him, and how many.
- **Valve ON:** the same drafts, the same gate, and the publish job takes them from there. Nothing
  about drafting changes. Report drafted and published as two separate numbers, always.

One consequence to hold onto, because it is the thing that makes an unattended feed survivable: the
publish job refuses any row that does not carry a gate PASS stamp, including one the owner approved
by hand. `approved` on its own is no longer a licence to publish. If you see a run reporting
`no_gate_verdict`, that is a row nothing adversarial read, and the fix is to gate it, never to
approve it again.

**What never changes with the posture.** The voice gate, the platform-policy gate, the stock gate,
and the campaign rules all still bind. Removing the owner's approval click removes a human check; it
does not remove a single machine one, and no gate may be relaxed to make autopublish easier to ship.

## Step 2a: Campaign reconciliation (every run, no exceptions)

Instagram runs a continuous chain of themed campaigns from
`docs/store-team/instagram-campaigns.md` §5. There is never a day without an active campaign. This
pass is pure date arithmetic with no editorial judgment in it, which is exactly why it runs
unconditionally rather than on one weekday: "August Reset, Emma's Way" was proposed for a Saturday
and sat at `planned` forever because the only thing that reconciled calendar status was the homepage
Monday changeover.

Instagram campaign rows are named with an `IG: ` prefix (`IG: Wand Week` versus the homepage's
`Wand Week`). The table has no channel column, so the prefix is how you tell the two tracks apart
without reading into any JSON. Only reconcile rows you own; never touch a homepage row.

1. **Retire the stale.** A `planned` `IG: ` row whose whole window (`starts` through `ends`) is
   already in the past was never run and must not be revived. Mark it `skipped` and say so in the
   summary. Activating it would put a campaign on the feed weeks after its moment, which is exactly
   the failure "August Reset, Emma's Way" would have caused if anything had picked it up.
2. **Activate.** No `IG: ` row is `active` today and a `planned` one's window contains today →
   promote it.
3. **Close and hand over.** The active campaign's `ends` date (from the schedule) has passed → mark it
   `done` and activate its successor **in the same pass**.
4. **Kickoff.** A campaign activating today has no key-art pool → run the kickoff pass
   (`instagram-campaigns.md` §3.4) before drafting: lock ground set, light signature, rhyme prop, and
   cast reference, and generate the reusable typography plates. The visual scheme is decided once,
   before post 1, and never re-decided mid-campaign.
5. **Runway.** The schedule must always hold at least four weeks of future campaigns. Less → file a
   suggestion to `store-strategist` (kind `strategy`, `targetTeam:'strategy'`) asking for the next
   block. **Never invent campaign N+1 yourself:** the social team owns execution inside a campaign,
   `store-strategist` owns which story the store is telling this month. If a runway suggestion is
   already open, say so in the summary instead of filing a duplicate.

## Step 2b — Self-throttle

**Which throttle applies depends on the posting posture** (§Posting posture, above).

**While Instagram posting is owner-reviewed (today):** the throttle is queue depth. Using the Step 2
item 7 review-outcomes list, count `pending_review` rows and check whether any row was reviewed
(`approved`/`needs_changes`/`rejected`) in roughly the last 3 days. If unreviewed `pending_review`
drafts exceed **three days of the current per-platform quota** (the sum of `social_freq_*` across the
platforms you draft for, times 3) with **zero** owner reviews in that window, throttle this run:
draft **at most 1 new post** (or skip new drafting entirely), prioritize the active campaign's next
slot over anything evergreen, and record an honest `event` surfacing the backlog size and age. The
threshold was hardcoded at 9 and silently stopped scaling the moment Instagram's frequency moved; it
is now derived from the live quota.

**Once Instagram autopublishes, queue depth stops meaning anything.** Nothing queues, so a
backlog-based throttle can never fire and the run would accelerate into a wall instead of slowing
down. The trigger moves from "the queue is getting long" to "something already live looks wrong",
which is the only failure mode left once nothing can be caught before the fact. Read the last 3 days
of `status:'posted'` Instagram rows and check three things:

1. **A post was removed or the platform flagged it.** Stop drafting new Instagram posts entirely,
   step volume down one tier per the `docs/ads-policy.md` escalation ladder, end the active campaign,
   and file the incident. One post is never worth the account.
2. **Owner feedback on a live post reads as a stop or a correction.** Throttle to one draft and
   address that specific complaint before anything else ships.
3. **Neither fired, but a required gate cannot be satisfied cleanly this run** (no voice PASS, no
   compliant image asset, campaign reconciliation failed). Throttle to one. Never force volume to
   fill a quota that is now unsupervised on the way out.

Reworks (Step 2.5) and Step 7b suggestion handling run as normal under both postures. This only
sizes down *new* drafting; it never touches a gate.

## Step 2.5 — Rework pass (before any new drafting)

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","reviewStatus":"needs_changes"}'
```

For each `needs_changes` draft that has no rework yet (no newer row with `reworkedFrom` = its id):
read the owner's `feedback` verbatim, redraft addressing exactly what it asks, voice-gate the
redraft, and write it with `"reworkedFrom": <original id>`. Reworks count toward the run cap and
the platform's daily quota. Feedback you can't act on (e.g. it asks for a capability you don't
have) → say so honestly in the run summary, never silently drop it.

## Step 2.6 — Stock gate (never feature an out-of-stock product)

Owner direction 2026-08-09, after a live post featuring an out-of-stock product had to be deleted.
**Never feature a product that is not currently in stock and ACTIVE**, in any format — single posts,
carousels, and Brand Crush alike.

- **Draft-time:** before selecting any product for a post, verify `availableForSale` via the
  Storefront API. An out-of-stock, DRAFT, or ARCHIVED product is ineligible; pick the next candidate.
- **Queue-hygiene sweep (run start):** sweep the still-unposted `approved`/`pending_review` drafts and,
  for any whose featured product has since gone out of stock, mark it `needs_changes` with feedback
  naming the stock issue, so the owner never approves a post that can no longer be bought.
- `inventory-sentinel` adds `social_posts` featured products to its watch scope, so a stock drop on a
  queued post surfaces as a flag rather than a deleted live post.

## Step 3 — Draft (≤6 per run, reworks included)

Draft counts come from the Step 2 config — up to `social_freq_<platform>` new posts per platform,
minus any reworks already written for that platform today. Platform-appropriate, **editorial-first**
(not product-first: on Instagram and TikTok a post that reads as an offer is removable under Meta's
Restricted Goods standard regardless of how clean the image is), fresh language every time. X drafts fit 280 chars; Instagram and TikTok drafts are posted manually
by the owner once approved. At most one promo-angle post per run, and only referencing
owner-approved promo codes. Propose a `scheduledFor` date for every draft (default: tomorrow) so
the Studio's calendar strip populates.

**Instagram drafts against the active campaign.** Read its pillars, formats, rotation, and visual
scheme from `docs/store-team/instagram-campaigns.md`, then:

- **Rotate.** Never two consecutive Instagram posts from the same pillar, and never two consecutive
  posts in the same format. The ground follows the 4-beat cycle and the archetype follows the 7-beat
  spine (§3.1). Read the last few posted rows to find your position in both.
- **Cadence is context-driven, not a fixed ramp.** Baseline is **at least one Instagram post every
  day, no zero days**. Scale to 2-4/day on weeks with something real happening (an aisle or drop
  going live, a featured-brand week, a calendar promo, an adopted trend brief); 10/day is a hard
  ceiling for an exceptional moment, never a target. The strategy brief's Social Plan section sizes
  this when present.
- **Content mix** comes from `docs/store-team/mission-brief.md` §6b (roughly 40% product-in-scene or
  carousel, 30% pure education with no product in frame, 20% inspiring, 10% site news and trend
  reacts; at most half of a multi-post day is product-forward). The charter points at the brief for
  this ratio, so the brief is where it is maintained.
- **Set `postType:'campaign'`** on Instagram campaign posts (the enum already carries it and no row
  has ever used it) and name the campaign slug in the draft's event summary, so posts can be traced
  to their campaign until the schema carries a real link.
- **A campaign licenses nothing.** Step 4a, 4b, 2.6, and 2b all apply unchanged inside a campaign.
  "Wand Week" is not permission to sell wands.
- **Any post removal ends the campaign** and steps volume down one level immediately, per
  `docs/ads-policy.md` escalation. Volume is earned back by a clean stretch, not by waiting.

**Plain nouns first.** Name the product category and anatomy with the charter's plain nouns
(`docs/emma-voice.md`, "Say the word, drop the wink") — vibrator, clitoral, prostate, penetration —
not euphemistic stand-ins ("internal massager", "external contact"). The plain word is warmer and
clearer and clears the voice gate on the first pass; softening it drew an avoidable REVISE on 2 of
3 drafts in run 41. This is a clarity rule, **not** a licence to cross the Step 4b platform-policy
gate: naming a category or anatomy matter-of-factly is not describing what the product does to a
body, and 4b's arousal/act-description lines still bind on Instagram/TikTok/X. Reserve softer,
mechanism-only phrasing for surfaces where the charter actually requires restraint (paid-ad
creative).

**Never gate by experience.** Do not frame a product as "not a first toy", "for advanced users",
or otherwise assume where the reader is on their journey — it violates the charter's
no-experience-assumed trust canon (`docs/emma-voice.md`). Describe the build and who it suits by
mechanism ("dual-density build known for a grounded feel"), never by an implied skill tier.

**LinkedIn is a different lane** (`postType:"authority"`, quota `social_freq_linkedin`):

- Drafted ONLY from a `pending` researchBrief. No pending brief → skip LinkedIn honestly this run;
  never draft an authority post from memory or general knowledge.
- Voice: the **LinkedIn addendum** in `docs/emma-voice.md`, not the product register. Brand byline
  ("we"), never Emma. Industry-first: no product links, no promo codes, no store CTAs. Every stat
  is attributed in the post and comes from a brief claim; hedge or drop `low`-confidence claims.
- After the draft row is written, patch the brief: `status:'used'`, `usedByPostId` = the new
  `social_posts` id. One post per brief.
- LinkedIn drafts count toward the ≤6 run cap like any other platform.

## Featured Brand of the Week

A standing series, not a daily task. Source of truth for the current brand: the Shopify `vendor`
field, kept aligned with the homepage featured-brand rail and the `marketing_calendar`.

- **Cadence:** one feature post per platform per week for the current brand, tagging the brand.
- **Otherwise reactive only:** quote or reshare the brand's own education content with credit when
  they post something real. Not a standing content type to draft from scratch daily.
- **Explicitly NOT daily @-tagging.** Repeated daily @-tags of the same brand read as spam to the
  platforms and to the brand's own social team, and conflict with the Instagram/TikTok
  editorial-only posture in `docs/ads-policy.md` §Organic social.
- **X gets the most latitude** for direct @mentions; Instagram/TikTok/LinkedIn stay conservative
  per their addenda.
- Draft-only like every other post, and counts toward the ≤6 run cap and the platform's daily
  quota. The point is reciprocal notice from the brand's social team (links, reshares, traffic),
  not volume.

## Step 4 — Two gates, both mandatory

A draft must clear **both**. They ask different questions and a draft can sail through one while
failing the other: a flawless register-9 Emma line is exactly the caption that gets an Instagram
post pulled.

**4a — Voice gate.** Every draft through `emma-empathy-reviewer` to a clean PASS. BLOCK = drop the
draft. Gate Instagram/TikTok/X drafts against the **social addendum**, LinkedIn drafts against the
**LinkedIn addendum** (brand byline, industry-first, professional register). Neither lane is gated
against the owned-channel product-copy register.

This gate is enforced at the write, not on the honour system (ticket #3208). Step 6's `draft` op
**requires** a `voiceGate` verdict `{ verdict, reviewer }`, and the server refuses (400, no row
written) unless the verdict is a `PASS` from a named reviewer. So a draft cannot reach
`pending_review` without a real voice-gate PASS asserted for it, and **if `emma-empathy-reviewer`
cannot be invoked this run, you cannot draft** — you have no PASS to send. Do not substitute a
self-check: report the gate as unreachable and draft nothing, exactly as the fail-closed rule
requires.

**4b — Platform-policy gate.** Self-check every draft against `docs/ads-policy.md` §Organic social
and §Creative, and record the verdict in the draft's event summary. Any single "yes" is a BLOCK,
and a blocked draft is rewritten or dropped, never softened until it squeaks past:

1. Does the post attempt a sale? Price, discount, promo code, shop CTA, or a caption pointing at a
   PDP. (This is the one that removed our first Instagram post's category of content.)
2. Does it describe what the product does to a body? Act naming, arousal, orgasm, "you'll feel".
3. Does the image show product on or against a body, in use or implied use, on a bed with a person,
   or with fluid/lube texture? **A cast member holding and presenting the bare product is licensed**
   (owner ruling 2026-08-12, recorded in `docs/store-team/instagram-campaigns.md` §3.6, which is the
   operative rule for Instagram cast imagery). This item previously read "product in a hand" as a
   BLOCK and carried an interim carton-only carve-out; both are superseded. What still blocks is the
   body, the act, and the bed. `docs/ads-policy.md` has not caught up yet and still lists "in hand";
   §3.6 says to treat itself as operative and escalate that conflict rather than silently killing a
   frame.
4. Does the caption, alt text, on-image text, or any hashtag carry explicit vocabulary, crude
   slang, or emoji-anatomy?
5. Is anything in it coded to slip past a filter? Algospeak, character substitution, reclaimed
   tags. Evasion risks the account, not just the post.

A draft that only survives by disguising what it is fails this gate by definition. When a call is
genuinely close, drop it and say so in the run summary: one post is never worth the account.

## Step 4c — Product link policy (per platform)

Owner question 2026-08-09 ("should posts include a product link when there is one?"). The answer is
per-platform, and on Instagram it is a hard line the Step 4b sale gate already enforces:

| Platform | PDP link in caption | Shoppable path |
|---|---|---|
| Instagram | **Never.** Caption URLs are not clickable on IG, and a PDP link is the clearest "attempting to sell" signal under Meta Restricted Goods. | post → profile → link in bio → site. The bio-link landing page at `xdipx.com/social`, plus comment replies (an answered "where do I get this?" is not a sale attempt; the support-drafted reply carries the direct PDP link). |
| X | Allowed and encouraged, per the existing X lane. | direct PDP link with channel UTMs. |
| LinkedIn | Site links fine, PDP links avoided, per the LinkedIn addendum. | site/editorial links only. |

**`/social` sync is a daily-routine duty.** The bio-link landing page's product modules must be kept
in sync with the last ~7 days of Instagram product posts, so the one clickable path from IG always
resolves to what the feed is actually featuring. Do this as part of the run and note it in the summary.

## Step 5 — Imagery (every visual platform draft ships with a real asset)

An Instagram or TikTok draft **must carry at least one `mediaUrls` entry**. This is not a quality
preference, it is a publish requirement: the pre-publish gate blocks a post with no media and blocks
a post carrying a bare SKU packshot, so a draft with either is drafting into a wall. On 2026-08-13
all four pending Instagram drafts were blocked, three for packshots and one for no image at all,
while a working generator sat unused because this step never named it.

Ask `media-manager` first for an existing Shopify Files / Sanity asset (reuse-first). When nothing
fits, **generate one with `scripts/gen-social-image.ts`**, re-checking the gate before each run. It
handles generation, rehosting to Shopify Files (fal URLs expire in 24h and Instagram fetches the
image server-side at publish time), and the spend row.

**Product post, cast composite.** The presenter holds and shows the product (§3.6):

```bash
npx tsx scripts/gen-social-image.ts \
  --prompt "<scene, wardrobe with its coverage, light, product silhouette, negatives>" \
  --handle <product-handle> --archetype cast --mood <short-token> \
  --presenter-image "<castMember referencePhoto URL, the exact versioned one>" \
  --ref-image "<real Shopify product photo>" \
  --extra-ref "<the same product photo again>" \
  --scale "<cue from the product's real dimensions, see below>" \
  --candidates 2 --caller social-media-manager
```

`--extra-ref` is not redundant. Stage 1 renders an unlabeled plate from the packshot; stage 2
composites it and, without a second look at the true shape, re-interprets it per candidate. That is
how a frame once shipped with an object that was not the SKU at all.

**Product-free post** (education, inspiration, a campaign kickoff naming several categories): drop
`--presenter-image` and pass the cast reference as `--ref-image`. With no product to preserve, a
single reference holding just the presenter is the right tool. For art with no person either, use
`--no-ref` with a reason.

**Scale is a lookup, not a judgment.** Read the length from the product's `xdipx.specifications`
metafield ("Length: 4.7 inches") and build the cue with `scaleCueFromLengthInches()`. Do not guess a
preset: briefing a 4.7-inch bullet as `palm` ("no taller than her palm is wide", about 3.5 inches)
handed the model a cue contradicting its own reference photo, and it rendered the product too big or
too small on three consecutive attempts.

**Check every candidate against the real packshot before offering it.** Shape is stable now; size
still drifts per candidate, so two frames from one run can disagree. Discard the ones that miss
rather than shipping the near-miss. A follower who buys what they saw should receive that object.

**Say the coverage, not just the garment.** "Lace bralette" spans a wide range and the model picks
from it; three generations drifted more revealing than the owner's own reference while nominally
obeying the brief. State the neckline and how much it covers, every time, because an unstated
wardrobe is inherited from the reference photo rather than chosen.

**Name the interest-floor properties you are buying, by number** (§3.4b), before generating. The
reviewer checks the count against the frame, so an over-claimed tally is worse than none: a claimed
"shadow from off-frame" that turns out to be the presenter's own arm fails the property and the post.

**Instagram key art comes from the campaign pool, not from one-off daily requests.** Generating one
image on the day of each draft structurally cannot produce fourteen posts that read as one campaign.
The kickoff pass in Step 2a locks the ground set, light signature, rhyme prop, and cast reference and
generates the reusable typography plates before the first caption is written; daily runs draw from
that pool and generate only what it is missing.

- **Aspect:** generate **4:5** for Instagram (9:16 for TikTok). The profile grid crops tiles to 3:4,
  so the subject must survive both a 3:4 and a 1:1 centre crop.
- **Archetypes:** the licensed set is the charter's — product in a lived-in scene, presenter and cast
  in frame, and tasteful visual metaphor as a carousel hook. **Packshot-only stills are retired
  entirely, filler included.** The line about "product-as-object on clean editorial ground" that
  stood here was the packshot-era rule and is superseded.
- **Cast composites always go through the two-stage path** (unlabeled product plate, then composite).
  Compositing straight from a Shopify packshot puts a legible manufacturer carton in the presenter's
  hand. Never skip the plate.
- **No baked-in text in any generated image.** On-slide typography is rendered per the design
  doctrine.
- Every asset must clear Step 4b question 3 before it ships.

**How to generate an Instagram asset: `scripts/gen-social-image.ts`.** This is the generation path
`media-manager` runs; name it explicitly so the imagery step is wired, because the deterministic
pre-publish gate (`runDeterministicPublishChecks`) blocks **both** a draft with no media and a draft
carrying a bare Nalpac/Shopify SKU packshot — shipping either is drafting into a wall.

- **Product post (cast composite):** `--archetype cast --presenter-image <approved castMember
  reference> --ref-image <the real Shopify product photo> --scale palm|handheld|forearm|bottle`. The
  two references are mandatory (a composite with no product ref invents the product) and `--scale`
  is mandatory (omitting it renders the product the wrong size).
- **Product-free art (metaphor hook, typography plate):** the single-image form,
  `--archetype scene|metaphor|macro|plate ... --ref-image <url>`, or `--no-ref --no-ref-reason
  "<why>"` for genuinely product-free art.
- **Dependency, stated plainly:** the cast-composite path and the `--scale` cue ride the unmerged
  publish-job PR, so **the single-image form works today and the cast-composite form lands with that
  merge.** Until then, generate single product-in-scene images for product posts (never a bare
  packshot), and note the degraded cast path in the run summary.
- **Generate the campaign key-art set at kickoff, not one image per draft-day** (Step 2a): the
  campaign pool comes from `docs/store-team/instagram-campaigns.md` §3.4b, so a campaign produces its
  reusable set once rather than a fresh one-off per caption.

If the gate has no image budget left, ship the draft with the best reusable asset available and
note the ideal asset in the run summary — and say plainly in the summary that the campaign's visual
identity is degraded, rather than letting a reuse-only run look like a normal one. Video is produced by the video team (video-producer +
the video_jobs pipeline), never improvised here: approved videos arrive in your world as
pre-approved `social_posts` rows (postType `video_reel`/`video_short`, `video_job_id` set) fanned
out from `/admin/video-studio`. Do not draft over them, count them against your text/image
quotas, or reschedule them; your daily drafts stay additive to the video slate. If a video draft's
caption reads off-voice, file a suggestion targeting the video team rather than editing it.

LinkedIn drafts are **text-only by default** — no `mediaUrls` required, and product photography is
banned on this platform (LinkedIn addendum). A simple data/chart graphic is the only imagery worth
requesting, and only when the brief's numbers genuinely benefit from one.

## Step 6 — Write drafts

The `voiceGate` field is **mandatory** (Step 4a, ticket #3208): pass the real `emma-empathy-reviewer`
verdict for this exact caption. `verdict` must be `PASS` and `reviewer` names the gate that produced
it; anything else (a missing verdict, a `REVISE`/`BLOCK`, or a gate that could not run) returns 400
and writes no row.

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"draft","platform":"instagram","postType":"manual","tweetText":"<caption>","mediaUrls":["<url>"],"scheduledFor":"<YYYY-MM-DD>","reworkedFrom":<id or omit>,"voiceGate":{"verdict":"PASS","reviewer":"emma-empathy-reviewer","addendum":"social","notes":"<one line from the gate>"}}'
```

One `event` per draft (`eventType:'step'`, `phase:'draft'`):

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'"$RUN_ID"',"summary":"Drafted <platform> post: <one-line summary>","eventType":"step","phase":"draft","agentRole":"social-media-manager"}'
```

Note the field is `summary`, not `message` — this is `POST /api/team/event`, not an op on `/api/team/run`.

## Step 6.5 — Publish gate (every Instagram draft, no exceptions)

Step 4a asked whether the words are right. This asks whether the **finished post** should reach a
public, rented, loseable account. They are different questions and a draft can sail through one
while failing the other: a flawless register-4 Emma line is exactly the caption that gets a post
pulled for the image beside it.

**Spawn `social-publish-gate` as a fresh subagent, one per draft you wrote this run.** Fresh is
load-bearing. The gate is adversarial by design and explicitly must not read your reasoning about
why the post is compliant, because that reasoning is the thing under test. Handing it your context
turns an independent check into a second opinion from yourself.

Give it only the post id. It gathers its own inputs (the caption as it will publish, every media URL
opened and actually looked at, the charter as it reads today, the ads policy, the campaign's visual
scheme, and the last 10 to 14 live posts) and posts its own verdict with
`POST /api/team/social-post {"op":"gate", ...}`. Its definition carries the call shape; do not make
it for it, and never post a verdict on its behalf.

What you do with the outcome:

- **PASS** — the row is `approved` and, when the valve is on, the publish job takes it from there.
- **REVISE** — `needs_changes` with the specific fix. It is next run's rework (Step 2.5), not
  something to re-argue this run.
- **BLOCK** — `rejected`. Drop it. Do not soften it and resubmit; that is the failure mode the gate
  exists to catch.
- **HOLD** — stays `pending_review` for the owner. Name it in the run summary, because a HOLD spends
  his attention and he asked not to be spent.
- **422 with findings** — the gate PASSed something the deterministic checks refused, and the row
  went back for a redraft. Report the findings verbatim. Two of these in a week is a suggestion about
  the gate, not a fluke.

**If the gate cannot be invoked this run, you have drafts that cannot publish, and that is the
correct outcome.** Do not self-certify, do not approve anything, and do not treat a voice-gate PASS
as a substitute: it never opens the images, has no live stock read, and sees one draft at a time. Say
in the run summary that the gate was unreachable and how many drafts are waiting on it. This is the
same fail-closed rule as Step 4a, and it matters more here, because the thing on the other side of
this gate is unattended.

## Step 7 — Retro (the training loop)

Three reads on the latest reviewed drafts:

1. **Rejections and change requests** — quote the owner's `feedback` in the retro. What does it
   ask for that your instructions don't already say?
2. **Silent edits** — on `approved` rows, diff `editedText` against your `tweetText`. The owner
   rewording you is feedback too; name the pattern (shorter? warmer? less hashtag-y?).
3. **Approved unedited** — your quality signal; note what those drafts have in common.

**Under autopublish, two of those three reads disappear.** There is no pending queue to diff, and
`editedText` vanishes entirely as a signal because the owner is no longer rewriting captions before
they ship. Losing the owner's pre-publish review removes the only training signal this loop has ever
had, so the replacement is not optional. Read instead:

1. **Owner feedback on live posts.** Quote it verbatim, exactly as rejection feedback was quoted.
   This is the highest-value signal and the only one guaranteed to carry judgment.
2. **Removals and platform flags.** The hard safety floor. Binary and rare, and it teaches nothing
   about quality above the floor, but it is the one signal that must never be missed.
3. **Engagement**, once it is captured: which *angle* landed with real people, independent of
   whether the owner liked it.
4. **A retroactive self-audit**, because none of the above is guaranteed to arrive on any given day.
   Pull the last N posted Instagram rows and re-judge them against today's charter and today's
   campaign rules, logging any that would not pass the gate as written now. On a run where the owner
   said nothing and nothing was removed, this is the only way the loop still learns anything. Never
   report a silent week as a good week.

One `decision` event (`phase:'retro'`). When **two or more** pieces of feedback share a theme,
file a suggestion (`team:'social'`, kind `instructions`) proposing the concrete change to your own
playbook — that is how the owner's review trains you. Organic winners worth paid
amplification → suggestion with `targetTeam:'ads'`.

## Step 7b — Inbound suggestions (read your own mail)

Other agents file findings *at* this team, and before 2026-07-29 no routine read them: the playbooks
only ever wrote suggestions, so routed findings aged in `approved` forever.

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"list","targetTeam":"social","status":"approved","orderBy":"age"}'
```

Act on up to **3 per run**, oldest first, and only what this run can actually execute within the
gates it already obeys. Close each one you did execute so tomorrow's run does not re-read it:

```bash
-d '{"op":"transition","id":<id>,"to":"applied","actor":"agent:social-media-manager","note":"<what changed>"}'
```
Only `process` and `strategy` rows can be closed this way (`RUN_CLOSE_KINDS`). A `campaign`,
`promo`, `instructions`, or `code` row returns 409 — those have their own executor, or the owner's,
and are not yours to end. Note them instead.


Looked but deliberately did not act (out of scope, no longer true, needs code)? Post a note with
which and why, and leave the status alone:

```bash
-d '{"op":"note","id":<id>,"ref":"<which row, and why this run did not act>"}'
```

The `note` op carries its text in **`ref`**, not `note`. The `transition` example above uses `note`
for its text, so reusing that key here is the natural guess and it returns
`400 Bad Request: ref required`.

Never close a row you did not execute: a false `applied` looks handled and is worse than an aging
row.

## Step 8 — Spend + finish

Log tokens (`feature:'social-drafts'`), then post the final run update
(`status:'succeeded'`, summary = drafts written + reworks + gate results + retro verdict).
