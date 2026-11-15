# Routine: ExoClick Campaign Watch (R-EXO)

Owner direction 2026-10-31, verbatim: "we are now running this exoclick campaign. Please continue to monitor and notify me if there are issues."

Trigger `trig_01WREZzWdEmXuRMPX5vKQVoq`, `20 */4 * * *` UTC. The trigger prompt holds the full instructions. This page records why it exists and what it may do. Keep the two in step.

## Limits

Brakes only, through the site. Since 2026-11-15 it runs `exoclick-brakes` with `dryRun` false on every run, so it can pause a dead campaign, block a dead site and lower a budget, then report. It never resumes or creates a campaign, never raises a budget or a bid, never uploads a banner, never adds funds, never changes a price or a setting, and starts no team run row. If the op reports `operatorEnabled` false, the routine goes back to read only and notify only.

## Brakes (ticket #19412, on since 2026-11-15)

The site now has a write path for ExoClick, and the routine can pull brakes through it without holding the key. The owner approved both settings on 2026-11-15, verbatim: "Approved add true and 17000". `exoclick_operator_enabled` is `true` and `exoclick_total_cap_cents` is `17000` ($170), written with actor `owner` in `settings_audit_log`. Setting the first back to `false` returns the routine to notify-only. The cap bounds anything that can raise spend.

- `POST /api/team/ad-metrics {op:'placements', campaignIds, dateFrom, dateTo}` reads per-site stats live, paged to the end, plus the account balance.
- `POST /api/team/ad-metrics {op:'exoclick-brakes', campaignIds, dryRun}` runs the kill rules and applies the brakes. `dryRun` defaults to true. Rules and thresholds are named constants in `app/lib/ads/channels/exoclick/kill-rules-core.ts`.
- Brakes are pause, block a site (additive only) and lower a budget. Gas (resume, create, raise a budget, upload a banner) is not exposed to the routine at all.
- Pass `arrivals` (a total, or an object of campaign id to count) from GA4 sessions when the routine has them. Without it the arrivals rule is skipped.

## What it watches

Campaigns 8774050, 8774052, 8774054, 8774056, 8774058 and 8774060 in group 367506. All six have been paused since 2026-11-02 at $27.66 spent. Any other campaign that appears in the mirror is watched too. The account cap is $170. It reads ExoClick through the site's mirror (`team/ad-metrics` op `channel`), because the cloud environment deliberately has no ExoClick key. Entities refresh every 6 hours and spend hourly. The brakes op returns the account balance, and the routine flags it under $20 while a campaign is running.

| Issue | Trigger |
|---|---|
| Review | A rejected banner or campaign, or anything still pending after 2026-11-02 00:00 UTC |
| Funds | A campaign showing No Funds |
| Offer | Price not $69.99 or compare-at not $89.99, because the banners read 22% OFF |
| Product | Not active, or under 100 units |
| Pulse Solo | Price not $119.99, a compare-at present, under 40 units, or `curious.xdipx.com/pulse-solo` not returning 200 with $119.99 |
| Landing | `curious.xdipx.com/gawk-gawk-3000` not returning 200 with $69.99 on the page |
| Settings | Total spend above $135 |
| Blind spot | The mirror missing the campaigns after 2026-11-01 12:00 UTC, or more than 13 hours stale |
| Results | $50 spent with no ExoClick orders, $60 or more spent at over $23.67 per order, and one final notice when all budgets are spent |

$23.67 is the profit per order before ads, at $69.99 with $9.00 fulfillment. The target is $17.50 or less per sale.

A Results notice is a prompt to check traffic first, never a verdict on the product. The order of checks and the 300-arrival bar are in `sales-pages.md`, "Reading a paid test".

## Runaway impressions

Owner direction 2026-11-01 and again 2026-11-15, verbatim: "You have to watch for runaway impressions with no clicks." Ticket #19413.

Every run reads impressions and clicks per campaign and per banner from the mirror and raises an issue when any of these holds:

| Issue | Trigger |
|---|---|
| Dead banner | A banner with 5,000 impressions and no clicks |
| Dead campaign | A campaign with 20,000 impressions at under 0.03% CTR |
| Dead placement | A site or zone with 2,000 impressions and no clicks, or 5,000 at under 0.02% CTR |
| Runaway pace | A campaign that spent more than $5 since the last hourly read |

Dead placement is read live by the brakes op, which pages every site. A block that names a site already on the campaign's list is skipped and reported as such (PR #1976). The first live run, 2026-11-15, found the 11 round-one sites already blocked on all six campaigns and sent nothing.

While a test cell is live the trigger runs hourly for the first 24 hours, then every 4 hours. The thresholds and the actions that follow them are in `exoclick-program.md`, section 5. The routine applies the brakes first and reports after. Anything the rules wanted but the site cannot do yet comes back under `unsupported` and is filed for the owner; pausing a single banner is one of those. Runaway pace is checked only where the data shows hours; otherwise the closing line says pace was not checked.

## How the owner hears

Each new issue sends a phone push and files an `exoclick-watch-<issue>` owner blocker. Push is the alert that reaches him: `owner_queue_enabled` is on (owner, 2026-09-02), so the blocker email reports `suppressed`, as it did on the first test run. A clean run stays silent. The hourly ads pager also files rejected entities from the mirror.

Known limit: `op: list` returned exactly 50 open blockers on 2026-10-31 and left out a row filed minutes earlier, so the routine may not see its own rows to clear them. Re-filing a key stays deduped.

## When the campaign changes

New campaign IDs, a new price or a new budget means updating the trigger prompt and this page. When the campaign ends, disable the trigger.
