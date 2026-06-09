# Archived one-off scripts

Completed backfills kept for reference and data recovery. All are idempotent
and safe to re-run from this directory if needed (run with tsx, same env vars
as before). Moved here during the June 2026 site audit cleanup.

- backfill-google-merchant-fields.ts: populated Google Merchant metafields
- backfill-normalized-tags.ts: normalized product tag taxonomy
- backfill-sensation-dial-keys.ts: repaired sensation_dial JSON keys

Kept in scripts/ because still active: backfill-product-enrichment.ts
(enrichment pipeline entry point) and backfill-mfg-specs.ts (referenced by
smoke-sms-phase6d-mfg-specs.ts).
