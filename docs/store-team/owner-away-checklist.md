# Owner away: the pre-departure checklist

The estate is built to run without the owner except for cost decisions (operating-system.md §7).
A few things still need a human before any absence of more than a couple of days, because they
expire, run dry, or have no automatic actuator. Owner email is not an actuator while he is away:
`owner_queue_enabled` withholds every alert class except `money-path-down` and `storefront-down`,
and SMS paging is off by owner decision (2026-09-02).

First written for the 2026-10-03 to 10-12 absence (owner direction 2026-10-02: "the site and all
the automations will be left unattended"). Measurements below are from that day. Re-measure, do not
quote them.

## Before leaving (owner only)

1. **Instagram token.** `IG_GRAPH_ACCESS_TOKEN` is a 60-day token and nothing renews it until
   ticket #13153 ships. Refresh it while it is still valid (a lapsed token can only be regenerated
   in the Meta dashboard):
   `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<token>`.
   If the returned token differs, set it in Vercel and redeploy.
2. **Prepaid balances.** Each one gates a lane, and a gate that cannot run fails closed, so the lane
   goes quiet rather than shipping. None of these balances is readable by any agent.
   - Anthropic API (console.anthropic.com, the account behind `ANTHROPIC_API_KEY`, not the Max
     plan). Turn on auto-reload. Burn is in `api_token_log` (`select ts::date, sum(est_cost_usd)
     from api_token_log group by 1 order by 1 desc limit 7`); keep at least the absence length
     times the daily burn, plus margin.
   - Atlas Cloud (primary image provider). Top up.
   - X API credits and fal.ai (fallback image tier).
3. **Max plan weekly limit.** Every cloud routine bills to it, and with extra usage off, hitting
   the cap stops every routine until the reset. Check the usage card. If more than half is gone
   with more than half the window left, enable extra usage with a hard cap or reduce routine load.
4. **Customer email.** Nothing reads hello@xdipx.com (`support_inbox_enabled` is unset), while the
   site promises same-day replies. Set a Zoho auto-reply with the return date.
5. **Protected-path PRs and owner queues.** Merge or close every `needs-owner` PR. Clear the
   pricing approval queue (price rises over 80% wait for the owner, which can leave a SKU selling
   below cost).
6. **Valves for the absence** (owner decides; agents never write `pipeline_settings`):
   `outreach_send_enabled` (cold pitches go out and replies land in the unread inbox),
   `instagram_autopublish_enabled` and `x_autopublish_enabled` (keep on only if the token step
   above is done), `release_engine_enabled` (on is the design; the circuit breaker is the
   fail-safe).
7. **Paid channels and cards.** Confirm a budget cap on anything spending (Shop Campaigns runs in
   Shopify admin, invisible to every agent) and that cards on file will cover invoices due during
   the absence (Vercel bills on the 11th).
8. **Backups.** Confirm last night's `/cron/db-backup` row succeeded. As of 2026-10-02 no dump has
   ever succeeded (owner blockers #77 and #73), so recovery is Neon point-in-time restore only.

## What fails safe (no action needed)

| Event | What happens unattended |
|---|---|
| A merged PR breaks the site | Post-deploy smoke fails, the previous build is re-promoted, a revert PR opens |
| Two rollbacks in one UTC day | Circuit breaker turns the engine off; production stays on the last good build |
| Homepage content breaks | The 30-minute healthcheck rolls Sanity back to last-good |
| A gate cannot run (no credit, provider refusal) | The lane publishes nothing that day |
| Video, email campaigns, outreach pitches | Wait for the owner by design |

## What has no actuator (why the list above exists)

| Failure | Detector | Without the owner |
|---|---|---|
| Instagram token lapses | none before it lapses | Instagram dark until he returns |
| A prepaid balance hits zero | none until #13154 ships | the dependent lane goes quiet |
| Checkout breaks for a non-deploy reason | HTTP probe every 6h, browser probe daily | email, plus a P0 ticket R-DEV may fix once PR #1475 merges |
| Engine halted (circuit trip or a deploy that never builds) | cron_runs only | nothing merges until he returns |
| A paid order never ships | none until #13155 ships | found when the customer writes in |
| A customer emails hello@ | none | answered when he returns |

## Quick health read before leaving

- `GET https://xdipx.com/api/team/status` with the team bearer: `health.cronsFailing` and
  `health.cronsSilent` empty, every team's `lastRun` on cadence, and `owner.entries` for anything
  marked P1.
- `GET https://xdipx.com/cron/release-engine?dryRun=1` with `x-cron-secret`: should report open PRs
  evaluated and nothing stuck.
- Open PRs: `gh pr list`; anything labelled `needs-owner` is his.
