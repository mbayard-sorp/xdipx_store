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

1. `docs/emma-voice.md` + social addendum (mandatory, before any words). Missing → STOP and report.
2. `docs/store-team/mission-brief.md`; the strategy brief (`GET /api/team/brief`).
3. Calendar (`GET /api/team/calendar`), current featured products/deals.
4. Today's quota: `POST /api/team/social-post {"op":"config"}` → per-platform posts/day
   (`social_freq_*`; 0 = skip that platform entirely).
5. Review outcomes: `POST /api/team/social-post {"op":"list"}` — `reviewStatus`, `feedback`, and
   `editedText` per row are the owner's verdicts on your last drafts.
6. LinkedIn only (when `social_freq_linkedin` > 0): pending research briefs (Sanity GROQ)
   `*[_type=="researchBrief" && status=="pending" && targetPlatform=="linkedin"]` — the weekly
   adult-business-researcher fills this queue (`docs/store-team/routine-research-weekly.md`).

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

## Step 3 — Draft (≤6 per run, reworks included)

Draft counts come from the Step 2 config — up to `social_freq_<platform>` new posts per platform,
minus any reworks already written for that platform today. Platform-appropriate, product-first,
fresh language every time. X drafts fit 280 chars; Instagram and TikTok drafts are posted manually
by the owner once approved. At most one promo-angle post per run, and only referencing
owner-approved promo codes. Propose a `scheduledFor` date for every draft (default: tomorrow) so
the Studio's calendar strip populates.

**LinkedIn is a different lane** (`postType:"authority"`, quota `social_freq_linkedin`):

- Drafted ONLY from a `pending` researchBrief. No pending brief → skip LinkedIn honestly this run;
  never draft an authority post from memory or general knowledge.
- Voice: the **LinkedIn addendum** in `docs/emma-voice.md`, not the product register. Brand byline
  ("we"), never Emma. Industry-first: no product links, no promo codes, no store CTAs. Every stat
  is attributed in the post and comes from a brief claim; hedge or drop `low`-confidence claims.
- After the draft row is written, patch the brief: `status:'used'`, `usedByPostId` = the new
  `social_posts` id. One post per brief.
- LinkedIn drafts count toward the ≤6 run cap like any other platform.

## Step 4 — Voice gate (mandatory)

Every draft through `emma-empathy-reviewer` to a clean PASS. BLOCK = drop the draft. LinkedIn
drafts are gated against the charter's LinkedIn addendum (brand byline, industry-first,
professional register), not the product-copy register.

## Step 5 — Imagery (every visual platform draft ships with a real asset)

An Instagram or TikTok draft **must carry at least one `mediaUrls` entry** — the owner reviews
image and caption together; a caption alone is an incomplete draft. Ask `media-manager` first for
an existing Shopify Files / Sanity asset (reuse-first); when nothing genuinely fits, request one
generation (1:1 for Instagram feed, 9:16 for TikTok), re-checking the gate before each generation.
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

## Step 8 — Spend + finish

Log tokens (`feature:'social-drafts'`), then post the final run update
(`status:'succeeded'`, summary = drafts written + reworks + gate results + retro verdict).
