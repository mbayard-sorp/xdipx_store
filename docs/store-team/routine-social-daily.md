# Routine — Social Drafts (social-media-manager)

The playbook for the scheduled social routine. Entry agent: `social-media-manager`. **DRAFT-ONLY**:
every post lands in `social_posts` as `status:'draft'`, `review_status:'pending_review'` for the
owner to review in `/admin/socials` (the Social Studio). There is no live-posting step in this
playbook, and none may be added outside the graduation process (`social_team_autopost` +
`X_AUTO_POST_ENABLED`, owner-flipped, X only).

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
3. `docs/store-team/mission-brief.md`; the strategy brief (`GET /api/team/brief`).
4. Calendar (`GET /api/team/calendar`), current featured products/deals.
5. Today's quota: `POST /api/team/social-post {"op":"config"}` → per-platform posts/day
   (`social_freq_*`; 0 = skip that platform entirely).
6. Review outcomes: `POST /api/team/social-post {"op":"list"}` — `reviewStatus`, `feedback`, and
   `editedText` per row are the owner's verdicts on your last drafts.
7. LinkedIn only (when `social_freq_linkedin` > 0): pending research briefs (Sanity GROQ)
   `*[_type=="researchBrief" && status=="pending" && targetPlatform=="linkedin"]` — the weekly
   adult-business-researcher fills this queue (`docs/store-team/routine-research-weekly.md`).

## Step 2b — Backlog self-throttle

Using the Step 2 item 6 review-outcomes list, count `pending_review` rows and check whether any
row was reviewed (`approved`/`needs_changes`/`rejected`) in roughly the last 3 days. If unreviewed
`pending_review` drafts exceed **9** (about 3 days of quota) with **zero** owner reviews in that
window, throttle this run: draft **at most 1 new post** this run (or skip new drafting entirely),
prioritize the current theme's pick over anything evergreen if you do draft, and record an honest
`event` surfacing the backlog size and age to the owner. Reworks (Step 2.5) and Step 7b suggestion
handling still run as normal. This only sizes down *new* drafting; it never touches draft-only
status, the voice gate, or `social_team_autopost`.

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

**4b — Platform-policy gate.** Self-check every draft against `docs/ads-policy.md` §Organic social
and §Creative, and record the verdict in the draft's event summary. Any single "yes" is a BLOCK,
and a blocked draft is rewritten or dropped, never softened until it squeaks past:

1. Does the post attempt a sale? Price, discount, promo code, shop CTA, or a caption pointing at a
   PDP. (This is the one that removed our first Instagram post's category of content.)
2. Does it describe what the product does to a body? Act naming, arousal, orgasm, "you'll feel".
3. Does the image show product in a hand, on or near a body, in use, on a bed with a person, or
   with fluid/lube texture?
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

An Instagram or TikTok draft **must carry at least one `mediaUrls` entry** — the owner reviews
image and caption together; a caption alone is an incomplete draft. Ask `media-manager` first for
an existing Shopify Files / Sanity asset (reuse-first); when nothing genuinely fits, request one
generation (1:1 for Instagram feed, 9:16 for TikTok), re-checking the gate before each generation.
Every asset on an Instagram or TikTok draft is **product-as-object on clean editorial ground** and
must clear Step 4b question 3 before it ships: the core charter's imagery register is the floor
here, and the social addendum's extra hard lines are the ceiling.
If the gate has no image budget left, ship the draft with the best reusable asset available and
note the ideal asset in the run summary. Video is produced by the video team (video-producer +
the video_jobs pipeline), never improvised here: approved videos arrive in your world as
pre-approved `social_posts` rows (postType `video_reel`/`video_short`, `video_job_id` set) fanned
out from `/admin/video-studio`. Do not draft over them, count them against your text/image
quotas, or reschedule them; your daily drafts stay additive to the video slate. If a video draft's
caption reads off-voice, file a suggestion targeting the video team rather than editing it.

LinkedIn drafts are **text-only by default** — no `mediaUrls` required, and product photography is
banned on this platform (LinkedIn addendum). A simple data/chart graphic is the only imagery worth
requesting, and only when the brief's numbers genuinely benefit from one.

## Step 6 — Write drafts

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"draft","platform":"instagram","postType":"manual","tweetText":"<caption>","mediaUrls":["<url>"],"scheduledFor":"<YYYY-MM-DD>","reworkedFrom":<id or omit>}'
```

One `event` per draft (`eventType:'step'`, `phase:'draft'`):

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'"$RUN_ID"',"summary":"Drafted <platform> post: <one-line summary>","eventType":"step","phase":"draft","agentRole":"social-media-manager"}'
```

Note the field is `summary`, not `message` — this is `POST /api/team/event`, not an op on `/api/team/run`.

## Step 7 — Retro (the training loop)

Three reads on the latest reviewed drafts:

1. **Rejections and change requests** — quote the owner's `feedback` in the retro. What does it
   ask for that your instructions don't already say?
2. **Silent edits** — on `approved` rows, diff `editedText` against your `tweetText`. The owner
   rewording you is feedback too; name the pattern (shorter? warmer? less hashtag-y?).
3. **Approved unedited** — your quality signal; note what those drafts have in common.

One `decision` event (`phase:'retro'`). When **two or more** pieces of feedback share a theme,
file a suggestion (`team:'social'`, kind `instructions`) proposing the concrete change to your own
playbook — that is how the owner's review period trains you. Organic winners worth paid
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
