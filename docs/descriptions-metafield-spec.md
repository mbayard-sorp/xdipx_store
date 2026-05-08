# Descriptions Metafield Import Spec

Companion spec to `product-import-spec.md`. This describes the **post-import** step that populates a metafield on each master product with the original Nalpac descriptions for every variant SKU under that master.

**Why this exists.** When the main importer collapses N variant SKUs into a single Shopify product (master + variants), only one variant's `Product Description` survives onto the master. Size-specific dimension info, weight, insertable length, etc. that Nalpac writes per-variant gets dropped. This metafield carries the full per-variant copy so downstream content generation (PDP renderer, AI rewrite passes) can reference any variant's original description on demand.

## 1. Pipeline context

```
[Nalpac feed] → build_import_csv.py → import_payload_<DATE>.csv      ──┐
                                                                       │ Step 1: bulk-import.server.ts
                                                                       ▼ creates products + variants in Shopify
                                                              ┌──── existing master + variant SKUs ────┐
                                                              │                                        │
[Nalpac feed] → build_descriptions_metafield.py ──→ descriptions_metafield_<DATE>.csv                  │
                                                                       │ Step 2: this spec               │
                                                                       ▼ writes metafield on each master │
                                                              [products carry per-variant JSON copy]    │
                                                                                                        │
PDP render / content generation reads metafield JSON ───────────────────────────────────────────────────┘
```

**Prerequisite:** Step 1 must have completed. Products and their variant SKUs must already exist in Shopify before Step 2 runs.

## 2. Input file

- **File:** `descriptions_metafield_<YYYY-MM-DD>.csv`
- **Encoding:** UTF-8
- **Delimiter:** comma
- **Quoting:** standard CSV. Cells containing commas, newlines, or `"` are wrapped in double quotes; internal `"` is escaped as `""`.
- **Row 1:** header row, exact case/spacing.
- **Row 2+:** one row per master product.

### Columns

| Column | Type | Required | Notes |
|---|---|---|---|
| `Master SKU` | string | Yes | The `SKU` value of a master row in `import_payload_<DATE>.csv`. Used to look up the Shopify product to attach the metafield to. |
| `Brand` | string | Reference | Vendor name. Informational; not written to the metafield. Useful for spot-checking. |
| `Product Title` | string | Reference | Friendly master title (e.g. `LEVELZ Slim Silicone Anal Plug`). Informational. |
| `Variant Count` | integer | Reference | Number of variant entries in the JSON. Should equal the number of objects in `Variant Descriptions JSON`. Use as a sanity check. |
| `Variant Descriptions JSON` | JSON string | Yes | The metafield value. See §4 for schema. Stored as a JSON string in the CSV cell — your importer must pass it through to Shopify as the metafield value (Shopify's `json` metafield type validates it server-side). |

### Sample row

```
Master SKU,Brand,Product Title,Variant Count,Variant Descriptions JSON
96258,Shots,LEVELZ Slim Silicone Anal Plug,8,"[{""sku"":""96258"",""title"":""LEVELZ Slim Silicone Anal Plug Small Black"",""color"":""Black"",""size"":""S"",""fluid_oz"":"""",""description"":""Sleek, smooth, and built for precision...""}, ...]"
```

## 3. Target Shopify metafield

Create the metafield definition in Shopify **before** running the import (Settings → Custom data → Products → Add definition):

| Setting | Value |
|---|---|
| Namespace | `custom` |
| Key | `original_descriptions` |
| Owner | Product |
| Type | **JSON** (`json`) — not `single_line_text_field` and not `multi_line_text_field` |
| Description (optional) | `Per-variant original Nalpac descriptions. JSON array of {sku, title, color, size, fluid_oz, description}.` |
| Validation | None required |
| Storefront access | Yes (so the PDP renderer can read it via Storefront API / Liquid) |

**Full key path:** `custom.original_descriptions`. If you change the namespace/key, update the importer config and the PDP renderer to match.

If the metafield is created as a string type by mistake, Shopify will store the JSON as a stringified blob and the PDP code must `JSON.parse()` it at read time. Prefer the native `json` type to avoid this.

## 4. JSON value schema

Each cell under `Variant Descriptions JSON` is a JSON array. Every element is an object describing one variant:

```jsonc
[
  {
    "sku": "96258",                                     // Variant SKU (string, exact match to a Shopify variant SKU under this master)
    "title": "LEVELZ Slim Silicone Anal Plug Small Black", // Original Nalpac product title for this variant (string, may include color/size words)
    "color": "Black",                                    // Color attribute as Nalpac wrote it (string, may be empty)
    "size": "S",                                         // Size attribute as Nalpac wrote it (string, may be empty)
    "fluid_oz": "",                                      // Fluid Oz attribute (string, numeric or empty for non-lubes)
    "description": "Sleek, smooth, and built ..."        // Full original Nalpac description (string, may be empty if Nalpac feed had none)
  },
  // ...one object per variant SKU under this master
]
```

### Field rules

- **`sku`** — required. Always populated. Must match one of the Shopify variant SKUs that exist under the master product. The PDP renderer keys off this field to look up the variant's description.
- **`title`** — required. Verbatim from Nalpac feed `Product Title` column.
- **`color`** — string, empty allowed. Verbatim from Nalpac feed `Color` column. Note that Nalpac sometimes uses uninformative values like `Multi-Color` even when the title encodes a real colorway; that's expected and not an error.
- **`size`** — string, empty allowed. Verbatim from Nalpac feed `Size` column. Note that some variants leave this empty even when the title says "XL" or "Large"; the import payload normalizes this elsewhere via a synthetic `Regular` label, but here we preserve the raw Nalpac value.
- **`fluid_oz`** — string, empty allowed. Verbatim from Nalpac feed `Fluid Oz` column. Numeric values stored as strings (e.g. `"4"`, `"8.45"`).
- **`description`** — string, empty allowed (≈16% of variants in the current feed have no description). Verbatim from Nalpac feed `Product Description` column. Apostrophes arriving as `''` are intentional — Nalpac escapes single quotes by doubling them. Don't normalize these on write; the PDP renderer's `cleanDescription()` handles them at read time.

### Encoding caveats

- Strings preserve Unicode (UTF-8). Do not strip non-ASCII.
- Newlines inside descriptions are preserved as literal `\n` in the JSON string (which is then escaped as `\\n` in the CSV's double-quoted cell, per CSV/JSON encoding rules).
- The escape pattern in the CSV is: each `"` inside the JSON becomes `""` for CSV, after the JSON has already escaped its own internal `"` characters as `\"`. Most CSV parsers handle this correctly without intervention.

## 5. Mapping logic (CSV row → Shopify metafield write)

For each row in the input CSV:

1. Look up the Shopify product where `variant.sku == row['Master SKU']` AND that variant is the master/anchor of its product (i.e. the canonical lookup is by SKU, not product ID — the importer in Step 1 used the master row's `SKU` as the master variant's SKU).
2. Set metafield on the **product**:
   - `namespace = "custom"`
   - `key = "original_descriptions"`
   - `type = "json"`
   - `value = row['Variant Descriptions JSON']` (passed through verbatim; Shopify validates it as JSON server-side)
3. Skip rows where the SKU lookup fails — log them as a warning. Do not create new products from this file.
4. Idempotency: re-running the import on the same row should overwrite the existing metafield value, not append. Use Shopify's `metafieldsSet` mutation, not `metafieldCreate`.

## 6. Per-variant alternative file (optional)

If you'd rather store descriptions on each Shopify **variant** instead of as a JSON blob on the product, the build script also emits `descriptions_per_variant_<DATE>.csv`:

| Column | Notes |
|---|---|
| `SKU` | Variant SKU. Look up the Shopify variant by this. |
| `Master SKU` | Reference only. |
| `Variant Title (Nalpac)` | Reference only. |
| `Color`, `Size`, `Fluid Oz` | Reference only. |
| `Original Description` | Plain string. Write to a variant-level metafield like `custom.original_description` (singular) of type `multi_line_text_field`. |

You should pick **one** approach (master-level JSON or per-variant string), not both. The PDP renderer must be configured to read whichever you chose.

## 7. Validation / acceptance criteria

After the import runs, the integration is correct when **all** of the following hold:

1. **Coverage.** For every row in the input CSV that has a Shopify product match, the product has a `custom.original_descriptions` metafield set.
2. **Type fidelity.** The metafield value is valid JSON and parses cleanly with `JSON.parse()` on the storefront. Confirm in Shopify Admin → Product → Metafields → "View JSON".
3. **Variant count match.** For each master, `len(JSON.parse(metafield.value))` equals the number of Shopify variants under that product.
4. **SKU integrity.** Every `sku` field in the JSON array exists as a real variant SKU under the master product. (Run a join check post-import.)
5. **Idempotency.** Re-running the import does not duplicate or append; the metafield value is replaced. Run twice and confirm no duplicates.
6. **PDP read path works.** The PDP renderer (or a one-off test page) successfully:
   - reads the metafield,
   - parses the JSON,
   - matches the currently-selected variant by SKU,
   - displays that variant's `description` (with size/dimension copy correctly differentiated across variants).

### Spot-check products for QA

These masters in the current run have meaningful per-variant description differences — use them to confirm the per-size copy actually shows up:

| Master SKU | Title | What to verify |
|---|---|---|
| `96258` | LEVELZ Slim Silicone Anal Plug | 8 variants (S/M/L/XL × Black/Teal). Each size has different Product dimensions / weight / insertable length. PDP should show the correct dimensions when each size is selected. |
| `94156` | Prowler Brief | 16 variants (4 sizes × 4 colorways). Descriptions are similar across variants — primarily a sanity check that the metafield holds all 16 entries. |
| `93932` | Liquid Silk Lubricant | 3 variants by Volume. Each volume has different package size info. |

## 8. Edge cases & gotchas

- **Empty descriptions (~488 of 2,975 variants in the current feed).** The `description` field will be an empty string. The PDP renderer should fall back gracefully (e.g. fall back to the master row's `Product Description`, or to AI-generated copy).
- **Apostrophes as `''`.** Nalpac feed encodes single quotes as `''` (double single-quote). Preserved as-is. The existing `cleanDescription()` in `app/lib/bulk-import.server.ts` already normalizes these.
- **Descriptions containing literal inch marks (`4.13"`).** These are preserved verbatim in the JSON string (escaped as `\"`). The PDP renderer should display them as-is.
- **Master SKU that doesn't exist in Shopify.** Log and skip. Do not create a placeholder product. The most common cause is that the master was excluded from Step 1 (out of stock, no image, etc.).
- **Variant count mismatch (JSON has 8 entries but Shopify product only has 6 variants).** Indicates a drift between the import payload and the Shopify catalog — usually because variants were manually deleted in Shopify Admin after import. Log a warning; the metafield value is still valid for the variants that match.
- **Re-running daily.** The `build_descriptions_metafield.py` script always reads the *current* `import_payload_<DATE>.csv` and the *current* Nalpac feed. If you re-run it on a later date, the file's masters and variant lists reflect that day's data — be intentional about which date's metafield CSV you push.
- **Shopify 65,535-character limit.** Each metafield value is capped at 65,535 characters for `json` type. The largest current row is ~5,000 characters, so well under the limit, but verify if the catalog grows substantially or descriptions get richer.
- **Storefront API access.** If the metafield isn't flagged as Storefront-accessible in its definition, the PDP renderer can read it via Admin API but not via Storefront. Set this when creating the definition.

## 9. Reference: build script

The CSV is generated by `scripts/build_descriptions_metafield.py` in the Nalpac Reports project. It runs after `build_import_csv.py` and reads:

- `reports/<DATE>_masters.json` — master groupings
- `data/nal-product-attributes-main.csv` — full per-SKU descriptions
- `import_payload_<DATE>.csv` — the masters that actually got selected

Outputs both:

- `descriptions_metafield_<DATE>.csv` (master-level, JSON-blob format — this spec)
- `descriptions_per_variant_<DATE>.csv` (per-variant flat format — §6)

To regenerate:

```bash
cd "Nalpac Reports"
python3 scripts/build_descriptions_metafield.py
```

Environment:
- `NALPAC_DATE=YYYY-MM-DD` to target a specific run date (default: today).
- `NALPAC_ROOT=/path/to/repo` to override the project root.

## 10. Change log

| Date | Change |
|---|---|
| 2026-05-05 | Initial spec. Companion to `descriptions_metafield_2026-05-05.csv`. |
