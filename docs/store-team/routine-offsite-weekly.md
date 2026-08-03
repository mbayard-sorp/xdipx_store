# Routine: Weekly Off-site Scout (offsite-scout)

The playbook for the weekly off-site presence routine. Entry agent: `offsite-scout`.
**PROPOSE-ONLY**: researches the third-party roundups, listicles, and expert sources that search
engines and LLM answers cite for sexual-wellness shopping queries, drafts outreach the owner can
send manually, and files it all as suggestion rows. It never sends, never posts, never spends.

Why this exists: AI assistants route around the adult category on generic queries and surface
brands named in third-party editorial sources instead; Perplexity's merchant program excludes
adult toys. The winnable game is earning slots on the pages LLMs already trust, and no on-site
loop can do that.

Runs on the **Max subscription**, Tuesday 16:00 UTC under the **strategy** team (Tuesday avoids
the Monday strategy run so the 1-run/day cap holds). Auth: `x-team-secret: $TEAM_TOKEN` (falls
back to `$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Start + gate

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"strategy","runType":"offsite"}'   # → $RUN_ID

curl -s "$BASE_URL/api/team/gate?team=strategy&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` → post the skipped update and stop.

## Step 1: Load doctrine + context

1. `docs/ads-policy.md` in full (BINDING; its creative rules apply to outreach copy).
2. `docs/emma-voice.md` core (pitches are brand-voiced; Emma is an AI guide, never a human tester).
3. The strategy brief (`GET /api/team/brief`) and calendar (`GET /api/team/calendar`) for
   seasonal angles (gift-guide windows especially).
4. Published notebook posts (GROQ: published blogPost slugs + titles) — pitches point at real
   content. **Fewer than 5 published posts → note it, file only the summary row, and recommend
   waiting; thin pitches burn targets.**
5. The latest `gsc_snapshots` row (brand impressions, referral movement) and prior offsite
   suggestion rows (`POST /api/team/suggestion {"op":"list"}`) — never duplicate a pitch that is in
   ANY non-terminal status, not just `proposed`. Auto-approve writes new rows straight to `approved`,
   so a `proposed`-only check silently never matches and the same pitch is re-filed every week. Pass
   an undated `dedupeKey` per target domain so the bus enforces it too.
6. `docs/store-team/outreach-prospects.md` (owner-supplied, vetted guest-post targets), if present.
   Prioritize drafting pitches for its READY rows before researching new targets in Step 2; for rows
   already pitched, file an update-propose status note instead of a new pitch.

## Step 2: Target research

Web-search, at minimum: "best places to buy sex toys online", "best online sex toy stores 2026",
plus 3 category queries derived from the approved keyword bank's biggest clusters. For each
roundup/listicle that ranks or gets cited, record: publisher, URL, last-updated, submission or
affiliate path if visible, competitors listed. One `step` event with the target table.

Also pick 2-3 brands xdipx actually carries (Shopify vendor field is the source of truth) and find
their partner/affiliate/where-to-buy/stockist pages and marketing contact.

## Step 3: Proposals (ceiling of 6 suggestion rows per run, not a target)

For the 3-5 strongest targets, one suggestion row each:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"strategy","category":"other","kind":"strategy","suggestion":"OFFSITE PITCH — <publication>: <target URL> | contact: <path> | angle: <one line> | draft: <the full pitch copy> | policy note: <category + why compliant>","cxRisk":"low"}'
```

Pitch rules: honest differentiators only (editorial curation, answer-shaped guides, discreet
XDIPX billing, discreet shipping); no prices or discounts (MAP); no medical claims; never imply
human product testing; ready to send from hello@xdipx.com with zero edits.

Also propose, when found: unlinked-mention reclamations and expert-quote / creator-collaboration
prospects (same row format, angle-labeled), and brand-partner pitches for the brands identified
above (who xdipx is, that we carry and editorially feature their products, and an ask to be listed
as a stockist or included in their where-to-buy, or a reciprocal link or social mention) — same row
format and the same policy note as OFFSITE PITCH rows, still propose-only.

## Step 4: Summary + finish

One `decision` **event** (`phase:'retro'`), never a suggestion row: targets reviewed, pitches filed,
movement since last run (new citations spotted in search results, prior pitches landed/dismissed),
and the single highest-leverage next step. A summary is a report, and reports do not go on the bus
(see the intake doctrine in `improvement-loop.md`). This step filed a `process` row every week into
a kind with no executor, which is how the owner-decision lane grew faster than anyone could read it.
Log spend (feature `strategy-offsite`), then finish the run with an
honest summary.

## Appendix: Enablement

No new valve: the strategy team's existing kill switch and budget govern this routine, and it is
propose-only by construction. To enable: create the cloud trigger (routine #11 in
`docs/store-team/routine-schedule.md`) and confirm the strategy team is enabled. The owner
executes approved pitches manually from hello@xdipx.com; nothing is ever sent by the routine.
