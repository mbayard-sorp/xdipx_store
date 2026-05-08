# Backfill Spec — Per-Variant Original Descriptions for Existing Shopify Inventory

Companion to `descriptions-metafield-spec.md`. This describes a one-time backfill CSV that lets us populate the `custom.original_description` variant metafield for products that were already in Shopify before the current Nalpac import batch. Co-work produces the file; we feed it to the same importer (`scripts/import-variant-original-descriptions.ts`).

## 1. Context

The 2026-05-05 import batch populated the variant-level `custom.original_description` metafield for **newly imported** products only. Existing inventory (legacy and prior-batch products already in Shopify) has empty variant metafields. This backfill closes that gap so the PDP, IVR, Emma Bot, and SMS surfaces have per-variant copy across the entire catalog.

```
[Shopify product CSV export] ─┐
                              ├─→ build_backfill_descriptions.py ─→ descriptions_per_variant_backfill_<DATE>.csv
[Nalpac feed]                 ─┘                                              │
                                                                              ▼
                                                     scripts/import-variant-original-descriptions.ts
                                                                              │
                                                                              ▼
                                              [variant.custom.original_description metafields populated]
```

## 2. Inputs Co-work has access to

1. **Shopify product CSV export** — exported from Shopify Admin → Products → Export → "All products" (or "Current search") → "CSV for Excel, Numbers, or other spreadsheets". This is the **flat row-per-variant** shape, not the matrix shape. Each row has at minimum: `Handle`, `Title`, `Variant SKU`, `Variant Inventory Qty`, `Status`.
2. **Nalpac feed / per-SKU attributes file** — same source Co-work already uses for `build_descriptions_metafield.py`. Specifically the per-SKU table (`data/nal-product-attributes-main.csv` or equivalent) with columns: `SKU`, `Product Title`, `Color`, `Size`, `Fluid Oz`, `Product Description`.

## 3. Output file

- **File:** `descriptions_per_variant_backfill_<YYYY-MM-DD>.csv`
- **Encoding:** UTF-8
- **Delimiter:** comma
- **Quoting:** standard CSV. Cells with commas, newlines, or `"` are wrapped in double quotes; internal `"` escaped as `""`.
- **Line endings:** LF preferred (CRLF tolerable).
- **Row 1:** header row, exact case/spacing — **must match `descriptions_per_variant_<DATE>.csv` verbatim**.

### Header (copy exactly)

```
SKU,Master SKU,Variant Title (Nalpac),Color,Size,Fluid Oz,Original Description
```

### Column reference

| Column | Type | Required | Notes |
|---|---|---|---|
| `SKU` | string | Yes | The Shopify variant SKU. Must match exactly the value in the Shopify export's `Variant SKU` column. The importer's lookup is `productVariants(query: "sku:<SKU>")`. |
| `Master SKU` | string | Reference | The Nalpac master SKU. Informational only — used for QA spot-checking; the importer ignores this column. |
| `Variant Title (Nalpac)` | string | Reference | Nalpac's `Product Title` for this SKU. Informational. |
| `Color` | string | Reference | From Nalpac feed `Color`. May be empty. |
| `Size` | string | Reference | From Nalpac feed `Size`. May be empty. |
| `Fluid Oz` | string | Reference | From Nalpac feed `Fluid Oz`. May be empty. |
| `Original Description` | string | Yes | Verbatim from Nalpac feed `Product Description` for this SKU. The metafield value. |

The importer only **reads** `SKU` and `Original Description`. The other columns are kept for parity with the daily import shape and for QA.

## 4. Mapping logic

For each variant in the Shopify export:

1. Read the Shopify variant's `Variant SKU` column. Trim whitespace.
2. If empty → **skip** (Shopify variants with no SKU can't be looked up).
3. Look up the SKU in the Nalpac per-SKU attributes file.
4. If no match → **skip** (the variant exists in Shopify but isn't Nalpac-sourced; we can't fabricate a description).
5. If match but `Product Description` is empty → **skip** (the importer skips empty values anyway; cleaner to exclude upstream so the file doesn't carry no-op rows).
6. Emit a row using Nalpac feed values for all 7 columns. The `SKU` is the Shopify variant SKU (which equals the Nalpac SKU on match).

### De-duplication

The Shopify export can contain repeated variant rows when a product has multiple images (each image gets its own row, sharing the variant SKU). Co-work's script must **dedup by SKU** before emitting, so each variant SKU appears exactly once in the output file.

### Status filter (recommended)

Skip variants whose product `Status` in the Shopify export is `archived`. Active and Draft products should be included.

## 5. What to exclude — explicit list

Do not emit a row when any of the following is true:

- Shopify variant has no SKU.
- SKU has no match in the Nalpac attributes file.
- Nalpac `Product Description` is empty for that SKU.
- The Shopify product `Status` is `archived`.
- The variant SKU is duplicated within the same output file (keep first occurrence).

## 6. What to include — explicit list

Emit a row when **all** of these hold:

- The Shopify variant has a non-empty SKU.
- That SKU exists in the Nalpac attributes file.
- The Nalpac `Product Description` for that SKU is non-empty.
- The Shopify product is not archived.

## 7. Validation Co-work should run before sending

1. **Header parity.** First line of the CSV equals: `SKU,Master SKU,Variant Title (Nalpac),Color,Size,Fluid Oz,Original Description`
2. **Field count.** Every row has exactly 7 fields after CSV parse.
3. **Non-empty required columns.** Every row has non-empty `SKU` and non-empty `Original Description`.
4. **Unique SKUs.** No duplicate SKU rows.
5. **Encoding.** File opens cleanly as UTF-8; no replacement characters (`�`) in any field.

## 8. Reporting (alongside the file)

Include a short summary in a sibling file `descriptions_per_variant_backfill_<DATE>_summary.md`:

- Variants in Shopify export (total, after dedup)
- Variants matched to Nalpac feed
- Variants with non-empty Nalpac description (== final row count)
- Variants excluded by reason (no SKU / no Nalpac match / empty description / archived)
- Top brands represented in the backfill (optional, useful spot-check)
- Any SKUs flagged as ambiguous (multiple Nalpac entries share the SKU — pick first, log)

## 9. How we'll consume it

Once Co-work hands over the file, we run:

```bash
# Dry-run: parse + summarize, no writes
npx tsx scripts/import-variant-original-descriptions.ts \
  "/path/to/descriptions_per_variant_backfill_<DATE>.csv"

# Apply
npx tsx scripts/import-variant-original-descriptions.ts \
  "/path/to/descriptions_per_variant_backfill_<DATE>.csv" --apply
```

The script:
- Looks each `SKU` up in Shopify via `productVariants(query: "sku:<SKU>")`.
- Writes `custom.original_description` (multi_line_text_field) on the matching variant.
- Idempotent — re-running overwrites existing values; safe to retry.
- Retries transient network failures up to 3× with exponential backoff.
- Logs and skips: variants not found in Shopify, rows with empty descriptions.

Estimated runtime: ~250ms × N rows. For ~3000 rows expect ~13 minutes.

## 10. Edge cases & gotchas

- **Variant SKUs with leading/trailing whitespace.** Trim before matching. Shopify and Nalpac sometimes disagree on whitespace.
- **Numeric SKUs that Excel converts to scientific notation** (e.g. `4.89081E+12`). Format the SKU column as plain text in the spreadsheet before saving. This is the same gotcha #1 from the main import spec.
- **Variant SKUs that exist in multiple Shopify products.** Shouldn't happen if SKUs are managed cleanly, but if it does, the importer's `findVariantBySKU` uses `first: 1` and returns the first match. Treat any cross-product SKU collisions as a Shopify hygiene issue, not a script issue.
- **Apostrophes in descriptions arriving as `''`** (Nalpac feed encoding). Preserve as-is; the existing `cleanDescription()` in `app/lib/feed-processor.server.ts` normalizes them at read time.
- **Descriptions containing newlines.** The metafield type is `multi_line_text_field` — newlines are preserved. CSV-quote any cell that contains them.
- **Re-running the backfill.** Idempotent. If new products land in Shopify after the backfill, run a fresh export + new backfill CSV; the importer will overwrite existing values where SKUs match (no harm) and add the new ones.

## 11. Reference: existing daily file (for shape parity)

Co-work's daily file `descriptions_per_variant_<DATE>.csv` is the format reference. The backfill file is the same shape — only the source data differs (Shopify export instead of the day's import payload).

## 12. Change log

| Date | Change |
|---|---|
| 2026-05-07 | Initial spec. Backfill companion to `descriptions-metafield-spec.md`. |
