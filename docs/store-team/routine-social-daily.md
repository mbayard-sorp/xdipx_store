# Routine — Social Drafts (social-media-manager)

The playbook for the scheduled social routine. Entry agent: `social-media-manager`. **You draft and
you gate; you never publish.** Every post you write lands in `social_posts` as `status:'draft'`,
`review_status:'pending_review'`.

**Read that first line exactly as written, because a run has already misread it.** "Never publish"
means you never call a posting endpoint. It does **not** mean you leave rows at `pending_review`.
Running Step 6.5 and relaying the gate's verdict is a required part of this routine, not an
escalation beyond it: `op:'gate'` records an independent verdict and the **server** decides whether
that becomes `approved`. On 2026-08-18 run 378 read an open autopublish valve as a reason to skip
Step 6.5 entirely, describing its own mandate as "draft-only". The result was a queue of rows that
nothing could ever ship, on both platforms. **An open valve raises the bar at the gate; it never
removes the gate step.** If you find yourself reasoning that gating is unsafe because publishing is
automatic, you have inverted the safety model: the gate is the safety.

What happens next is not yours: on **Instagram and X** the
independent `social-publish-gate` decides (Step 6.5) and, when that platform's valve
(`instagram_autopublish_enabled`, `x_autopublish_enabled`) is on, the hourly publish job ships what
it approved. On LinkedIn, TikTok, Facebook and YouTube the owner still acts in `/admin/socials`,
because nothing publishes those unattended.

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
4b. `docs/store-team/social-crossplatform-strategy.md` (binding context, owner direction
   2026-08-16): the one-campaign-two-registers through line, the X companion beat, the pairing
   rule, maker relations, and the Meta-approved-catalog preference. Where it and a charter or gate
   disagree, the charter and the gate win, as that file itself states.
5. Calendar (`GET /api/team/calendar`), current featured products/deals.
6. Today's quota: `POST /api/team/social-post {"op":"config"}` → per-platform posts/day
   (`social_freq_*`; 0 = skip that platform entirely).

   **`social_freq_facebook` and `social_freq_tiktok` are both 0 on purpose (owner, 2026-08-16).
   Do not raise either.** Instagram and X are the live platforms. Nothing else can publish:
   `app/lib/social-publish/registry.server.ts` carries instagram, x, tiktok and youtube, but the
   tiktok and youtube entries are stubs that report the manual path, there is no facebook entry at
   all, and the scheduled tick only runs the platforms in `SCHEDULED_PUBLISH_PLATFORMS`
   (`app/lib/social-publish-run.server.ts`), which is instagram and x. The publish gate refuses to
   approve anything outside that list for the same reason.
   **Drafting for either platform is writing into a queue with no exit**, which
   is exactly what happened: 3 Facebook rows and 10 TikTok rows accumulated and none ever shipped.

   On Facebook specifically, verified in Meta Business Suite on 2026-08-16: every post the Page has
   ever shown is an Instagram row, the Page has 0 followers, and Instagram content published
   through the Content Publishing API does **not** reach the Page via Accounts Center
   cross-posting. The no-code mirror does not work for this store's setup. Raise the frequency only
   after a real publisher exists.

   **An unpublishable draft left at `approved` is a time bomb.** It becomes eligible the instant a
   publisher lands and ships copy that is by then months old. Every such row was cleared on
   2026-08-16: Facebook 20, 29, 33 and TikTok 19, 27, 31 are all `rejected`, so both queues are now
   inert and a future publisher starts from an empty slate rather than a live one.

   **The standing rule this leaves behind:** a draft for a platform that cannot publish should
   never sit at `approved`. If a platform's publisher is a stub or missing, its frequency belongs
   at 0 and any row already approved for it gets rejected, in the same pass. Wiring a publisher is
   then a clean act rather than an archaeology problem.
7. Review outcomes: `POST /api/team/social-post {"op":"list"}` — `reviewStatus`, `feedback`, and
   `editedText` per row are the owner's verdicts on your last drafts.
8. LinkedIn only (when `social_freq_linkedin` > 0): pending research briefs (Sanity GROQ)
   `*[_type=="researchBrief" && status=="pending" && targetPlatform=="linkedin"]` — the weekly
   adult-business-researcher fills this queue (`docs/store-team/routine-research-weekly.md`).
9. **Notebook promos, read here and not at Step 7b.** `POST /api/team/suggestion
   {"op":"list","targetTeam":"social","status":"approved","orderBy":"age"}`, and pull every row
   whose `dedupeKey` starts `notebook-promo:`. The content routine files one per published post
   (`routine-content-daily.md` Step 6 item 4). **These have to be read at context load, not in the
   Step 7b mail pass**, because 7b runs after drafting: a promo read there is a promo drafted
   tomorrow at the earliest, which is how the first one sat untouched. Each row carries the title,
   live URL, category, the accuracy-gate-cleared claims, the embedded product handles, and an
   IG-eligibility verdict. Treat it as a first-class candidate for today's quota, not as overflow.

   Three things that turn a promo into a removable post, so they are stated rather than inferred:

   - **Never put the Notebook URL in the caption.** Step 4c already forbids a PDP link, and the same
     reasoning binds here: caption URLs are not clickable on Instagram anyway, and a post whose
     purpose reads as driving traffic is the commerce signal Meta's Restricted Goods standard
     removes. The compliant form is to **teach the article's substance** with at most one plain
     in-sentence pointer, and link-in-bio at most once a day, never as a closing line.
   - **The engagement close still replaces any CTA.** Promoting an article licenses nothing the
     charter bans.
   - **Respect the eligibility verdict.** On a `generic-angle` row the source article's product
     category may not appear in the caption, on-slide text, alt text, or a hashtag. The trap is
     specific and it has already fired once: the natural way to point at a source article is to say
     what it is about, and that sentence is exactly where the banned word enters.

   Notebook promos are usually education, so they preferentially fill the pure-education,
   no-product-in-frame slice of the mission brief's §6b mix, and they suit a carousel. Mark the row
   `applied` when you draft from it. A row still unused after 14 days is stale news; mark it
   `dismissed` in the queue-hygiene sweep and say so. Zero rows is a normal result.

   Honest note so nobody reads the softer output as ignoring direction: the owner asked for
   promotion, and the compliant version of promotion on this platform is teaching.

## Posting posture (read before Step 2b, Step 2.5, and Step 7)

Owner direction 2026-08-11: **"I don't want to be the bottle neck for posts to go out. I'll review
them once they are live and give feedback to the team."**

That is a decision to remove the pre-publish human gate on Instagram, and it is the owner's to make.
It was extended to X on 2026-08-16 23:36 when he turned `x_autopublish_enabled` on, and X published
nothing at all in the day that followed because Step 6.5 gated Instagram only. Read the rest of this
section as applying to both.
It is not a valve flip, because of one fact that is easy to miss: **nothing sets
`review_status:'approved'` except the owner's own click in the Social Studio.** Remove the click and
nothing ever becomes approved, so a publish job would find nothing to publish. Something has to fill
that slot, and what fills it is an independent pre-publish gate, not an absence.

**All four prerequisites now exist. The posture is decided by the platform's valve.** They were:

1. A social image-generation path, so posts stop carrying retired bare-SKU packshots.
   **Built** — `scripts/gen-social-image.ts` (Step 5).
2. An **independent pre-publish gate** that is the thing that writes `approved`. Not the drafting
   agent grading its own homework, and not the voice gate, which reviews strings and is structurally
   blind to imagery, live stock state, and repetition across posts.
   **Built** — the `social-publish-gate` agent plus its deterministic half, run at Step 6.5 below.
3. A publish job with a publish-time stock re-check, an image-provenance check, a daily publish cap
   independent of the drafting quota, and its own kill switch.
   **Built** — `/cron/social-publish`, hourly, one tick per platform behind its own valve
   (`instagram_autopublish_enabled`, `x_autopublish_enabled`). X additionally carries a monthly
   spend ceiling, because X bills per post.
4. The owner can leave feedback on a **posted** row, so his stated loop can close.
   **Built** — the live-post verdict in the Social Studio.

So the live question is no longer "what is missing" but "is the valve on", and the routine **reads
it rather than assuming either answer**: `POST /api/team/social-post {"op":"config"}` at Step 2, and
the Social tab of `/admin/homepage-team` is where the owner flips it. There is one valve per
publishing platform and they move independently, so "the valve" below means the valve for the
platform you are talking about. Report them separately in the run summary; a single "autopost is on"
hid the fact that X's valve was on and shipping nothing.

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

1. **A post was removed or the platform flagged it.** A row at `status:'deleted'` is one Instagram
   no longer has. **The detection is automated now** (ticket #2741): the publish tick checks the
   eight most recent live posts each hour, marks anything Meta has taken down, steps
   `social_freq_instagram` down by half, and on a second removal inside 14 days turns
   `instagram_autopublish_enabled` off and files an owner blocker. So the quota you read at Step 2
   may already be lower than yesterday's, and that is the system working, not a misconfiguration:
   **never step it back up to "fix" it.** What is still yours: end the active campaign, and say in
   the run summary what was removed and what you changed because of it. One post is never worth the
   account.

   One honest limit. The watcher sees a post *disappear*; it cannot tell a Meta takedown from the
   owner deleting a post he did not like, and it treats both as a strike. That errs toward caution
   on purpose. If a removal was his own doing, say so in the summary rather than reporting a
   platform action that did not happen.
2. **Owner feedback on a live post reads as a stop or a correction.** Throttle to one draft and
   address that specific complaint before anything else ships.
3. **Neither fired, but a required gate cannot be satisfied cleanly this run** (no voice PASS, no
   compliant image asset, campaign reconciliation failed). Throttle to one. Never force volume to
   fill a quota that is now unsupervised on the way out.

**Imagery-feasibility preflight (run start, before any Instagram drafting).** Step 5 covers the
budget-exhausted degraded path; this covers the cannot-generate-at-all case, which is what made run
361 produce zero Instagram drafts.

**The sandbox CAN generate images. Do not assume otherwise (corrected 2026-08-19, ticket #4133).**
This preflight used to tell you to check for `SHOPIFY_ADMIN_ACCESS_TOKEN` and to declare IG
degraded-to-zero when it was absent. The scheduled cloud sandbox never carries that token, so that
instruction resolved to "degrade to zero" on **every** scheduled run, permanently. It is obsolete:
generation and the mandatory Shopify-Files rehost now run **server-side** via
`POST /api/team/social-image`, where the Admin token already lives, and
`scripts/gen-social-image.ts` calls that route rather than doing the privileged work locally. The
sandbox needs only `BASE_URL` and a team token, which every run already has. **Never declare IG
degraded-to-zero on the grounds that the Admin token is missing.** If image generation genuinely
fails, quote the actual error from the route.

So at run start, before drafting, confirm THIS run can land a publishable IG asset: either a reuse
path is available (an existing Shopify Files / Sanity asset `media-manager` can return, or an
approved campaign key-art pool), or `POST /api/team/social-image` answers and the social money gate
is open. If neither holds, declare IG image-drafting **degraded-to-zero for this run**, record an
`event` quoting the failure, pivot the run's volume to X and LinkedIn, and treat a zero-IG run as an
intentional, logged, channel-scoped outcome rather than a silent miss. The "no zero days" baseline is
channel-scoped when the imagery path is down; it never licenses shipping an IG draft with no
publishable asset.

**A raw catalog packshot is NOT a way to satisfy this preflight (ticket #4134).** A product image
straight from the Shopify CDN (`27540.jpg` and friends) fails `isGeneratedSocialAsset`
(`app/lib/social-media.server.ts`), which requires a `social-` or `ig-` prefixed basename, and
`runDeterministicPublishChecks` then BLOCKs it on image-provenance, server-side, on relay. Row 59
(2026-08-18, the only Instagram draft that day) was written this way and was unpublishable the
moment it existed, while the run summary described it as a real product photo, which reads as a
feature rather than the defect it is. Packshot-only stills are retired by the voice charter; this is
the enforcement arm of that rule. **Reaching for a catalog image converts an honest
degraded-to-zero into a silent unpublishable draft that looks like output, which is worse than
zero, because zero is visible.** If the imagery path is down, write zero Instagram drafts and say
so, exactly as runs 361 and 368 correctly did.

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

## Step 2.7 — What catalog approval gates, and what it does not

The Shopify catalog is connected to Meta (catalog 1551461513373481) and both the Facebook and
Instagram shops are live. Meta reviews each item. That verdict decides whether an item appears in
those shops and whether it can carry a product tag. It does not decide whether an organic post may
feature the product. Organic posts are judged post by post against Meta's community standards.

So: never filter draft product selection on catalog approval status. As of 2026-08-15, 418 of the
651 reviewed products are rejected, so that filter would remove roughly two thirds of the reviewed
catalog for no benefit on the organic surface. The gates that do bind an Instagram draft are
unchanged: the voice charter, `docs/ads-policy.md` §Organic social and §Creative, Step 2.6 stock,
and `social-publish-gate`.

Where approval does bind, hard: the approved set is the only set that can appear in the shop or
carry a product tag. If and when product tagging is wired into the publisher, a tag may reference
an approved product only, and an unapproved one is a publish-time block, not a warning.

Until tagging exists, commerce on Instagram runs post to profile to link in bio to `/social` to PDP.

## Step 3 — Draft (reworks included)

**THE QUOTA IS PER DAY, NOT PER RUN. Count today's rows before you draft anything.** The social
routine fires **twice daily** (14:00 and 22:00 UTC, `routine-schedule.md` routine 6). Two runs each
drafting a full quota is double the intended volume, and on Instagram that is the fastest way to get
the account actioned. So the first thing Step 3 does is arithmetic:

```
today_remaining(platform) = social_freq_<platform>
                          - rows already written for that platform today (any review_status)
                          - reworks you wrote for it this run
```

Use the Step 2 item 7 list, filtered to today's date, to get that count. **If the remainder is 0,
draft nothing for that platform and say so in the run summary.** A run that honestly drafts zero
because the day is already full is a correct run, not a wasted one. Never treat a fresh
`social_freq_*` as this run's allowance.

This lives here, in the binding playbook, and not only in the evening trigger's prompt. A cloud
trigger prompt is out-of-repo config that this file cannot see and that nobody reviews on a diff, so
a playbook whose correctness depends on one is a playbook that is one silent edit away from being
wrong.

**The per-run cap is `sum(social_freq_*) + reworks`, floor 6**, applied on top of the per-day
remainder above and never instead of it. It was a flat 6, written when Instagram ran at one a day;
at a multi-post slate plus X it would cap a run below its own quota. The cap is self-discipline, not
a server limit, so it is on you to respect it and to say in the summary when you hit it.

Draft counts come from the Step 2 config — up to `social_freq_<platform>` new posts per platform,
minus any reworks already written for that platform today, and minus everything already drafted
today per the arithmetic above. Platform-appropriate, **editorial-first**
(not product-first: on Instagram and TikTok a post that reads as an offer is removable under Meta's
Restricted Goods standard regardless of how clean the image is), fresh language every time. X drafts
fit 280 chars **and require media, same as Instagram and TikTok** (Step 5) — an X draft is never text
plus a link alone. Instagram and TikTok drafts are posted manually
by the owner once approved. At most one promo-angle post per run, and only referencing
owner-approved promo codes. Propose a `scheduledFor` date for every draft (default: tomorrow) so
the Studio's calendar strip populates.

**Instagram drafts against the active campaign.** Read its pillars, formats, rotation, and visual
scheme from `docs/store-team/instagram-campaigns.md`, then:

- **Rotate.** Never two consecutive Instagram posts from the same pillar, and never two consecutive
  posts in the same format. The ground follows the 4-beat cycle and the archetype follows the 7-beat
  spine (§3.1). Read the last few posted rows to find your position in both.
- **Fill the daily slate** (`instagram-campaigns.md` §4a) in order, and stop when
  `social_freq_instagram` is met: A resource, B campaign, C Today's Pick, D what's new, E carousel.
  Slot A ships even on a one-post day. Baseline is at least one post daily, no zero days; 10/day is
  a hard ceiling for an exceptional moment, never a target.
- **Volume climbs a rung at a time, on 7 clean days** (§4 of the campaign doc). Name the rung and
  the clean-day count in the run summary. Never step the quota up yourself to compensate for an
  automated step-down.
- **Today's Pick carries no percentage, no price, and no promo code** (§4b). The deterministic
  publish gate blocks all five sale patterns outright, so a value claim in a caption is not a close
  call, it is a guaranteed BLOCK. Value in the post is quality; the number lives on `/social`, on
  X, in email, and on the site.
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

**Rotate the hook shape across the run (ticket #3639).** No two Instagram drafts in one run may
open with the same hook construction. The voice gate PASSes each caption alone, so a repeated
opener pattern (filler word, then a category-detail claim with an audience-reaction tag) is
invisible to it and drifts into a house tic; run 345 flagged it twice. Alternate shapes to rotate:
a question opener (the question the reader already has), a myth-to-retire opener (name the
misconception, then correct it), and a scene-first opener (start inside the moment, then land the
point).

**The X companion beat (crossplatform strategy §1).** For each Instagram slate post featuring a
product, draft an X companion when the X quota allows: same campaign subject, register 6-7 per the
social addendum, PDP link with channel UTMs, and a fresh sentence, never the IG caption reheated.
The companion belongs to the campaign the same way the IG post does.

**The pairing rule: a toy never travels alone (crossplatform strategy §3).** When a post features a
toy, it also names a lubricant from the catalog that genuinely suits it. Source the pairing from
the product's `accessory_product_ids` / `pairing_why` metafields when present; otherwise pick by
material compatibility (silicone toy → water-based lube) and say why in one plain clause. On X,
link both PDPs with UTMs. On Instagram, name the pairing without a link; the `/social` bio-link
page carries both that week. A pairing that pushes an IG caption into sale territory fails Step 4b
as usual: the pairing is advice, the sale lives on X and the site.

**Pairing-presence self-check (every toy-featuring draft, at draft time).** The pairing rule is a
rule only if a run verifies it before shipping; the week of 2026-08-17 it did not, and four
toy-featuring posts (Womanizer Premium 2, Ferri, Dame Pom, Fifty Shades Ace Pro) all went out with
no lube named. So before writing any draft that features a toy, confirm one of two things is true
and record which in the draft's event summary: either the caption names a compatible lubricant
(Instagram: named in the caption, no link; X: the lube PDP linked with channel UTMs), or no pairing
genuinely applies (a no-product education beat, or a feature that is not a toy) and the summary says
in one clause why none applies. A toy-featuring draft that names no lube and logs no reason has
failed this check and is not ready to ship. This is real helpfulness sourced from
`accessory_product_ids` / `pairing_why` or material compatibility, never upsell theater.

**Author quotes are real or absent (crossplatform strategy §4).** Quotes from educators and authors
in the space are licensed and encouraged: short, attributed by name, and verified against a real
source in the run. Never from memory, never fabricated, never longer than a sentence or two. When
in doubt, paraphrase with a name-check instead.

**Prefer Meta-approved products for Instagram product features, all else equal (crossplatform
strategy §2).** An approved product resolves inside Meta's own commerce surface, so the platform
carries part of the funnel. Approval is never a posting licence and never a draft filter (Step 2.7
and `docs/ads-policy.md` §Meta Shops): it is a tiebreaker between otherwise-equal candidates, and a
rejected product stays fully available to editorial posts.

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
3. Does the image cross the ceiling in `docs/store-team/instagram-campaigns.md` §3.2a? That section
   is the operative rule and it is a specification, not a ban list: a bed, a body, product against
   skin, lubricant texture, two people touching, and implied use are all **licensed**. What blocks
   is narrow and fixed: genitalia or nipples visible or outlined (sheer included), hands on genitals
   over or under clothing, a depicted or discernible sex act, fluid on or near genitalia, product
   against genitalia, and anything age-ambiguous.

   Three earlier readings of this item are superseded and must not be reinstated: "product in a
   hand" as a block, the interim carton-only carve-out, and "on a bed with a person" as a block.
   Read §3.2a as it stands today, not as this gate historically enforced it. A REVISE for
   insufficient charge is now as real a finding as one for excess.
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
| X | Allowed and encouraged, per the existing X lane. **Also requires media** — see Step 5; a text-plus-link X draft is not a lighter-weight option, it is unpublishable. | direct PDP link with channel UTMs. |
| LinkedIn | Site links fine, PDP links avoided, per the LinkedIn addendum. | site/editorial links only. |

**`/social` sync is a daily-routine duty.** The bio-link landing page's product modules must be kept
in sync with the last ~7 days of Instagram product posts, so the one clickable path from IG always
resolves to what the feed is actually featuring. Do this as part of the run and note it in the summary.

## Step 5 — Imagery (every visual platform draft ships with a real asset)

An Instagram, TikTok, **or X** draft **must carry at least one `mediaUrls` entry**. This is not a
quality preference, it is a publish requirement: the pre-publish gate blocks a post with no media on
every platform it publishes (`social-publish-gate.server.ts`, "Media is required on X as well as
Instagram" — owner decision 2026-08-16) and blocks a post carrying a bare SKU packshot, so a draft
with either is drafting into a wall. On 2026-08-13 all four pending Instagram drafts were blocked,
three for packshots and one for no image at all, while a working generator sat unused because this
step never named it.

**X is not the exception this playbook used to imply.** Earlier language described an X draft as
text plus a PDP link, with no mention of media, and the gap went unnoticed for two days: X's valve
turned on 2026-08-17 while seven X rows (ids 52, 54, 55, 56, 57, 58, 60) sat drafted with zero media,
so every one was a guaranteed gate BLOCK. `POST /api/team/social-post {op:'draft'}` now refuses a
`platform:'x'` draft with no `mediaUrls` at write time (400, ticket #4140/#4131) — the same
fail-closed shape as the voice-gate check above — so treat X exactly like Instagram and TikTok in
this step: generate or reuse an asset before you draft, never after.

**Step 5.0, invoke `social-art-director` FIRST, before any image is generated.** It chooses the
location and the cast member, enforces the §3.8 variety windows against the last 8 product posts,
holds cast continuity across the campaign, and hands back the scene brief with its negatives and
its scale cue. You do not write the image prompt inline any more. That improvisation is exactly
what produced a feed of interchangeable frames and the owner's *"Variety is key here"* on
2026-08-19: the picture was always the last thing written, so it always reverted to the safest
option. Pass it today's product handle, the real Shopify photo URL, the product's real dimensions,
and the campaign beat. If it declares degraded-to-zero because no approved cast member exists,
that verdict stands and you do not work around it.

**A cast member in a scene is MANDATORY on every Instagram product post (owner ruling 2026-08-19,
spec §3.7).** The lead image is a person somewhere real, with the product. A product alone, however
beautifully styled, is not a publishable lead frame. Emma is a cast member and is in the rotation.
Use the `cast` op, which composites an approved presenter with a packaging-free plate of the real
product and is hardcoded to 4:5:

```bash
curl -s -X POST "$BASE_URL/api/team/social-image" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"cast","prompt":"<scene, location, wardrobe, light, negatives>",
       "handle":"<product-handle>","mood":"<short-token>","date":"<YYYY-MM-DD>",
       "presenterImageUrl":"<castMember referencePhoto, the exact versioned URL>",
       "productImageUrl":"<real Shopify product photo>",
       "extraImageUrls":["<the same product photo again>"],
       "scale":"<cue from the product real dimensions>","count":2,
       "caller":"social-media-manager"}'
```

**Pick the location from §3.8 and respect the variety rules**: no location repeat inside 8
consecutive product posts, no cast member on more than 2 of any 5. State both choices and their
last-used dates in the retro decision event.

**If there is no approved cast member, you cannot draft an Instagram product post.** As of
2026-08-19 Sanity held zero `castMember` docs with a `referencePhoto`, which is exactly why row 59
shipped as a packshot and was rejected. Declare Instagram product drafting degraded-to-zero, say so
in the summary, and pivot volume to X, LinkedIn, and non-product Instagram posts. **Never fall back
to a product-only frame to fill the slot.**

**Only a generated, rehosted asset is publishable.** The URL you put in `mediaUrls` must have a
`social-` or `ig-` prefixed basename, because `isGeneratedSocialAsset` checks exactly that and the
gate BLOCKs anything else on image-provenance (ticket #4134). A Shopify product CDN URL never
satisfies this, no matter how good the photo is. There is no path where a catalog packshot becomes
a valid Instagram asset, so do not spend a slot discovering that again.

**Carousels: the check is `every`, not `some`.** `allMediaAreGeneratedSocialAssets` runs
`urls.every(isGeneratedSocialAsset)`, so **one bad slide BLOCKs the whole post**, lead slide
included. The owner licenses a solo product shot as slide 2 (§3.7); produce it with archetype
`plate`, which renders a packaging-free product frame that passes provenance. Dropping the raw
catalog packshot in as slide 2 does not "add a detail shot", it kills the post. Instagram carousels
accept 2 to 10 slides.

Ask `media-manager` first for an existing Shopify Files / Sanity asset (reuse-first). When nothing
fits, **generate one with `scripts/gen-social-image.ts`**, re-checking the gate before each run. The
script now delegates generation and the rehost to `POST /api/team/social-image` so the privileged
Shopify Admin call runs server-side (ticket #4133); the sandbox needs no Admin token. The rehost is
mandatory and unchanged: generator URLs expire (Atlas output in ~14 days, fal in 24h) and Instagram
fetches the image server-side at publish time, so every asset is rehosted regardless of provider,
routing per `docs/media-model-routing.md`. The script also writes the spend row.

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
- **The cast-composite path is LIVE. Do not degrade to the single-image form.** This bullet used to
  say the cast form was waiting on an unmerged publish-job PR; that PR merged, and
  `generateCastComposite` and `scaleCueFromLengthInches` both ship in
  `app/lib/social-media.server.ts`. Row 50 (Ferri, published 2026-08-17) is a cast composite that
  cleared the gate, so the path is proven in production, not just present. Runs kept reading the
  stale caveat and reaching for the weaker form; if a cast composite genuinely fails, say what failed
  in the run summary rather than citing a dependency that no longer exists.
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

**X drafts carry `mediaUrls` too — never omit it.** The server 400s a `platform:'x'` draft with an
empty or missing `mediaUrls` array (ticket #4131), the same fail-closed shape as a missing
`voiceGate`:

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"draft","platform":"x","postType":"manual","tweetText":"<caption with PDP link>","mediaUrls":["<url>"],"scheduledFor":"<YYYY-MM-DD>","voiceGate":{"verdict":"PASS","reviewer":"emma-empathy-reviewer","addendum":"social","notes":"<one line from the gate>"}}'
```

One `event` per draft (`eventType:'step'`, `phase:'draft'`):

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'"$RUN_ID"',"summary":"Drafted <platform> post: <one-line summary>","eventType":"step","phase":"draft","agentRole":"social-media-manager"}'
```

Note the field is `summary`, not `message` — this is `POST /api/team/event`, not an op on `/api/team/run`.

## Step 6.5 — Publish gate (every Instagram and X draft, no exceptions)

Step 4a asked whether the words are right. This asks whether the **finished post** should reach a
public, rented, loseable account. They are different questions and a draft can sail through one
while failing the other: a flawless register-4 Emma line is exactly the caption that gets a post
pulled for the image beside it.

**Instagram and X both, and X is the one this step used to miss.** The gate covers exactly the two
platforms the hourly job publishes, because `approved` means "the unattended publisher may ship
this". From X's launch on 2026-08-16 it did not: the valve was on and the tick ran X hourly, but
this step gated Instagram only, so every X draft sat at `pending_review` and **no X post has ever
published**.
An ungated X row is not a safe X row; it is a row that can never go out. The gate knows the
platforms apart (a link is a BLOCK on Instagram and the point of the post on X, length binds on X,
grid composition binds on Instagram); you do not have to brief it on the difference, only to run it.

Platforms with no publisher (LinkedIn, TikTok, Facebook, YouTube) never go to the gate. Approving
one leaves a row that ships stale copy the day a publisher lands, which is the trap Step 2 item 6
describes. The server 409s them, and the owner acts on those in `/admin/socials`.

**Spawn `social-publish-gate` as a fresh subagent, one per draft you wrote this run.** Fresh is
load-bearing. The gate is adversarial by design and explicitly must not read your reasoning about
why the post is compliant, because that reasoning is the thing under test. Handing it your context
turns an independent check into a second opinion from yourself.

**Also sweep any gate-eligible draft still waiting, not only the ones you wrote this run.** X rows
predating this step's widening (ids 52, 54 and 55 as of 2026-08-17) are sitting at `pending_review`
with nothing that will ever pick them up otherwise. Gate them the same way, oldest first, and drop
any whose `scheduled_for` has passed far enough that the copy is stale rather than approving it late.

**Also sweep fanned-out video rows (ticket #3733).** List Instagram `pending_review` drafts
(`{op:'list', status:'draft', reviewStatus:'pending_review'}`) and gate any row carrying a
`videoJobId` exactly the same way, one fresh subagent per row. These are Reels the owner approved
in the Video Studio; that approval reviewed the video, not the finished post, so they wait here
for the same verdict your own drafts get. Skipping them strands them: no other pass gates a video
row, and an ungated row can never publish.

Give it only the post id. It gathers its own inputs: the caption as it will publish, every media URL
opened and actually looked at, the charter as it reads today, the ads policy, the campaign's visual
scheme, and the last 10 to 14 live posts.

**You make the API call, not it.** A spawned subagent in this runtime cannot reach `/api/team/*` at
all: run 331 on 2026-08-15 verified that every request carrying the team credential is refused by the
session permission classifier before dispatch, while the same URL without the header returns a normal
401 from the app. So the gate returns its verdict to you and **you relay it verbatim**:

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"gate","id":<post id>,"gate":{"verdict":"PASS|REVISE|BLOCK|HOLD",
        "reviewer":"social-publish-gate","notes":"<its notes, verbatim>",
        "featuresProduct":true|false,"productHandle":"<handle when featuresProduct>"}}'
```

Verbatim is the whole contract. You are a courier here, not a reviewer: you do not soften a REVISE,
do not upgrade a HOLD, and never invent a verdict for a gate you did not actually run. This is the
same trust model Step 4a already runs on, where you relay `emma-empathy-reviewer`'s PASS, and it is
backed the same way: the server re-runs the deterministic checks on a PASS and refuses it if they
block, so a relayed verdict cannot carry a post past a hard rule even if the relay is wrong.

If the gate cannot be spawned, you have no verdict to relay. See the fail-closed rule below.

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
3. **Engagement. Call it every run, before you write the retro (ticket #4063).** This is not
   conditional and you may not skip it by reporting the capability as missing. The call is:

   ```bash
   curl -s -X POST "$BASE_URL/api/team/social-post" \
     -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
     -d '{"op":"engagement"}'
   ```

   It is backed by `app/lib/social-engagement.server.ts` and persists to
   `social_posts.metrics_json` (migration 079, applied in production). It works today and until
   2026-08-17 nothing had ever called it: no cron, no playbook, no script. Report the numbers in
   the `decision` event, and read them for which *angle* landed with real people, independent of
   whether the owner liked it.

   **Report the number honestly, including when it is bad.** First reading, 2026-08-17: six
   published Instagram posts, total reach **27**, with zero likes, zero comments and zero saves
   across all of them (id17 reach 4, id24 reach 4, id25 reach 7, id47 reach 4, id49 reach 7, id50
   reach 1). **When a post reaches fewer people than the account has followers, say exactly that in
   the run summary.** A day where nothing was removed and nobody complained is not a good day if
   nobody saw the post; reporting it as normal is how the loop stayed blind while holding a working
   instrument.
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

Act on up to **3 per run** for `process`/`strategy` rows, oldest first, and only what this run can
actually execute within the gates it already obeys. Close each one you did execute so tomorrow's
run does not re-read it:

```bash
-d '{"op":"transition","id":<id>,"to":"applied","actor":"agent:social-media-manager","note":"<what changed>"}'
```

**Campaign and promo rows are yours to execute too (owner direction 2026-08-19).** The
product-went-live signals (`kind:'campaign'`) are exactly what feeds the "what's new" slate slot,
so consume them there rather than treating them as someone else's mail:

- When picking slot D (what's new), read the approved `campaign` rows for team social first and
  prefer the freshest in-stock ones as the slot's candidates. When a run drafts and gates the post
  a row asked for, close that row `applied` with the draft id in the note.
- **Age out honestly.** A product-launch signal older than 14 days is no longer "new"; close it
  `applied` with a note saying it aged past the what's-new window without a slot (that is the
  system deciding, which is the point; it is not a failure). Do this for up to 5 aged rows per run
  so the queue converges instead of growing at the detectors' filing rate.
- Until the `RUN_CLOSE_KINDS` change (PR opened 2026-08-19) is merged by the owner, the `applied`
  transition on a `campaign`/`promo` row returns 409. On a 409, leave a `note` op on the row with
  the draft id and move on; do not treat the 409 as an error. Once the PR merges, the closes work
  and this paragraph can be deleted.

`instructions` and `code` rows still have their own executors (agent-editor, R-DEV) and are never
yours to end. Note them instead.


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
