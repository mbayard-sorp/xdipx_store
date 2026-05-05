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
| `Variant Option Value` | string | On variant rows only | e.g. `Small`, `Red`, `Vanilla`. Becomes the Shopify variant title for axis 1. |
| `Variant Option Name 2` | string | Optional | Second variant axis name (e.g. `Color`). When used, all rows in the group must declare the same Name 2 and each row must supply a Value 2. Leave blank for single-axis products. |
| `Variant Option Value 2` | string | Optional | Second variant axis value (e.g. `Red`, `Black`). Required on every row when Name 2 is present. |

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

**Consistency rule:** every row in a variant group (master + children) must use the same `Variant Option Name`. Mixing two different names in axis 1 will be rejected at parse time.

**Inheritance:** child rows inherit `Product Title`, `Brand`, `Product Description`, `Sub-Category`, and master images from the master row. You can leave those columns blank on child rows — if filled, they're ignored. Only pricing, qty, SKU, variant option columns, and per-variant images are read from child rows.

### Shape B' — product with two variant axes

Maximum 2 axes. Three-axis products (size × color × material) must be flattened or split into separate products. Two-axis support is capped here intentionally to keep the spec teachable and the Shopify options simple.

When a product has two variant axes (e.g. Size × Color), use both column pairs:

- Supply `Variant Option Name` / `Variant Option Value` for axis 1 (e.g. `Size` / `Small`).
- Supply `Variant Option Name 2` / `Variant Option Value 2` for axis 2 (e.g. `Color` / `Red`).
- **Every row in the group must supply both a Value and a Value 2.** Partial population (some rows have Value 2, others don't) is rejected at parse time — use `Total qty available = 0` to represent an out-of-stock combination rather than omitting its row.
- Use one row per combination. Three sizes × two colors = 6 rows.

**Order preservation:** option value order in Shopify follows row order in the CSV. Put sizes in S → M → L order, colors in your preferred display order — that is the order shoppers will see in the variant picker.

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

This example covers one standalone product, one 3-variant single-axis product, and one 6-variant two-axis product. Copy the header row exactly.

```csv
SKU,Master SKU,Variant Option Name,Variant Option Value,Variant Option Name 2,Variant Option Value 2,Product Title,Brand,Product Description,Sub-Category,MSRP,Wholesale,MAP,Total qty available,Image 1,Image 2,Image 3
DOXY-RW-01,,,,,,"Doxy Rose Wand","Doxy","Cordless rose-quartz wand massager. Rechargeable, whisper-quiet on low, earth-moving on high.","Air Pulse and Suction",149.99,52.00,0,87,https://cdn.example.com/doxy-rose-1.jpg,https://cdn.example.com/doxy-rose-2.jpg,
LELO-SONA-S,,Size,Small,,,"Lelo Sona Cruise","Lelo","Sonic-wave clitoral stimulator with 12 patterns. Fully waterproof.","Air Pulse and Suction",129.00,45.00,119.00,42,https://cdn.example.com/sona-small-1.jpg,,
LELO-SONA-M,LELO-SONA-S,Size,Medium,,,,,,,139.00,48.00,129.00,35,https://cdn.example.com/sona-medium-1.jpg,,
LELO-SONA-L,LELO-SONA-S,Size,Large,,,,,,,149.00,52.00,139.00,28,https://cdn.example.com/sona-large-1.jpg,,
BLOOM-S-RD,,Size,Small,Color,Red,"Bloom Curve","Acme","Dual-motor curved vibrator. Three sizes, two colourways.","Dual Action and Rabbits",89.00,31.00,0,24,https://cdn.example.com/bloom-s-rd.jpg,,
BLOOM-S-BK,BLOOM-S-RD,Size,Small,Color,Black,,,,,89.00,31.00,0,18,https://cdn.example.com/bloom-s-bk.jpg,,
BLOOM-M-RD,BLOOM-S-RD,Size,Medium,Color,Red,,,,,99.00,35.00,0,21,https://cdn.example.com/bloom-m-rd.jpg,,
BLOOM-M-BK,BLOOM-S-RD,Size,Medium,Color,Black,,,,,99.00,35.00,0,14,https://cdn.example.com/bloom-m-bk.jpg,,
BLOOM-L-RD,BLOOM-S-RD,Size,Large,Color,Red,,,,,109.00,38.00,0,16,https://cdn.example.com/bloom-l-rd.jpg,,
BLOOM-L-BK,BLOOM-S-RD,Size,Large,Color,Black,,,,,109.00,38.00,0,0,https://cdn.example.com/bloom-l-bk.jpg,,
```

Notes on the example:

- Row 1 (`DOXY-RW-01`): standalone product. `Master SKU`, `Variant Option Value`, and `Variant Option Value 2` are all empty.
- Row 2 (`LELO-SONA-S`): master row that is *also* the first variant (has `Variant Option Value = Small`). Carries all product-level fields. No second axis — Name 2 and Value 2 are blank.
- Rows 3–4: child variants for the single-axis group. `Master SKU = LELO-SONA-S`. Product-level fields left blank (inherited). Each has its own pricing, qty, and image.
- Row 5 (`BLOOM-S-RD`): master row for a two-axis product. Carries all product-level fields plus axis 1 (`Size = Small`) and axis 2 (`Color = Red`).
- Rows 6–10: child variants for the two-axis group. `Master SKU = BLOOM-S-RD`. Every row supplies both `Variant Option Value` and `Variant Option Value 2`. Row 10 (`BLOOM-L-BK`) has `Total qty available = 0` — the combination is out of stock but the variant is still created so shoppers see it is unavailable.

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
8. **Two-axis groups need every combination as its own row.** Don't omit rows for combinations you don't stock — instead set `Total qty available = 0` so the variant is created but flagged out-of-stock in Shopify. Omitting a row produces partial `Value 2` population, which is rejected at parse time.
9. **Maximum 2 variant axes.** Three-axis products (e.g. size × color × material) are not supported by this importer. Flatten the options or split into separate products before import.
10. **Per-variant images are not yet supported.** All product images live on the master row and apply to every variant. If you need Color = Red to show different photos than Color = Black, that requires a follow-up update from the admin UI after import.
11. **Queue-level pricing is approximate for two-axis products.** The `dealHistory` record used for queue ordering and downstream scoring reads pricing from the master row, not a per-variant aggregate. For two-axis products with significant price variation across variants, the queue-level price is approximate — the storefront still shows correct per-variant prices.

## 9. File references

- Parser: [app/lib/bulk-import.server.ts](../app/lib/bulk-import.server.ts)
- Column types: [app/types/index.ts](../app/types/index.ts) (search `BulkImportRow`, `NalpacProduct`)
- Description cleaner: [app/lib/feed-processor.server.ts](../app/lib/feed-processor.server.ts) (`cleanDescription`)
