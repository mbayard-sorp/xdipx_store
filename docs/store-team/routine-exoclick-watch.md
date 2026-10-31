# Routine: ExoClick Campaign Watch (R-EXO)

Owner direction 2026-10-31, verbatim: "we are now running this exoclick campaign. Please continue to monitor and notify me if there are issues."

Trigger `trig_01WREZzWdEmXuRMPX5vKQVoq`, `20 */4 * * *` UTC. The trigger prompt holds the full instructions. This page records why it exists and what it may do. Keep the two in step.

## Limits

Read only, notify only. It never pauses, starts, edits or funds a campaign, never changes a price, and starts no team run row. Pausing stays the owner's call.

## What it watches

Campaigns 8774050, 8774052, 8774054, 8774056, 8774058 and 8774060 in group 367506. Combined cap $130, bid 75 cents CPM, daily limit $20 each.

| Issue | Trigger |
|---|---|
| Review | A rejected banner or campaign, or anything still pending after 2026-11-02 00:00 UTC |
| Funds | No Funds, or a balance under $10 while budget remains |
| Offer | Price not $69.99 or compare-at not $89.99, because the banners read 22% OFF |
| Product | Not active, or under 100 units |
| Landing | `curious.xdipx.com/gawk-gawk-3000` not returning 200 with $69.99 on the page |
| Settings | Bid not 75 cents, or total spend above $135 |
| Results | $50 spent with no ExoClick orders, $60 or more spent at over $23.67 per order, and one final notice when all budgets are spent |

$23.67 is the profit per order before ads, at $69.99 with $9.00 fulfillment. The target is $17.50 or less per sale.

## How the owner hears

Each issue is an `exoclick-watch-<issue>` owner blocker, with the blocker email forced when one is new or reopened. A clean run stays silent. The hourly ads pager also files rejected entities from the mirror.

## When the campaign changes

New campaign IDs, a new price or a new budget means updating the trigger prompt and this page. When the campaign ends, disable the trigger.
