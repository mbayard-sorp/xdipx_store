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

Do not skip this. Routing without it produces confident nonsense.

- `docs/store-team/operating-system.md` — what runs when, which gates exist, what is LIVE vs PLANNED
- `docs/store-team/mission-brief.md` and `docs/homepage-team/mission-brief.md` — the binding briefs
- `docs/emma-voice.md` — the voice charter, binding on every customer-facing word
- `docs/design-doctrine.md` — binding on every pixel
- `CLAUDE.md` — repo rules, merge policy, the carve-outs
- `.claude/agents/` — the roster, so you route to a real owner and not an imagined one

## Step 1 — Split it up

Owner direction arrives as a paragraph containing four unrelated things, an aside, and a
frustration. Split it into discrete items. Quote his own words for each; do not paraphrase into
blandness, because the specific irritation is usually the requirement.

If an item is genuinely ambiguous, say so in the report and propose the reading you acted on.
Do not stall the whole batch waiting on one clarification.

## Step 2 — Classify each item

| If the item is | It becomes | Owner |
|---|---|---|
| A standing rule, preference, or "stop doing X" | An edit to a mission brief, playbook, charter, or agent definition | `agent-editor` via the bus, kind `instructions` or `agent-def` |
| A defect in the product or the loop | A bus ticket, kind `code` | `rr7-engineer` via R-DEV |
| Something to publish, merchandise, or write now | Direct work this session | the relevant specialist |
| A setting, valve, cap, or schedule | Config change, stated explicitly for approval | owner, or `config` ticket |
| A judgment only he can make (pricing, brand, legal, spend) | A question in the report, not a ticket | owner |

Two rules that matter more than the table:

**Prefer the durable form.** If something can be a standing instruction rather than a one-off task,
make it a standing instruction. That is the entire point of this command.

**Never silently drop an item.** Every input item appears in the final report with an outcome, even
if the outcome is "not doing this, here is why."

## Step 3 — Convene the people who actually know

For anything non-trivial, spawn the relevant specialists **in parallel** and ask for a real read,
not a rubber stamp. Route by what the item touches:

- Homepage look, layout, or merchandising → `homepage-cro`, `homepage-ia`, `homepage-designer`, `design-critic`
- Copy, voice, or anything a customer reads → `emma-copywriter`, gated by `emma-empathy-reviewer`
- Imagery and art direction → `homepage-art-director`, then `media-manager`
- Search, indexation, structured data → `seo-pdp-auditor`, `seo-curator`, `aeo-geo-auditor`
- Catalog, pricing, imports, stock → `product-manager`, `pricing-ops`, `shopify-ops`, `inventory-sentinel`
- Blog, notebook, editorial → `content-writer`, `sex-wellness-reviewer`
- Architecture, cross-cutting, or "should this exist at all" → `tech-architect`
- Cost and efficiency of the loop itself → `process-optimizer`

Tell each specialist the owner's actual words. Ask what it means for their surface, what it breaks,
and what they would need. **A specialist that disagrees is doing its job**; surface the disagreement
in the report rather than flattening it. If two specialists conflict, say so and recommend.

## Step 4 — Land it

- Instruction changes: file on the bus with a clear `dedupeKey` so repeat direction updates the
  existing row instead of stacking duplicates. With auto-approve on for that team they go straight
  to `approved`, and `agent-editor` turns them into a reviewed PR the release engine merges.
- Code defects: file kind `code` with an honest `priority` (1 is P0) and enough detail that R-DEV
  can act without this conversation. Include how to reproduce and how to know it is fixed.
- Immediate work: do it now, verify it live, and show the evidence.
- Config: state the exact key, current value, proposed value, and blast radius. Do not change a
  valve, cap, or kill switch on your own initiative.

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
