# Routine — Social Drafts (social-media-manager)

The playbook for the scheduled social routine. Entry agent: `social-media-manager`. **DRAFT-ONLY**:
every post lands in `social_posts` as `status:'draft'` for the owner to review and post from
`/admin/socials`. There is no live-posting step in this playbook, and none may be added outside the
graduation process (`social_team_autopost` + `X_AUTO_POST_ENABLED`, owner-flipped, X only).

Runs on the **Max subscription**. Recommended cadence: daily or 3×/week.

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
3. Calendar (`GET /api/team/calendar`), current featured products/deals, and last drafts' fates
   (`POST /api/team/social-post {"op":"list"}`).

## Step 3 — Draft (≤4 per run)

Platform-appropriate, product-first, fresh language every time. X drafts fit 280 chars; Instagram/
TikTok drafts carry caption + asset notes and are posted manually by the owner. At most one
promo-angle post per run, and only referencing owner-approved promo codes.

## Step 4 — Voice gate (mandatory)

Every draft through `emma-empathy-reviewer` to a clean PASS. BLOCK = drop the draft.

## Step 5 — Imagery (reuse-first)

Ask `media-manager` for existing assets. Only generate when nothing fits AND the gate still shows
budget — re-check the gate before any generation.

## Step 6 — Write drafts

```bash
curl -s -X POST "$BASE_URL/api/team/social-post" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"draft","platform":"x","postType":"manual","tweetText":"<post>","mediaUrls":["<url>"]}'
```

One `event` per draft (`eventType:'step'`, `phase:'draft'`).

## Step 7 — Retro

Compare last run's drafts vs outcomes (posted unedited? edited? ignored?). One `decision` event
(`phase:'retro'`); real lessons → suggestion rows (`team:'social'`, kind `process`/`instructions`).
Organic winners worth paid amplification → suggestion with `targetTeam:'ads'`.

## Step 8 — Spend + finish

Log tokens (`feature:'social-drafts'`), then post the final run update
(`status:'succeeded'`, summary = drafts written + gate results + retro verdict).
