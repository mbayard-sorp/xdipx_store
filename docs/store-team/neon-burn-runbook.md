# Neon burn runbook

Owner direction, 2026-11-27, verbatim: "We need to only spend what is required to keep the site
alive and functioning. When /all-hands team sees extra burn where there was not before, we need to
do something about it or we are wasting money."

This is binding on every team. Database compute is a cost line like ad spend, and new burn is a
defect with an owner, not background noise.

## How Neon bills us

Neon charges for the hours the compute is awake. It suspends after about five minutes with no
queries and wakes on the next one. So the bill is set by **how often something touches Postgres**,
far more than by how heavy any one query is. A cheap query every four minutes costs a full day of
compute. A heavy job that runs once a day and finishes in two minutes costs almost nothing.

On 2026-11-27 the compute had not suspended once in seven days. The fixes that shipped that day:
PR #2070 (product pages cache empty co-purchase results), PR #2071 (recurring crons aligned on the
quarter hour, warm skips identical payload writes, the support-inbox valve is cached), PR #2072
(the GSC sitemap refresh only writes changed rows).

## The detector

`/cron/neon-burn-watch`, daily at 12:45 UTC (`app/lib/neon-burn.server.ts`, math in
`app/lib/neon-burn-core.ts`). It runs on a minute the compute is already awake, keeps its snapshot
history in KV, and writes nothing to Neon. It files a deduped `code` ticket (team strategy,
category `cost`, P2) per finding:

| Dedupe key | Fires when | Signal |
|---|---|---|
| `neon-burn:never-idle` | the compute has not suspended in 24h | `now - pg_postmaster_start_time()` |
| `neon-burn:activity-jump` | a day's table activity is 1.5x the prior-week median | `pg_stat_user_tables` reads + rows written, diffed daily |
| `neon-burn:billed-jump` | billed active hours are 1.3x and 3h over the prior-week median | Neon API `active_time_seconds`, only when `NEON_API_KEY` and `NEON_PROJECT_ID` are set |

Each ticket names the tables driving the latest day, with each table's own baseline, and marks
tables that were idle the week before as NEW. Check the current reading any time with
`GET /cron/neon-burn-watch?dryRun=1` (cron secret), which assesses without saving or filing.

## Finding the cause

1. **Start with the ticket's top tables.** A table marked NEW or far over its baseline is usually
   the answer. Find every writer and reader with `grep -rn "<tableName>" app/ server/`.
2. **Check what cadence touches it.** `vercel.json` `crons[]` and `app/lib/cron-expectations.ts`.
   Any job on a minute other than :00, :15, :30, :45 adds its own wake. A job every 5 to 10
   minutes keeps the compute awake by itself.
3. **Check for a page loader without a cache.** Storefront traffic is legitimate burn; a loader
   that queries on every render because its cache never stores the empty case (the #2070 bug) is
   not.
4. **Check for unconditional writes.** An upsert that rewrites identical rows on every run (the
   #2072 bug), or a per-invocation bookkeeping insert, keeps WAL and the compute busy.
5. **Read-only queries only** while diagnosing. Never run DDL or writes against production.

## Fixing it

Prefer, in order: skip the work when nothing changed (content hash, `IS DISTINCT FROM`), cache
the read in KV including the empty answer, move the job onto a quarter-hour minute, lower its
cadence, move bookkeeping from a Neon row to a KV heartbeat. Ship it as a normal PR on the ticket.

## Never do these

- Do not change the Neon autoscaling range, the suspend timeout, or the plan. Those are owner-only
  money settings.
- Do not weaken a gate, a healthcheck, or the checkout probe to save compute. A probe that keeps
  the site honest is required spend.
- Do not dismiss a `neon-burn:*` ticket without writing down why the burn is required. The watch
  re-files a recurring key the next day if the condition still holds.
