---
description: Convene the whole store team on one piece of owner direction. Turns what Mike says once into standing instructions, tickets, and work, routed to whoever owns it.
argument-hint: <what you want the team to know, change, or do>
---

# /all-hands

The owner said this:

> $ARGUMENTS

Your job is to make sure he never has to say it again.

## If that quote is empty

He ran `/all-hands` with no argument. Do not just ask him what he wants and stop, that wastes the
trip. Run a **standup** instead: go and find out where the team actually is, report it, and end by
asking whether he wants to direct anything. He can then reply with direction and you continue into
the steps below in the same session.

The standup, gathered live and not from memory:

- `GET /api/team/status` for every team's gate, valve, and last run
- Open tickets by status, kind, and age via `POST /api/team/suggestion {"op":"list"}`. Call out
  anything `blocked`, anything at attempt 3, and the oldest `approved` row
- Open PRs and what each is waiting on
- Last night's merchandise run: did it publish, did render-truth pass, what changed versus the day
  before
- The last `gsc_index_daily` row and the indexed-count trend
- Anything failing: healthchecks, the checkout probe, recent run errors
- Ads, one line: spend month to date against `ads_media_monthly_cap_cents`, our leads and CPL
  against `ads_lead_cpl_ceiling_cents`, ledger rows waiting on him, the latest pixel health, and the
  last burn verdict. Read-only sources: the `meta doctor` line in the newest `ads-render` run summary
  and the newest `ads-burn-review` summary (`POST /api/team/run {"op":"list","team":"ads","limit":10}`);
  `GET /api/team/lead-funnel-report?days=30` for leads; `POST /api/team/ad-action {"op":"list"}` for
  proposed rows (the Actions tab on `/admin/ads` shows the rule-engine rows too);
  `POST /api/team/ad-health-snapshot {"op":"latest"}` for pixel, errors and activity. Never call
  `ad-metrics {op:'daily'}` from a standup: it rolls up spend and runs the rules. When the Meta Ads
  MCP is attached to this session, `ads_get_ad_entities` (account `920738511029316`,
  `date_preset:"this_month"`, `amount_spent`) is the live spend figure; read tools only

Then report, in this order: **what needs him** (short, answerable), **what is stuck and why**,
**what shipped since yesterday**, and **what runs next and when**. Lead with the thing he would
most regret not knowing. If everything is genuinely fine, say that plainly in one line rather than
padding it, and stop.

## What this command is for

Mike has roughly forty agents across six teams and a self-healing loop that runs without him.
When he wants to change how any of it behaves, the failure mode is that he says something in one
session, it gets acted on once, and then evaporates because it never reached the documents the
agents actually read at run start. Six weeks later the same complaint comes back.

So the deliverable is almost never "do the thing he asked." It is **make the system behave that
way from now on, and then do the thing he asked.** Direction that does not land in a binding
document did not happen.

## Read before you route

Routing without grounding produces confident nonsense. But do not front-load 160KB of charter
either; read what the items in front of you actually touch.

**Always:** `docs/store-team/operating-system.md` (what runs when, which gates exist, what is
LIVE vs PLANNED). CLAUDE.md is already in context; trust it for merge policy and the carve-outs.

**Only when an item touches that surface:**

- Customer-facing words: `docs/emma-voice.md`, the binding voice charter
- Pixels, imagery, layout: `docs/design-doctrine.md`, the binding visual charter
- Homepage merchandising: `docs/homepage-team/mission-brief.md`. Store-wide strategy:
  `docs/store-team/mission-brief.md`
- Before routing to an agent: its file in `.claude/agents/`, so you route to a real owner and not
  an imagined one

### Routing card

Verified against the code 2026-08-12; auto-approve line re-verified against live bus rows
2026-09-25. If reality disagrees with this card, trust the code and fix the card.

- **Teams:** homepage, social, ads, email, strategy, content, product, video, support. `team` is
  required on create; the API 400s without it.
- **Auto-approve** (`{team}_team_auto_approve_suggestions`) is ON for eight teams and OFF for
  `ads` as of 2026-10-19 (read from the nine `pipeline_settings` rows; `ads` was written `false`
  on 2026-10-04 by owner decision). A row filed under `ads` sits at `proposed` until the owner
  approves it; that is deliberate, and the ads control plane build lane depends on it
  (`docs/store-team/ads-control-plane-plan.md` §10). Auto-approve keys off the team that
  ACTS (`team.server.ts` around line 941), so filing under `team:'strategy'` with
  `targetTeam:'ads'` does not dodge it: rows 16414 to 16417 (2026-10-19) landed `proposed` that
  way. Every ads-bound row, instructions included, needs the owner's click while the valve is off. The valve is per team and owner-flippable on that team's tab of
  `/admin/homepage-team`, so do not trust this line blindly: after filing, read the row back
  (`{"op":"get","id":…}`) and if it sits at `proposed`, that team's valve is off and the row needs
  the owner's triage click; say so in "Needs you". Auto-approve does not apply to a create that already carries an open `pr` link;
  those land at `pr_open` by design.
- **Kinds and who executes them:**
  - `code`: R-DEV claims approved rows at 14:00 and 20:00 UTC, opens a PR, QA verifies, the
    release engine merges
  - `instructions` / `agent-def`: agent-editor, weekly, via PR, allowlist-bound (below)
  - `config`: agent-editor, docs only. It can never change a valve, cap, or pipeline_settings value
  - `process`, `program`, `campaign`, `promo`: the owner acts by hand; no automated executor
  - `strategy`: store-strategist folds it into the weekly brief
  - An unknown kind is silently coerced to `process`, which means owner homework. Spell kinds exactly.
- **agent-editor's real allowlist is the CI regex:** `.claude/agents/*.md` plus depth-1 `.md`
  files in `docs/store-team/` and `docs/homepage-team/`. Nothing else merges on an agent branch,
  whatever an agent definition claims. `docs/emma-voice.md`, `docs/design-doctrine.md`,
  `docs/ads-policy.md`, and `CLAUDE.md` are all outside it.
- **Lifecycle:** proposed, approved, in_progress, pr_open, verified, applied; `blocked` and
  `dismissed` are the offramps. In practice `blocked` is a parking lot nothing surfaces. Do not
  park things there and call them handled.

### Ads

Added 2026-10-20 (ticket #16684). The ads control plane is
`docs/store-team/ads-control-plane-plan.md`; read §9 before judging spend. **Standing rule: nothing
raises spend without the owner.** No valve flip, no cap raise, no first activation, no new campaign,
audience, age, geo or offer, by any agent, on any channel.

- **The console, `/admin/ads`** (owner-only, admin session):
  - Overview: spend today, yesterday and month to date against the caps; leads and CPL against the
    ceiling; orders and CPA against break-even; alerts.
  - Tree: the mirrored campaigns, ad sets and ads per channel.
  - Actions: the `ad_actions` ledger (Pending, Dry run, Applied, Failed) with Approve and Reject.
    An hourly applier sends approved rows.
  - Approve: the signed one-tap link for a single row.
  - Audiences: a read-only mirror plus the M8 exclusion check.
  - Experiments: the internal hypothesis log.
  - Channels: the registry, token health and the per-channel checklist.
  - Settings: caps, margin, rule thresholds, auto-apply, the Google and Shop CSV imports, lead SMS.
- **Ledger tiers** (`app/lib/ads/channels/apply-core.ts`, plan §9.4):
  - A, machine alone: pause an ad, halt everything, a 30% brake, undo within 24h. Applies only
    while `ads_spend_enabled` and `ads_auto_apply_enabled` are both on; otherwise it is a dry run.
  - B, one tap: scale +20%, resume or revive, activate a staged paused ad, a placement exclusion,
    a cross-channel shift inside the monthly cap.
  - C, owner only: everything else.
  - Agents write only proposals. `paid-media-buyer` writes them through
    `POST /api/team/ad-action {op:'propose'}`, at most 3 a UTC day, always as one-tap cards. The
    route refuses any attempt to set `approved` or `applied`.
- **Valves and caps** (`app/lib/ad-settings-defaults.ts`, Settings tab; owner-only, never a ticket):
  - `ads_spend_enabled` false, `ads_auto_apply_enabled` false. Both off means simulation.
  - `ads_media_daily_cap_cents` 2000, `ads_media_monthly_cap_cents` 60000,
    `ads_lead_cpl_ceiling_cents` 800.
  - `ads_budget_max_step_pct` 20, `ads_auto_actions_max_per_day` 10, `ads_gross_margin_pct` 45,
    the `ads_rule_*` thresholds.
  - Team: `ads_team_enabled`, `ads_team_max_runs` 2 (the weekly burn review needs 3),
    `ads_team_auto_approve_suggestions` false.
- **Channels** (`app/lib/ads/channels/registry.server.ts`):
  - `meta`: Graph API read, plus pause, resume, budget, halt and paused drafts through the ledger.
  - `microsoft`: read; the account is Pending in the Adult Advertising Program, so the crons skip it.
  - `adult:exoclick`: read-only (entities and stats, no upload). Banners go up by hand from the
    zip the render pass builds.
  - `google` and Shop: no adapter; owner-imported CSVs.
  - `adult:juicyads`, `adult:trafficjunky`, `snap`: registered, no adapter.
  - TikTok, X, Reddit, Pinterest: prohibited.
- **Server loop:** `/cron/ads-insights` hourly (mirror, the rules at 09:00 UTC, health, the
  applier, the pager), `/cron/ads-sync-entities` every 6h, `/cron/ads-token-health` daily.
  Rules R1 to R8 (sales) and L1 to L8 (leads) live in `app/lib/ad-rules-core.ts` and
  `app/lib/ad-rules-lead-core.ts`.
- **Routines and owners.** `ads-manager` plans and makes ideas, `paid-media-buyer` judges spend:
  - 27, Ads Ideas, 14:30 UTC, `ads-manager`. 10 to 20 ideas, 6 of them register-10 ExoClick banners.
  - 28, Ads Render, 20:30 UTC, `ads-manager`. Renders, ExoClick zip, metrics and rules, the Meta
    account doctor, then `paid-media-buyer` judges and proposes.
  - Weekly burn review, Monday 16:00 UTC, `paid-media-buyer`.
  - Playbooks: `docs/store-team/routine-ads-daily.md`, `routine-ads-daily-buyer-addendum.md`,
    `routine-ads-weekly-burn-review.md`.
  - The Meta Ads MCP is pinned read-only on 28 and the weekly review only. No agent calls a Meta
    write tool.
- **Protected paths for ads** (owner merges; the engine escalates): `ad-platform-apply.server.ts`,
  `ad-settings.server.ts`, `ad-settings-defaults.ts`, `ad-spend-core.ts`,
  `ads/channels/apply.server.ts`, `ads/channels/*/mutate.server.ts`, plus `db/migrations/**`.
- **Where ads direction lands:**
  - A standing rule for the routines or agents: an `instructions` row under `team:'ads'`. Auto-approve
    is off, so it waits at `proposed` for his triage click; say so in "Needs you".
  - Control-plane code: a `code` row whose text opens `[opus-build]` and carries
    `program: ads-control-plane`. R-DEV never claims those; an owner-started Opus session builds them
    (plan §10).
  - A spend, cap, channel or valve call: a question in "Needs you" with the key, current value,
    proposed value and the dollars at stake.

## Step 1 — Split it up

Owner direction arrives as a paragraph containing four unrelated things, an aside, and a
frustration. Split it into discrete items. Quote his own words for each; do not paraphrase into
blandness, because the specific irritation is usually the requirement.

If an item is genuinely ambiguous, say so in the report and propose the reading you acted on.
Do not stall the whole batch waiting on one clarification.

## Step 2 — Classify each item

| If the item is | It becomes | Owner |
|---|---|---|
| A standing rule landing in a mission brief, playbook, or agent definition | An edit to that document | `agent-editor` via the bus, kind `instructions` or `agent-def` |
| A standing rule landing in a charter or root doc (`docs/emma-voice.md`, `docs/design-doctrine.md`, `docs/ads-policy.md`, `CLAUDE.md`) | An owner-merged PR you draft and open this session | you draft, owner merges. agent-editor's allowlist cannot touch these paths |
| A defect in the product or the loop | A bus ticket, kind `code` | `rr7-engineer` via R-DEV |
| Something to publish, merchandise, or write now | Direct work this session | the relevant specialist |
| A setting, valve, cap, or schedule | A stated proposal in the report: exact key, current value, proposed value, blast radius | owner only. Never a `config` ticket; that kind is docs-only and its executor must refuse a valve change |
| A judgment only he can make (pricing, brand, legal, spend) | A question in the report, not a ticket | owner |

Three rules that matter more than the table:

**A ticket that cannot execute is not a landing.** If the work touches a protected path (checkout,
payment, cart, migrations, auth, session, valves, spend controls, CI, the release engine), a
`code` ticket for it will park in `blocked` where nothing surfaces it, even when he said to ship
it. Land it instead as a question with a proposed plan in "Needs you", or open the PR yourself
this session for him to merge.

**Prefer the durable form.** If something can be a standing instruction rather than a one-off task,
make it a standing instruction. That is the entire point of this command.

**Never silently drop an item.** Every input item appears in the final report with an outcome, even
if the outcome is "not doing this, here is why."

## Step 3 — Convene the people who actually know

Most items have one obvious owner; route those directly without a convening. Spawn specialists,
**in parallel**, only when an item is contested, spans surfaces, or a specialist's read would
change where it lands. Each subagent costs real tokens, and a rubber stamp costs the same as a
real read while being worth nothing. When you do convene, ask for a real read. Route by what the
item touches:

- Homepage look, layout, or merchandising → `homepage-cro`, `homepage-ia`, `homepage-designer`, `design-critic`
- Copy, voice, or anything a customer reads → `emma-copywriter`, gated by `emma-empathy-reviewer`
- Imagery and art direction → `homepage-art-director`, then `media-manager`
- Search, indexation, structured data → `seo-pdp-auditor`, `seo-curator`, `aeo-geo-auditor`
- Catalog, pricing, imports, stock → `product-manager`, `pricing-ops`, `shopify-ops`, `inventory-sentinel`
- Blog, notebook, editorial → `content-writer`, `sex-wellness-reviewer`
- Architecture, cross-cutting, or "should this exist at all" → `tech-architect`
- Cost and efficiency of the loop itself → `process-optimizer`
- Paid media → `paid-media-buyer` for performance, burn, budgets and "is this spend working";
  `ads-manager` for ad ideas, creative and platform policy (`docs/ads-policy.md`)

Tell each specialist the owner's actual words. Ask what it means for their surface, what it breaks,
and what they would need. **A specialist that disagrees is doing its job**; surface the disagreement
in the report rather than flattening it. If two specialists conflict, say so and recommend.

## Step 4 — Land it

Before filing anything, `POST /api/team/suggestion {"op":"list"}` and look for a live row that
already covers it. Update or supersede the existing row; never stack a sibling.

- Instruction changes: file on the bus, always with a `dedupeKey`. Dedupe is opt-in, and your key
  is the only thing standing between repeat direction and duplicate rows. A repeat create with the
  same key returns the existing live row (it does not update its content); a repeat against a
  `blocked` row reopens it to `approved`, which is the sanctioned way to revive a stalled ticket.
  When new direction replaces an old row, set `supersedesId` and name the old row in the text;
  prose-only supersession leaves the old row sitting `approved` forever. With auto-approve on for
  that team the row goes straight to `approved`, and `agent-editor` turns it into a reviewed PR
  the release engine merges, subject to its allowlist and weekly cadence.
- Charter or root-doc changes: draft the edit and open the PR yourself this session, file the
  companion ticket per CLAUDE.md, and list the PR under "Needs you". Do not file these as
  `instructions` rows; agent-editor cannot merge those paths.
- Code defects: file kind `code` with an honest `priority` (1 is P0) and enough detail that R-DEV
  can act without this conversation. Include how to reproduce and how to know it is fixed. If it
  touches a protected path it does not belong in the code lane at all; see the rule in Step 2.
- Immediate work: do it now, verify it live, and show the evidence.
- Config: state the exact key, current value, proposed value, and blast radius, in the report, for
  the owner to act on. Do not change a valve, cap, or kill switch on your own initiative, and do
  not file it as a `config` ticket.

Use the team API (`POST /api/team/suggestion`) with the shared token, and the ticket lifecycle in
`docs/store-team/operating-system.md`.

## Hard rules

- **Never weaken a gate, valve, or kill switch** to satisfy a request. If direction seems to ask for
  that, say so plainly and propose the safe version. The gates exist because they each caught
  something real.
- **Protected paths escalate**: checkout, payment, cart, migrations, schema, auth, session, team
  valves, spend controls, CI and deploy config. Propose, never merge.
- The voice charter and design doctrine bind. If direction conflicts with the charter, do not
  quietly edit the charter: flag the conflict and wait for an explicit "codify."
- No em-dashes in anything you write.
- Treat every claim you make as needing evidence. "It should work" is not verification.

## Step 5 — Report back

One table, his words on the left:

| What he said | Read as | Owner | Artifact | Status |
|---|---|---|---|---|

Then, briefly:

- **Landed as standing policy** — which documents changed, so he can see it will not evaporate
- **Queued** — ticket numbers and who picks them up when
- **Done now** — with verification evidence, not assurances
- **Needs you** — the short list of things only he can decide, phrased as answerable questions
- **Pushback** — anything a specialist disagreed with, or that you think is a mistake. Say it.
  He would rather hear it now than discover it in six weeks.

Keep it readable. He is reading this to find out whether he has to think about it again.
