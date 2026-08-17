# Routine: Weekly Meta Channel Alignment (product-manager)

The playbook for keeping the Facebook & Instagram sales channel honestly represented against
Meta's Commerce Policy verdicts. Owner: `product-manager` (it already runs catalog judgment under
the product team). Weekly, REPORT-ONLY.

Origin: owner direction 2026-08-15 (all-hands): "Can we check the catalog and remove products
programatically from the sales channel that are rejected so we have a clean representation of what
is allowed on the platform?" The owner chose an agent routine over a server-side cron, and chose to
appeal a sample of rejections before any unpublish happens.

> **Scheduling is an owner step.** This routine needs its own RemoteTrigger (weekly cadence, team
> `product`); a playbook cannot create one. Until the owner creates the trigger, the routine only
> runs when fired by hand. Ticket #3413 is not DONE until the trigger exists.

## Phase 1 is report-only. There is no write path.

This routine writes **nothing** to Shopify or Meta. It reads the verdicts, computes the drift, and
files a suggestion naming the counts. The unpublish action (`publishableUnpublish`; the store's
Shopify connection already carries `write_publications`) turns on only when the owner says so,
after the appeal experiment returns a verdict. Do not build or use a write path behind a flag that
defaults on; do not "just fix one row" by hand. Report-only means report-only.

## Verified mechanics (tested live 2026-08-15; do not rediscover them)

1. **Reject list:** Meta Ads connector, `ads_catalog_search_product` on catalog
   `1551461513373481` with `error_type: PRODUCT_NOT_APPROVED`. At verification: 585 items across
   6 pages of 100.
2. **Join key:** Meta `retailer_id` IS the Shopify variant id. Confirmed on two live rows:
   `46390996926635` resolves to Magic Wand Plus, `47454271111339` to Sliquid Naturals Silver.
3. **Channel membership:** `Product.publishedOnPublication(publicationId:
   "gid://shopify/Publication/205712720043")` (the Facebook & Instagram publication). Both test
   rows returned `true`.
4. **The write, when (and only when) the owner enables it:** `publishableUnpublish`.

## Count truth: the includedProductsCount trap

`productsCount(query: "publication_id:...")` **SILENTLY IGNORES the filter.** A real id, a bogus
id, another channel's id, and no filter at all return the same store-wide total (4,916 at
verification). This already produced one wrong report. Use `Publication.includedProductsCount`
instead, always. Correct figures 2026-08-15 for reference: Facebook & Instagram 663, Online Store
722, Google & YouTube 4,916. Never report a channel count derived from the products query.

## Weekly pass

1. Run under the `product` team gate as usual (start run, gate, skip honestly on `!ok`).
2. Pull the reject list (mechanic 1), page through all pages.
3. Join rejects to Shopify products via `retailer_id` = variant id (mechanic 2) and check each
   against channel membership (mechanic 3): a rejected product still published on the Facebook &
   Instagram channel is **drift**.
4. Compute the channel totals via `Publication.includedProductsCount` (never the products query)
   and the counts: approved / rejected / unreviewed on the channel, plus the drift delta since this
   routine's last run (read your previous suggestion row for the prior figures; a first run reports
   the baseline and says so).
5. File ONE suggestion row on the bus (team `product`, `category:'meta-channel-align'`, stable
   `dedupeKey` per week) carrying: the counts, the drift, the top drifted products by name, and
   the standing note that the unpublish step remains owner-gated pending the appeal verdict. The
   executor is the owner reading it; that is the whole Phase 1 action.
6. Finish the run with the counts in the summary.

## Related

- #3399 / routine-social-daily Step 2.7 posture: catalog approval never filters draft product
  selection; it gates product tags and the shop surface only.
- #3402 / PR #666: the ads-policy Meta Shops section.

DONE WHEN: the routine exists, runs weekly (owner-created trigger), and files a suggestion
reporting approved / rejected / unreviewed counts on the channel plus drift since its last run,
with no write path enabled.
