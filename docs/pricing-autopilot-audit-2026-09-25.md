# Pricing audit against the owner's autopilot vision

**Date:** 2026-09-25
**Status:** Audit + recommendation. Nothing in this document changes behavior; the work plan in §5 is the set of tickets that would.
**Sources:** code on `main` at cf80b80, the live `pricing_audit_log` / `pricing_rules` / `pipeline_settings` / `nalpac_price_history` tables, and a 300-product sample pulled from the Shopify Admin API on 2026-09-25 (read-only everywhere).

---

## 1. The vision, restated as rules the engine can hold

Owner direction, 2026-09-25:

1. Products are imported and enriched by the enrichment routine.
2. Nalpac updates inventory and cost in Shopify throughout the day.
3. Margin rules per product group live in `/admin/pricing`.
4. Our sell price follows the Nalpac cost through those rules, with no approval step. Configuring the rules **is** the approval; editing a rule changes the math for that group.
5. MAP applies only to **Lovense** and **Playground**. Everything else can be sold at any price. MSRP is irrelevant.
6. A discontinued Lovense/Playground item may go below MAP, priced by the discontinued margin.
7. Show the customer a discount off the **price the item launched at on xdipx**, not off MSRP: a $50-cost item launched at $100; when Nalpac cuts the cost to $15 the new price is lower and the badge reads "X% off $100".

## 2. What actually happens today (verified)

### 2.1 Cost path: works, once a day

- The **Nalpac Integration** app is installed and writes Shopify `inventoryItem.unitCost`. In the 300-product sample, unit cost matched today's Nalpac feed wholesale on 265 of the 274 SKUs the feed still carries, and the inventory item was updated more recently than our own `wholesale_cost` metafield on 43 of them. Example: SKU 96201, unit cost 29.99 (feed 29.99), metafield still 40.00 from import.
- The v2 engine reads `unitCost` first and the metafield only as a fallback (`app/lib/pricing-apply-v2.server.ts:301`). So cost changes **do** reach pricing.
- They reach it only at the 07:00 UTC batch (`vercel.json`, `/cron/pricing-batch-recompute`). The registered `PRODUCTS_UPDATE` webhook only purges caches (`server/webhooks.ts:504`); nothing reprices on a cost change. Worst-case lag is 24 hours.
- The "Real-time Nalpac Webhook" card on `/admin/pricing` (`/api/webhooks/nalpac/cost-change`) has **no caller anywhere**. Nalpac never calls it. It also runs the retired v1 engine and writes to `pricing_changes`, a table the admin page never reads (ADR-007). It is dead UI.
- The WS3 cost-sync module (`pricing_costsync_enabled`, on since 07-30) only fires on a wholesale or MAP **drop of 10% or more** and then writes the metafield and calls `recomputeVariant`. It has synced 10 SKUs ever (9 on 09-23). Because the engine prefers `unitCost`, the metafield it writes is mostly ignored. It is redundant with the Nalpac app.

### 2.2 Rules: work as designed

- 9 groups, 29 sub-groups, 86 mapped product types, resolved product_type → sub_group → group → global (`pricing-rules.server.ts`). Live targets: most groups 45% target / 28-30% floor, lubes 35/25, accessories 40/25, discontinued 50/30.
- 59 product-type rule rows exist with every field null (noise from the CSV import; harmless).
- Editing a rule does **not** trigger a recompute. The change waits for the next 07:00 batch. `api.pricing.run-now` exists but has no lock and no time budget and can clobber the day's batch cursor.
- The velocity modifier is on for `lubes_topicals` and `discontinued`: zero sales in 60 days with stock ≥ 5 is "dead" and shifts the target down 10 points. This is a real pricing rule that is invisible on the rules card (it shows as a toggle, not as a number).

### 2.3 Gates: this is where "stuck in approval" comes from

Approval mode is `aggressive` with the auto-apply threshold raised to **80%**, so the delta gate almost never fires. What fires instead:

| Cause | Pending rows | Distinct variants | What it is |
|---|---|---|---|
| "MSRP ceiling holds sell below the margin floor; needs an MSRP decision" | 1,239 | | The engine caps every non-MAP product at the `xdipx.original_price` metafield (Nalpac MSRP at import time). When that number is below cost ÷ (1 − floor) the row is queued. Examples: SKU 70983 cost 45.00, stored MSRP 20.00; SKU 94525 cost 187.50, stored MSRP 64.00. |
| "Velocity: dead → target −10pp" | 1,175 | | Same root cause. These are lubes whose dead-velocity price is capped by the same stale MSRP below the floor; the rationale template just prints the velocity line first. |
| Discontinued clearance ladder | 36 | | Ladder price over the 80% delta. |
| **Total** | **2,450** | **117** | 2,392 of the 2,450 are price **drops** waiting for a click. |

Two compounding defects:

- The batch writes a **new** pending row for the same variant every day and the prune never deletes pending rows. 117 variants have become 2,450 rows; the oldest is from 09-05.
- `original_price` (MSRP) is written once at import and **never refreshed**. In the sample it disagreed with today's feed on 18 of 274 carried SKUs; SKU 97481 shows a $18.99 strike-through while Nalpac's MSRP is now $9.99. Since the storefront's "% off" badge and Shopify `compare_at_price` are both derived from that metafield, the stale number is customer-visible.

Other silent gates found in code review: items whose computed price is under $2.99 return before any audit row is written (never priced, never queued); `approve-all` and `edit-approve` write to Shopify with no MAP or floor check.

### 2.4 Discontinued: the ladder never descends, and the sweep archives sellable stock

- Group membership is `productType === 'Discontinued'` (`pricing-apply-v2.server.ts:330`). That type is only ever assigned at import from Nalpac's category. A product that is discontinued **after** import keeps its old type and its old group, so a discontinued Lovense item stays MAP-pinned and never clears. Vision item 6 cannot happen today.
- `daysDiscontinued` comes from the `xdipx.discontinued_at` metafield. **Nothing writes it** (0 of 300 in the sample). Every one of the 1,501 discontinued variants is on day 0 → the 15% step, forever. The 25/35/50% steps are unreachable.
- The nightly `/cron/discontinued-sweep` (23:45 UTC) **archives** any carried product the feed flags discontinued, with no stock check (`feed-processor.server.ts:359-425`). Archiving drops it from the storefront. The clearance ladder and the sweep are in direct conflict: one wants to sell the stock down, the other removes it from sale.
- Yesterday at 16:15 UTC the discontinued group rule was edited (now 50% target, 30% floor, velocity on). This morning's batch moved 1,448 discontinued prices, 1,447 of them **up**, by an average of 24.5%. The binding constraints were the new 30% floor for dead-velocity items and the day-0 15% ladder step for the rest. That is the engine doing what the rules say, but it is worth knowing it happened.

### 2.5 The discount the customer sees

- `compare_at_strategy` is `msrp` everywhere (there is no UI control for it; it can only be changed by CSV). 8,051 of 8,181 priced variants currently carry an MSRP strike-through, so the site is already discount-heavy, but the anchor is a number we do not control and do not refresh.
- There is **no launch-price or first-sold-price anywhere**: not in Shopify, not in `pricing_audit_log` (30-day retention on skipped rows), not in `nalpac_price_history` (one upserted row per SKU). Vision item 7 has no data to stand on yet.
- MAP brands: `pricing_map_brands` defaults to Lovense + Playground, and the PDP hides the discount badge when `map_restricted` is true (`app/lib/discount-badge.ts`). This part already matches the vision. The list is DB-only, not editable in the admin.

### 2.6 Dead weight

- v1 engine (`pricing-engine.server.ts`, `pricing-apply.server.ts`, `pricing-webhook.server.ts`, `api.pricing.approve.tsx`, the webhook admin card, `pricing_changes` table). No caller, confirmed empty-ever. Tracker row `p2-9-pricing-converge` is due 2026-09-28 and not started.
- `map_restricted` metafield is fetched by v2 and dropped (ADR-007 decision 3, still open).
- UI global defaults (45/20) disagree with engine defaults (50/25).

## 3. Gap table

| Vision | Status | Root cause |
|---|---|---|
| 1. Import + enrich | Works | none |
| 2. Nalpac updates cost in Shopify | Works | Nalpac app writes `unitCost`; engine reads it |
| 3. Group margin rules in `/admin/pricing` | Works | Rule edit does not recompute until 07:00 |
| 4. Price follows cost, no approvals | **Half** | MSRP ceiling queues every drop it touches; queue duplicates daily; 24h lag; no reprice on rule save |
| 5. MAP only for Lovense/Playground, MSRP ignored | **Half** | MAP part done; MSRP is still a hard ceiling and the strike-through anchor for every product |
| 6. Discontinued may go below MAP | **No** | Discontinued is a product type set at import, not a state; ladder stuck at day 0; sweep archives instead of clearing |
| 7. Discount off the xdipx launch price | **No** | No launch price is recorded anywhere |

## 4. Target design: pricing autopilot

One engine (v2), one rule set, no queue.

**Inputs per variant:** `unitCost` (Nalpac app, authoritative), vendor, product type, `discontinued_at`, `launch_price`, MAP (only consulted for vendors on the MAP list).

**Price:**

```
target = cost / (1 − target_margin)          (velocity shift applies if the group enables it)
floor  = cost / (1 − margin_floor)
sell   = max(target, floor)
if vendor ∈ MAP brands and not discontinued: sell = max(sell, MAP)
if discontinued: sell = max(target × (1 − ladder[days]), floor)   ; MAP not consulted
sell   = .99-rounded, re-clamped to floor (and MAP where it applied)
```

No MSRP anywhere in that formula. MSRP stays available as an informational column and for surfaces that legally need it (GMC feed), nothing else.

**Compare-at / badge:**

```
launch_price = the sell price written the first time the product went ACTIVE on xdipx
compare_at   = launch_price  if sell < launch_price × (1 − minimum badge %)  else null
badge        = round((launch_price − sell) / launch_price)  "% off"
```

For MAP brands the badge stays suppressed as it is today. When the owner deliberately raises a price above its launch price, the launch price resets to the new price (so a strike-through is never below the current price and never grows on its own).

*Reference-price note:* a strike-through must be a price the item was genuinely offered at for a reasonable period. A recorded launch price that the product actually sold at is a stronger basis than a manufacturer's MSRP we never verified, so this design lowers, not raises, that exposure. Keep the rule "launch price = a price we actually charged" strict; never backfill it from MSRP.

**Statuses:** `auto_applied`, `skipped_no_change`, `error`. `pending` and `rejected` go away. Anything that would have been rejected (floor or MAP violation) is impossible by construction because the clamps run before the write. A daily digest email replaces the queue: every change over a configurable % (say 25%) and every error, one line each, no click required.

**Triggers:** (a) `PRODUCTS_UPDATE` webhook → `recomputeVariant` for that product when `unitCost` changed, so a Nalpac cost change reprices within minutes; (b) rule save → bounded recompute of that scope, locked; (c) the 07:00 batch as the backstop for anything missed.

**Discontinued as a state, not a type:** the daily feed diff sets `xdipx.discontinued_at` the first day a carried SKU is flagged discontinued (and clears it if the flag disappears). Group resolution checks `discontinued_at` first and routes to the discontinued rules regardless of product type. The ladder (days → % off) becomes editable on the discontinued group's card. The sweep archives only when Nalpac quantity is 0 **and** our Shopify inventory is 0 (or N days at zero), so stock is sold down instead of hidden.

## 5. Work plan (ordered; each line is one ticket / PR)

Each is small enough to ship on its own and each one removes a class of manual work.

1. **SHIPPED in this PR.** **Drop the MSRP ceiling and the `msrpBelowFloor` pending path** (`pricing-engine-v2.server.ts` `computePrice`, `decideStatus`). Add `pricing_msrp_ceiling_enabled` defaulting to `false` so it is a valve, not a code flip. DONE WHEN: the next batch auto-applies the 117 queued variants and no row is written with a "needs an MSRP decision" rationale.
2. **SHIPPED in this PR** (flip `/admin/pricing` to Autopilot to turn it on). **Autopilot approval mode.** Add `autopilot` to `pricing_approval_mode`: `decideStatus` never returns `pending`; the $2.99 floor case writes an audit row and prices at the floor instead of returning early. Add the daily digest email (reuse the owner-email path the cron alerting already uses). DONE WHEN: a full batch day writes zero `pending` rows and the owner receives one digest.
3. **SHIPPED in this PR** (the 2,450 rows close on the next batch as each variant is re-priced). **Supersede the existing queue and stop duplicates.** One-shot: mark the 2,450 pending rows `superseded`. Ongoing: at most one open pending row per variant (upsert), and prune superseded rows with the others. DONE WHEN: `count(*) where status='pending'` is 0 and stays ≤ distinct variants.
4. **SHIPPED in this PR.** **Reprice on rule save and on cost change.** Rule and ladder saves and the admin Run button now kick the cron endpoint (locked, budgeted, self-continuing) with `trigger: manual`. A new `/webhooks/inventory-item-updated` route (topic `inventory_items/update`, throttled 5 min per item) reprices the variant when the Nalpac app writes a new cost. Post-merge step: register the topic (`scripts/register-shopify-webhooks.ts --apply`, or the same mutation by hand) once the deploy is live. Rule save → `recomputeCatalog` scoped to the group, with the same KV lock and budget as the cron; `PRODUCTS_UPDATE` handler → `recomputeVariant` when `unitCost` differs from the last audit row's cost. Fix `run-now` to use the lock and budget. DONE WHEN: editing a group's target changes that group's prices within the same hour; a Nalpac cost change reprices without waiting for 07:00.
5. **SHIPPED in this PR.** **Discontinued as a state.** The nightly sweep now derives it from feed absence (`discontinued_grace_days`, default 3; feed-flagged rows immediate), writes `xdipx.discontinued_at` once, clears it if the SKU returns, routes the product to the discontinued group's rules regardless of product type, lifts MAP for it, and archives only when every variant is at zero stock in every location (owner decision 2026-09-25). The ladder is editable on `/admin/pricing` (`pricing_clearance_ladder`). Feed diff writes/clears `xdipx.discontinued_at`; `resolvePricingConfig` routes on it before product type; `map_behavior` for the discontinued group stays `ignore_map` and `enforceMapFloor` is skipped for discontinued; the sweep only archives at zero stock on both sides; ladder editable in the admin. DONE WHEN: a Lovense item flagged discontinued by the feed prices below MAP on the next run, `daysDiscontinued` advances daily, and no in-stock product is archived by the sweep.
6. **SHIPPED in this PR** (capability; the per-group switch is the owner's). **Launch price and the "% off launch" badge.** Variant metafield `xdipx.launch_price` (definition in `scripts/shopify-metafield-defs.ts`, run it once post-merge) is recorded by the engine on first sight as the price the variant is live at, and raised only when the engine prices above it; never from MSRP. New `compare_at_strategy` value `launch_price` (per scope on `/admin/pricing`, the Strike field) anchors the compare-at and badge on it, with the 10% badge floor and MAP-brand suppression unchanged. Storefront PDP and heroes now read the strike from the variant compare-at first, MSRP metafield second. A Launch price panel on `/admin/pricing` resets one SKU to its current price. Post-merge: let one batch record launch prices, then switch Strike to `launch_price` on the global row. New metafield `xdipx.launch_price` (definition in `scripts/shopify-metafield-defs.ts`), written by the enrich→publish step when status flips to ACTIVE; backfill for existing live products = today's sell price at rollout (never MSRP). New `compare_at_strategy` value `launch_price` as the default; storefront badge and JSON-LD read it; MAP-brand suppression unchanged; admin "reset launch price" action. DONE WHEN: a product whose cost drops shows "X% off" against its own launch price on card and PDP, and a product priced at or above launch shows no strike-through.
7. **Delete v1 and the dead webhook.** Remove `pricing-engine.server.ts`, `pricing-apply.server.ts`, `pricing-webhook.server.ts`, `api.webhooks.nalpac.cost-change.tsx`, `api.pricing.approve.tsx`, the webhook card, `pricing_webhook_*` settings, `NALPAC_WEBHOOK_SECRET`; retire `pricing_changes`. Retire cost-sync (redundant with the Nalpac app) or reduce it to refreshing the informational MSRP column. Closes tracker `p2-9-pricing-converge`. DONE WHEN: `grep -r decideAndApply app server` is empty and `/admin/pricing` shows no webhook card.
8. **Admin cleanup.** MAP brand list editable; UI defaults match engine defaults; velocity shift shown as a number on the card; remove the 59 all-null product-type rows; hide the approval panel in autopilot mode. DONE WHEN: every value the engine reads is visible and editable on `/admin/pricing`.

Items 1–3 are a day of work and clear the backlog. Items 4–5 make it hands-off. Item 6 is the competitive feature. Items 7–8 are hygiene the others make safe.

## 7. Catalog sync sweep (2026-09-25, read-only)

Method: one Shopify bulk-operation export of every product and variant (no per-page API cost, finished in about 20 seconds, no throttling), compared in memory against the Nalpac main feed (18,316 rows) and sale feed (919 rows) fetched once. Both Shopify locations (Nalpac, Entrenue) are active. Per-variant output stayed outside the repo; only the counts are recorded here. The same shape is the right way to build the recurring sweep in §5 item 5: bulk export, never paged reads.

| What | Count | Of |
|---|---|---|
| Variants exported | 8,246 | 5,541 products (8,038 ACTIVE, 196 ARCHIVED, 12 DRAFT) |
| Unit cost matches feed list wholesale | 7,548 | 8,246 |
| Unit cost **below** feed list wholesale | 696 | 685 of them ACTIVE; 409 carry a "30/40/50/75% Off Sale" tag in the feed, and the unit cost is exactly that percentage off list. The Nalpac app is writing the account's real sale cost, so Nalpac sales already flow into our prices. The other 276 have no sale tag today and may be holding a cost from a sale that ended; only 2 variants ever show a unit cost **above** list, so the app may not raise cost when a sale ends. Needs a check against a Nalpac invoice. |
| `wholesale_cost` metafield stale vs feed | 986 | harmless today (engine reads unit cost first); delete or refresh it |
| `original_price` (MSRP) metafield stale vs feed | 982 | 597 below today's MSRP, 385 above |
| Strike-through shown above Nalpac's current MSRP | 259 | ACTIVE variants; e.g. SKU 74051 strikes $24.99, feed MSRP $18.58 |
| `map_price` metafield stale vs feed | 353 | matters only for the two MAP brands |
| **Lovense / Playground priced below MAP** | **4** | all four typed "Discontinued" (so the engine ignores MAP) while Nalpac still carries them in stock (57 to 148 units) and does not flag them discontinued. SKUs 93484, 89719, 93752, 90004. |
| Shopify quantity matches feed quantity | 8,097 | 8,246; inventory sync is healthy |
| ACTIVE with zero stock | 1,338 | 940 out of stock at Nalpac but still in the feed; 395 gone from the feed entirely; 10 in stock at Nalpac but zero in Shopify |
| Not in either feed | 537 | 393 ACTIVE (388 at zero stock, 5 with stock), 144 ARCHIVED (77 still show stock) |
| Feed rows the discontinued regex flags | 1 | "Boundless AC/DC Dong", a false positive on the `\bDC\b` token. **Nalpac does not mark discontinued products in the feed; they simply disappear from it.** |
| Product type "Discontinued", ACTIVE, still in the feed | 1,062 | 1,040 with stock. The import code never assigns this type (it skips flagged products instead), so it came from outside the pipeline. It is not a discontinued signal, yet it is what routes 1,501 variants to the clearance ladder and lifts MAP on them. |
| Variants without the `nalpac_sku` metafield | 13 | never priced by the batch |
| Priced below cost | 1 | |
| ACTIVE margin under 25% / 25-40% / 40-50% / 50%+ | 68 / 2,649 / 5,274 / 40 | |

What this changes in the plan:

- **Discontinued must be defined as "absent from the Nalpac main and sale feeds"** (with a short grace period, say 3 consecutive daily feeds, so a one-day feed hiccup does not trigger it), not as the product type and not as the regex. §5 item 5 should write `discontinued_at` from that absence and clear it if the SKU reappears.
- **The 1,062 "Discontinued"-typed products Nalpac still sells are misfiled.** They need their real product type back (the derivation in `product-type-derive.ts` can supply it from the feed category) so they leave the clearance ladder and, for the four MAP-brand items, MAP applies again.
- The 388 ACTIVE variants that are gone from the feed and at zero stock are the first batch the new archive rule (§6, decided) would take down.
- The sweep should run daily as a bulk export and write one row per drift class to the pricing digest, so this never has to be rediscovered by hand.

## 6. Decisions only the owner can make

1. **Launch-price backfill.** For the ~8,000 products already live, is "today's price at rollout" acceptable as the launch price, or should the badge start only for products published after item 6 ships? Recommendation: today's price; it is a price we genuinely charged.
2. **Archive rule for discontinued stock.** DECIDED 2026-09-25 (owner): archive only when the product is discontinued **and** stock is zero in every Shopify location. A discontinued product with stock stays live on the clearance ladder.
3. **Digest threshold.** What size of daily price move deserves a line in the digest? Recommendation: 25%, plus every error.

Everything else in §5 is team-executable under the existing merge policy; the rule values themselves stay the owner's lever.
