# xdipx Product Import Spreadsheet Spec

This is the contract for producing a CSV that feeds the xdipx bulk importer. The importer lives at `app/lib/bulk-import.server.ts` and expects **exact** column headers in row 1. If a header is misspelled or the casing/spacing differs, that column is silently ignored.

## 1. Output format

- **File type:** `.csv`
- **Encoding:** UTF-8
- **Delimiter:** comma
- **Quoting:** standard CSV quoting. Any cell containing a comma, newline, or `"` must be wrapped in double quotes. Escape internal `"` as `""`.
- **Row 1:** header row with the exact column names listed below.
- **Row 2+:** one product or variant per row.

Headers are **case-sensitive and space-sensitive**. Match them verbatim (e.g. `Total qty available`, not `Total Qty Available`).

## 2. Column reference

### Identity & grouping

| Column | Type | Required | Notes |
|---|---|---|---|
| `SKU` | string | Yes (every row) | Unique across the sheet. Used as the product/variant SKU in Shopify. |
| `Master SKU` | string | Only on child variant rows | Leave empty on master rows and on standalone products. On child variant rows, set this equal to the master row's `SKU`. |
| `Variant Option Name` | string | On variant groups only | e.g. `Size`, `Color`, `Scent`. Must be identical for every row in a variant group. |
| `Variant Option Value` | string | On variant rows only | e.g. `Small`, `Red`, `Vanilla`. Becomes the Shopify variant title. |

### Product fields (read from master row only)

| Column | Type | Required | Notes |
|---|---|---|---|
| `Product Title` | string | Yes | Shopify product title. |
| `Brand` | string | Yes | Shopify vendor. |
| `Product Description` | string | Yes | Long-form description. Apostrophes arriving as `ft.` and double-quotes arriving as `in.` are cleaned automatically by `cleanDescription()` — don't try to hand-fix. Keep literal inch marks after digits (e.g. `7in.` meaning 7 inches) as-is; the cleaner preserves those. |
| `Sub-Category` | string | Yes | Comma-separated list. Drives the `for-him` / `for-her` / `couples` / `both` inference. Use Nalpac category names (see §7). |
| `Main Category` | string | Optional | Unused by the importer today but harmless to include. |
| `Material`, `Color`, `Size`, `Fluid Oz`, `UPC/barcode`, `MPN` | string | Optional | Unused today but recognized headers — safe to include. |
| `Nav Category`, `Nav Path`, `Collections` | string | Optional | Unused today; safe to leave blank. |

### Pricing & inventory (read per row — master AND each variant row)

| Column | Type | Required | Notes |
|---|---|---|---|
| `MSRP` | decimal | Yes | Manufacturer's suggested retail. Numeric, no currency symbol (`79.99`, not `$79.99`). |
| `Wholesale` | decimal | Yes | Our unit cost. Numeric. |
| `MAP` | decimal | Yes | Minimum advertised price. Use `0` if the product has no MAP. |
| `Total qty available` | integer | Yes | Current on-hand units. |
| `Nalpac qty available`, `Entrenue qty available` | integer | Optional | Recognized but unused by the importer today. |

**Do not supply a deal price.** The importer computes it from MSRP / Wholesale / MAP.

### Images (per row)

| Column | Type | Required | Notes |
|---|---|---|---|
| `Image 1` … `Image 10` | URL | `Image 1` required on master rows; rest optional | Public HTTPS URLs. Order is preserved — `Image 1` is the featured/first image. Blanks are ignored. Variant rows may carry their own image URLs; if all variant image columns are blank, Shopify falls back to the master's images. |

## 3. Row patterns

The importer groups rows into "master product groups" by `Master SKU`. Two shapes are accepted:

### Shape A — standalone product (no variants)

One row. `Master SKU` empty. `Variant Option Value` empty. Everything lives on that one row.

### Shape B — product with variants

A master row plus N child rows:

- **Master row:** `Master SKU` empty. May itself be the first variant — if you fill `Variant Option Value` on the master row, the importer treats the master row as variant #1. Otherwise the master row is a header-only row and all variants live on the children.
- **Child rows:** `Master SKU` = the master row's `SKU`. Each child needs its own unique `SKU`, its own `Variant Option Name` + `Variant Option Value`, its own pricing, qty, and optionally its own images.

**Consistency rule:** every row in a variant group (master + children) must use the same `Variant Option Name`. Mixing `Size` and `Color` in one group will be rejected at parse time.

**Inheritance:** child rows inherit `Product Title`, `Brand`, `Product Description`, `Sub-Category`, and master images from the master row. You can leave those columns blank on child rows — if filled, they're ignored. Only pricing, qty, SKU, variant option columns, and per-variant images are read from child rows.

## 4. Pricing rules

The importer computes the deal price with this logic (`computeDealPrice()` in the parser):

- `MAP == 0` → `dealPrice = max(Wholesale × 1.4, MSRP × 0.55)` (marketing copy will say "X% off today only")
- `0 < MAP < MSRP` → `dealPrice = MAP` (MAP is the floor we're allowed to advertise)
- `MAP >= MSRP` → `dealPrice = MSRP` (no discount possible — product is a poor fit for a daily deal)

Supply **MSRP**, **Wholesale**, and **MAP**. The importer handles the rest.

## 5. What NOT to include

These are generated downstream by Claude during import — do **not** add columns for them (they'd be ignored, and it bloats the sheet):

- Tagline
- Full story / long description marketing copy
- "Works for him" / "works for her"
- Feature bullets
- Box contents
- SEO meta description
- SEO title
- Specifications
- Deal price
- Shopify handle / slug (Shopify derives it from the product title on create; the xdipx bulk flow does not override it)
- `deal_status`, `deal_date`, `deal_score` (set by the approval/scoring flow, not at import)
- `mood_image_url`, `accessory_product_ids` (added later in the admin UI)

## 6. Example CSV

This example covers one standalone product and one 3-variant product. Copy the header row exactly.

```csv
SKU,Master SKU,Variant Option Name,Variant Option Value,Product Title,Brand,Product Description,Sub-Category,MSRP,Wholesale,MAP,Total qty available,Image 1,Image 2,Image 3
DOXY-RW-01,,,,"Doxy Rose Wand","Doxy","Cordless rose-quartz wand massager. Rechargeable, whisper-quiet on low, earth-moving on high.","Air Pulse and Suction",149.99,52.00,0,87,https://cdn.example.com/doxy-rose-1.jpg,https://cdn.example.com/doxy-rose-2.jpg,
LELO-SONA-S,,Size,Small,"Lelo Sona Cruise","Lelo","Sonic-wave clitoral stimulator with 12 patterns. Fully waterproof.","Air Pulse and Suction",129.00,45.00,119.00,42,https://cdn.example.com/sona-small-1.jpg,,
LELO-SONA-M,LELO-SONA-S,Size,Medium,,,,,139.00,48.00,129.00,35,https://cdn.example.com/sona-medium-1.jpg,,
LELO-SONA-L,LELO-SONA-S,Size,Large,,,,,149.00,52.00,139.00,28,https://cdn.example.com/sona-large-1.jpg,,
```

Notes on the example:

- Row 1 (`DOXY-RW-01`): standalone product. `Master SKU` and `Variant Option Value` are empty.
- Row 2 (`LELO-SONA-S`): master row that is *also* the first variant (has `Variant Option Value = Small`). Carries all the product-level fields.
- Rows 3–4: child variants. `Master SKU = LELO-SONA-S`. Product-level fields left blank (inherited). Each has its own pricing, qty, and image.

## 7. Category values (Sub-Category)

Use Nalpac category names. The importer buckets them into `for-him` / `for-her` / `couples` / `both`:

- **for-him:** `Vagina Strokers`, `Body Molds`, `Prostate Toys`, `Masturbators`, `Hands-Free Masturbators`
- **for-her:** `Dual Action and Rabbits`, `Finger and Clit`, `Air Pulse and Suction`, `Bullets and Eggs`
- **couples:** `Couples and Wearable`, `Remote`, `Top Couples Toys`, `Restraints`
- Anything else → `both`

Multiple categories can be comma-separated in `Sub-Category`. If any couples-category matches, the product is flagged `couples`; otherwise a mix of him+her → `both`.

## 8. Common gotchas

1. **Numeric Master SKU losing precision.** Google Sheets / Excel will sometimes render a numeric SKU like `123456` as `123456.0` on export. The parser strips a trailing `.0` from `Master SKU`, but the safer fix is to format that column as plain text before entering values.
2. **Quote your descriptions.** Product descriptions almost always contain commas. Wrap the whole cell in `"..."` or rely on your spreadsheet tool's CSV export to do it.
3. **Don't merge cells.** The importer reads one row at a time. Merged cells produce blank rows after export.
4. **No blank rows inside variant groups.** Keep master and children contiguous or at least unambiguous via `Master SKU`.
5. **Don't re-import an existing SKU.** If a `SKU` already exists in the `deal_history` table, that row is silently skipped. If you need to update an existing product, use the admin UI, not the bulk importer.
6. **Inventory threshold.** Anything with `Total qty available < 20` will import but may be flagged ineligible for scoring downstream. Don't bother importing dead stock.
7. **Keep `Variant Option Name` spelled identically** within a group. `Size` ≠ `size` ≠ `Sizes` — the parser treats them as different option names and will reject the group.

## 9. File references

- Parser: [app/lib/bulk-import.server.ts](../app/lib/bulk-import.server.ts)
- Column types: [app/types/index.ts](../app/types/index.ts) (search `BulkImportRow`, `NalpacProduct`)
- Description cleaner: [app/lib/feed-processor.server.ts](../app/lib/feed-processor.server.ts) (`cleanDescription`)
