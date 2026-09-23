# Routine — Email Campaign Briefs (email-marketing-manager)

The playbook for the scheduled weekly email routine. Entry agent: `email-marketing-manager`.
**PLAN-ONLY for sending**: campaign briefs are filed as suggestions (kind `campaign`). Once the
owner approves a brief, an optional valve-gated executor turns it into a Klaviyo **draft** (never a
send). The store's Klaviyo integration fires events and manages lists, and, when
`email_campaign_push_enabled` is on, creates draft campaigns; this routine still sends nothing.

Runs on the **Max subscription**. Recommended cadence: weekly, after the strategy routine.

## Step 0 — Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"email","runType":"email"}'   # → $RUN_ID
```

## Step 1 — Gate

`GET /api/team/gate?team=email&excludeRun=$RUN_ID`. If `ok:false` → post skipped, stop.

## Step 2 — Load doctrine + context

`docs/emma-voice.md` + email addendum (mandatory); `docs/store-team/mission-brief.md`; the strategy
brief; calendar; profit signals (`daily_profit_summary`, GA4 top product pages); the existing
event-triggered flows (welcome, back-in-stock, abandoned checkout, post-purchase) so campaigns
complement rather than duplicate; what homepage/social feature this week;
`docs/store-team/creative-platform.md` once it exists (the brand idea and campaign signature every
surface shares; where it and the charter disagree, the charter wins). From the calendar
(`GET /api/team/calendar`, its `videoClips` list; row shape defined in
`docs/store-team/routine-content-daily.md` Step 3, PLANNED), read the **previous week's** clips
whose status is approved or posted. This routine fires Tuesday 15:00 UTC, before the Writers Room pitches at
17:00, so the clips it can quote are always last week's, never this week's batch.

## Step 3 — Design (≤2 briefs per week)

Each brief is copy-paste executable: segment (list + filters), send day/time with reasoning,
2 subject + preview variants, full body copy, canonical `/products/{slug}` links with
`utm_source=klaviyo&utm_medium=email&utm_campaign=<name>`, and the success metric (clicks and
attributed orders, not opens). Frequency guard: a subscriber never gets more than 2 marketing sends
per week, flows included where visible. Discounts only reference owner-approved promo codes with the
MAP note.

**One clip brief per week, when last week produced a clip.** One of the week's briefs (never both)
uses an approved or posted clip's first spoken line as one of its two subject candidates, features
that clip's product, and links the reel (its Instagram permalink once posted; an approved but
unposted clip gets no reel link and the subject line alone). The line goes through the Step 4 voice
gate like any subject (the row's `firstLine`; the reel link is its `permalink`). No clip last week
means no clip brief; do not reach back further. When the calendar has no `videoClips` field, there
is no clip brief; say so in the run summary.

**Pre-voice-gate drafting checklist (run before Step 4, do not re-derive it per campaign).** The
voice gate caught these same two tells in 4/4 product paragraphs and both Emma intros on run 270;
they are avoidable at draft time:

1. **No mechanism or spec vocabulary in the narrative selling body.** "Ten settings", "ten modes",
   "the fourth setting", "steer it from a phone", "a deeper setting" belong in a spec block or a
   feature-bullet list, never in the desire-forward paragraph. Sell what the reader will feel, not
   how the toy works (charter: "sell the experience, never the mechanism").
2. **The Emma intro is plain-warm and makes no self-nature claim.** Emma never argues her own
   impartiality as a trust device — "no favorites of my own", "no body or favorite" is self-narration
   the charter bans unless the disclosure is load-bearing, and in a marketing email it is not. State
   only how she works. Reuse this canonical intro verbatim so the tell cannot re-enter per campaign:

   > I'm Emma. I work from the specs and the review patterns to help you find the fit.

## Step 4 — Voice gate (mandatory)

All subjects and body copy through `emma-empathy-reviewer` to a clean PASS.

## Step 5 — File the briefs

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"email","category":"other","kind":"campaign","suggestion":"<the full brief>","cxRisk":"low","runId":'$RUN_ID'}'
```

One `event` per brief.

## Step 5b — Execute approved briefs to Klaviyo drafts (valve-gated)

This step turns briefs the owner has **already approved** into Klaviyo **draft** campaigns plus an
owner review email. It never sends or schedules: creating a Klaviyo campaign leaves it in Draft, and
`app/lib/klaviyo-campaigns.server.ts` makes no send-job call. Gated by `email_campaign_push_enabled`,
which defaults **off**; with the valve off the script exits without touching Klaviyo or any ticket.

```bash
tsx scripts/push-approved-campaigns.ts
```

For each approved `kind:'campaign'` row on team `email`, the script creates a draft campaign
(audience resolved from the brief, subject and preview set, sender from `EMAIL_FROM`), emails the
owner a one-click review-and-send link, and records that link as a `note` on the ticket. It is
idempotent: a row that already carries a Klaviyo draft link is skipped, so re-runs never duplicate.
The full body copy travels in the owner email; finishing the template and hitting send stay manual
in Klaviyo.

## Step 6 — Retro

For executed briefs: UTM-attributed clicks/orders, profit deltas on featured SKUs → `decision`
events (`phase:'retro'`); real lessons → improvement suggestions. Flops reported plainly with
numbers.

## Step 7 — Spend + finish

Log tokens (`feature:'email-planning'`), then the final run update (briefs filed | segments | send
windows | retro verdicts).
