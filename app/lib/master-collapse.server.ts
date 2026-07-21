/**
 * master-collapse.server.ts
 *
 * Stage 1 + Stage 2 of the Nalpac master-collapse pipeline.
 *
 * Stage 1 (collapseMasters): groups flat SKU rows from NalpacPriceSnapshot
 *   into MasterRecord aggregates keyed on (brand, base_title).
 * Stage 2 (detectAxes): derives up to 2 variant axes per master (Color, Size,
 *   Volume) and emits per-variant VariantBuild tuples ready for import.
 *
 * Pure module — no I/O, no DB, no LLM. Stdlib-equivalent only.
 */

import type { NalpacPriceSnapshot } from './nalpac-feeds.server'

// ─── Exported strip-list constants ────────────────────────────────────────────

/** Placeholder category assigned when no Sub-Category can be inferred for a
 *  master. Never a real editorial label, so it must be filtered before tags are
 *  written to Shopify or Sanity. */
export const UNCATEGORIZED_SENTINEL = '(uncategorized)'

/** Ounce / mL / gram packaging strings removed from titles before grouping. */
export const VOLUME_PACKAGING_PATTERN =
  /\b(\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|ml|gm|gram(?:s)?)|(?:\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:oz|ml)))\b|\b(?:bottle|tube|pump|pillow\s*pack|sachet|packet|jar|can)\b/gi

/** Written-out size tokens (step 4 of base-title strip). */
export const SIZE_WORD_TOKENS = [
  'XXXS', 'XXS', 'XS', 'Small', 'Medium', 'Large', 'XLarge', 'XXLarge',
  'XXXLarge', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL', 'OneSize', 'One Size',
]

/** Common color words stripped from titles even when not in the Color column (step 5). */
export const COMMON_COLOR_WORDS = [
  'black', 'white', 'red', 'pink', 'purple', 'blue', 'green', 'gold', 'silver',
  'teal', 'aqua', 'nude', 'tan', 'clear', 'natural', 'navy', 'orange', 'yellow',
  'brown', 'gray', 'grey', 'magenta', 'coral', 'burgundy', 'rose', 'ivory',
  'lavender', 'cream',
]

/**
 * Values in the Color column that carry no real colorway information.
 * When ALL colors in a master are uninformative, no Color axis is created.
 */
export const UNINFORMATIVE_COLORS = new Set([
  'multi-color', 'multicolor', 'multi color', 'assorted', 'various', 'varies',
])

/**
 * Dangling structural words dropped AFTER the main strip (§6 fix a).
 * These are leftover tokens that prevent masters from collapsing correctly.
 */
export const STRUCTURAL_RESIDUE_WORDS = ['size', 'style', 'color', 'assorted']

/**
 * Canonical size sort order. `Regular`/`Standard` sort between S and L.
 * Anything not in this list sorts last (stable, alphabetical tiebreak).
 */
export const SIZE_SORT_ORDER: string[] = [
  'XXXS', 'XXS', 'XS', 'S', 'S/M', 'Regular', 'Standard', 'M', 'M/L',
  'L', 'L/XL', 'XL', 'XL/2XL', 'XXL/2XL', '2XL/3XL', 'XXXL/3XL',
  '3XL/4XL', '4XL', '4XL/5XL', '5XL', 'OneSize',
]

// ─── Types ────────────────────────────────────────────────────────────────────

/** An axis value + the sort rank for ordering variant options. */
export interface VariantAxis {
  name: 'Color' | 'Size' | 'Volume'
  values: string[]  // deduplicated, sorted (sizes by SIZE_SORT_ORDER; colors/volumes alphabetically)
}

/** Per-variant build payload — one row in the import CSV sense. */
export interface VariantBuild {
  sku: string
  /** option tuple — index 0 = axis[0].name, index 1 = axis[1].name (when present). */
  optionValues: string[]
  price: number
  compareAtPrice: number
  qty: number
  wholesale: number
  images: string[]
  upc: string
}

/** Collapsed master record (output of Stage 1). */
export interface MasterRecord {
  /** Stable key: `${brandLower}|${baseTitle}` */
  masterKey:        string
  brand:            string
  /** Longest variant title — for display. */
  displayTitle:     string
  baseTitle:        string
  /** Most common Sub-Category across variants (simplified from spec §2 co-occurrence note). */
  category:         string
  variantCount:     number
  inStockVariants:  number
  colors:           string[]
  sizes:            string[]
  fluidOz:          string[]
  totalQty:         number
  /** Median wholesale across variants. */
  wholesale:        number
  /** Median MSRP across variants. */
  msrp:             number
  /** Median MAP (0 when no MAP). */
  map:              number
  marginMsrpPct:    number
  marginMapPct:     number
  profitPerUnit:    number
  skus:             string[]
  sampleImage:      string
  upcs:             string[]
  /** Feed flag: true if ANY variant is in the top-100 feed. */
  inTop100Feed:     boolean
  /** Feed flag: true if ANY variant is in the new-products feed. */
  inNewFeed:        boolean
  /** Feed flag: true if ANY variant is in the sale feed. */
  inSaleFeed:       boolean
  /** Raw snapshots for the variants in this master (used by detectAxes + import). */
  snapshots:        NalpacPriceSnapshot[]
}

// ─── Eligibility ──────────────────────────────────────────────────────────────

const QTY_FLOOR = parseInt(process.env['NALPAC_QTY_FLOOR'] ?? '20', 10)

const DISPLAY_TESTER_PATTERNS = /\b(?:display|tester|testers|displays|merchandising|planogram|pos\s*kit)\b/i

export function isEligible(
  master: MasterRecord,
): { ok: boolean; reason?: string } {
  // Display / tester
  if (DISPLAY_TESTER_PATTERNS.test(master.category) ||
      DISPLAY_TESTER_PATTERNS.test(master.displayTitle)) {
    return { ok: false, reason: 'display_or_tester' }
  }

  // Qty below floor
  if (master.totalQty < QTY_FLOOR) {
    return { ok: false, reason: 'qty_below_20' }
  }

  // No image
  if (!master.sampleImage) {
    return { ok: false, reason: 'no_image' }
  }

  // Missing pricing
  if (master.wholesale <= 0 || master.msrp <= 0) {
    return { ok: false, reason: 'missing_pricing' }
  }

  return { ok: true }
}

// ─── Gap score ────────────────────────────────────────────────────────────────

/**
 * gap_score = (margin_pct / 50) * (1 + ln(1 + variant_count)) * (1 + 0.2 * ln(1 + total_qty))
 *
 * margin_pct is 0–100 (e.g. 45 for 45% margin).
 */
export function gapScore(master: MasterRecord): number {
  const marginPct = master.marginMsrpPct * 100  // already 0-1 → convert to 0-100
  return (marginPct / 50) *
    (1 + Math.log(1 + master.variantCount)) *
    (1 + 0.2 * Math.log(1 + master.totalQty))
}

// ─── Base-title normalisation ─────────────────────────────────────────────────

/** Split a Color or Size cell on commas and forward-slashes, trim each part. */
function splitCell(val: string): string[] {
  return val
    .split(/[,/]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Escape a string so it is safe to insert into a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the base title from a product title + its Color/Size cell values.
 * Follows the 6-step strip order from §2 of MASTERS_AND_VARIANTS.md.
 */
export function buildBaseTitle(
  productTitle: string,
  colorCell: string,
  sizeCell: string,
): string {
  let t = productTitle

  // Step 1: volume / packaging patterns
  t = t.replace(VOLUME_PACKAGING_PATTERN, ' ')

  // Step 2: strip Color column values (each split token, word-boundary, case-insensitive)
  for (const token of splitCell(colorCell)) {
    if (!token) continue
    const pattern = /\s/.test(token)
      ? new RegExp(`(?<![a-z0-9])${escapeRegex(token)}(?![a-z0-9])`, 'gi')
      : new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi')
    t = t.replace(pattern, ' ')
  }

  // Step 3: strip Size column values
  for (const token of splitCell(sizeCell)) {
    if (!token) continue
    const pattern = /\s/.test(token)
      ? new RegExp(`(?<![a-z0-9])${escapeRegex(token)}(?![a-z0-9])`, 'gi')
      : new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi')
    t = t.replace(pattern, ' ')
  }

  // Step 4: strip written-out size words (longest first to avoid partial matches)
  for (const sz of [...SIZE_WORD_TOKENS].sort((a, b) => b.length - a.length)) {
    const pattern = /\s/.test(sz)
      ? new RegExp(`(?<![a-z0-9])${escapeRegex(sz)}(?![a-z0-9])`, 'gi')
      : new RegExp(`\\b${escapeRegex(sz)}\\b`, 'gi')
    t = t.replace(pattern, ' ')
  }

  // Step 5: strip common color words (not anchored — remove anywhere in title)
  for (const color of COMMON_COLOR_WORDS) {
    t = t.replace(new RegExp(`\\b${escapeRegex(color)}\\b`, 'gi'), ' ')
  }

  // §6 fix (a): drop dangling structural words after the main strip
  for (const word of STRUCTURAL_RESIDUE_WORDS) {
    t = t.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), ' ')
  }

  // Step 6: collapse whitespace, trim leading/trailing punctuation
  t = t.replace(/\s+/g, ' ').trim().replace(/^[-_/.,\s]+|[-_/.,\s]+$/g, '').trim()

  // Lowercase for stable keying
  return t.toLowerCase()
}

// ─── Median helper ────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : ((sorted[mid - 1]! + sorted[mid]!) / 2)
}

// ─── Stage 1: collapseMasters ─────────────────────────────────────────────────

/**
 * Collapse a flat map of NalpacPriceSnapshot (one per SKU) into MasterRecord
 * aggregates grouped by (brand, base_title).
 *
 * §6 fixes applied: (b) split multi-value Color/Size cells, (c) use UPC as
 * identity sanity check (stored per master), (d) stable master_key,
 * (e) needs_review flag for >30 variant masters.
 */
export function collapseMasters(
  snapshots: Map<string, NalpacPriceSnapshot>,
): MasterRecord[] {
  // Map<masterKey, { snaps, rawRows }>
  const buckets = new Map<string, { snaps: NalpacPriceSnapshot[] }>()

  for (const snap of snapshots.values()) {
    const brand = (snap.vendor ?? '').trim()
    const title = (snap.productTitle ?? '').trim()
    if (!brand || !title) continue

    // Source Color/Size from mainRow, fallback to saleRow
    const row = snap.raw.mainRow ?? snap.raw.saleRow
    const colorCell = row?.['Color'] ?? ''
    const sizeCell  = row?.['Size'] ?? ''

    const base = buildBaseTitle(title, colorCell, sizeCell)

    // Fall back to full normalized title if strip left nothing
    const effectiveBase = base || title.toLowerCase().replace(/\s+/g, ' ').trim()

    const key = `${brand.toLowerCase()}|${effectiveBase}`

    if (!buckets.has(key)) buckets.set(key, { snaps: [] })
    buckets.get(key)!.snaps.push(snap)
  }

  const records: MasterRecord[] = []

  for (const [masterKey, { snaps }] of buckets) {
    const [brandPart] = masterKey.split('|') as [string, ...string[]]
    const baseTitle   = masterKey.slice(brandPart.length + 1)

    // Aggregate fields
    let totalQty       = 0
    let inStockCount   = 0
    const wholesales:  number[] = []
    const msrps:       number[] = []
    const maps:        number[] = []
    const colors:      Set<string> = new Set()
    const sizes:       Set<string> = new Set()
    const fluidOzSet:  Set<string> = new Set()
    const skus:        string[] = []
    const upcs:        string[] = []
    const subCatCount: Map<string, number> = new Map()
    let sampleImage    = ''
    let displayTitle   = ''
    let inTop100Feed   = false
    let inNewFeed      = false
    let inSaleFeed     = false

    for (const snap of snaps) {
      skus.push(snap.sku)
      const row = snap.raw.mainRow ?? snap.raw.saleRow

      // UPC — §6 fix (c)
      const upc = row?.['UPC/barcode'] ?? ''
      if (upc) upcs.push(upc)

      // Pricing
      if (snap.wholesale > 0) wholesales.push(snap.wholesale)
      if (snap.msrp > 0)      msrps.push(snap.msrp)
      if (snap.mapPrice != null && snap.mapPrice > 0) maps.push(snap.mapPrice)

      // Qty
      const qty = snap.qty ?? 0
      totalQty += qty
      if (qty > 0) inStockCount++

      // Color (§6 fix b: split multi-value cells)
      const colorCell = row?.['Color'] ?? ''
      for (const c of splitCell(colorCell)) {
        if (c) colors.add(c)
      }

      // Size (§6 fix b)
      const sizeCell = row?.['Size'] ?? ''
      for (const s of splitCell(sizeCell)) {
        if (s) sizes.add(s)
      }

      // Fluid Oz
      const oz = row?.['Fluid Oz'] ?? ''
      if (oz.trim()) fluidOzSet.add(oz.trim())

      // Display title = longest variant title
      const title = snap.productTitle ?? ''
      if (title.length > displayTitle.length) displayTitle = title

      // Sample image
      if (!sampleImage) {
        const img = row?.['Image 1'] ?? ''
        if (img) sampleImage = img
      }

      // Sub-Category for category inference
      const subCat = row?.['Sub-Category'] ?? ''
      if (subCat) {
        subCatCount.set(subCat, (subCatCount.get(subCat) ?? 0) + 1)
      }

      // Feed flags
      if (snap.inTop100Feed) inTop100Feed = true
      if (snap.inNewFeed)    inNewFeed    = true
      if (snap.inSaleFeed)   inSaleFeed   = true
    }

    const medWholesale = median(wholesales)
    const medMsrp      = median(msrps)
    const medMap       = median(maps.length > 0 ? maps : [0])

    const marginMsrpPct = medMsrp > 0 ? (medMsrp - medWholesale) / medMsrp : 0
    const marginMapPct  = medMap  > 0 ? (medMap  - medWholesale) / medMap   : 0

    // Most common Sub-Category (simplified §2 inference — DEFER co-occurrence)
    let category = UNCATEGORIZED_SENTINEL
    let maxCount = 0
    for (const [cat, count] of subCatCount) {
      if (count > maxCount) { maxCount = count; category = cat }
    }

    // Determine brand display from first snap
    const brandDisplay = snaps[0]?.vendor ?? brandPart

    records.push({
      masterKey,
      brand:           brandDisplay,
      displayTitle,
      baseTitle,
      category,
      variantCount:    snaps.length,
      inStockVariants: inStockCount,
      colors:          [...colors],
      sizes:           [...sizes],
      fluidOz:         [...fluidOzSet],
      totalQty,
      wholesale:       medWholesale,
      msrp:            medMsrp,
      map:             medMap,
      marginMsrpPct,
      marginMapPct,
      profitPerUnit:   (medMsrp > 0 ? medMsrp : medMap) - medWholesale,
      skus,
      sampleImage,
      upcs,
      inTop100Feed,
      inNewFeed,
      inSaleFeed,
      snapshots:       snaps,
    })
  }

  return records
}

// ─── Stage 2: detectAxes ──────────────────────────────────────────────────────

function sizeRank(s: string): number {
  const idx = SIZE_SORT_ORDER.indexOf(s)
  return idx === -1 ? SIZE_SORT_ORDER.length : idx
}

/**
 * Detect up to 2 variant axes for a master and emit per-variant build rows.
 *
 * Implements §3 rules: Color, Size, Volume axes; Twist A (Regular fill-in);
 * Twist B (derived hidden-color axis on collision); size sort order.
 */
export function detectAxes(
  master: MasterRecord,
): { axes: VariantAxis[]; variantRows: VariantBuild[] } {
  const snaps = master.snapshots

  // ── Per-SKU raw values ────────────────────────────────────────────────────
  interface SkuValues {
    sku:      string
    snap:     NalpacPriceSnapshot
    colors:   string[]   // split color cell
    sizes:    string[]   // split size cell
    fluidOz:  string
    title:    string
    upc:      string
  }

  const perSku: SkuValues[] = snaps.map(snap => {
    const row = snap.raw.mainRow ?? snap.raw.saleRow
    return {
      sku:     snap.sku,
      snap,
      colors:  splitCell(row?.['Color'] ?? '').filter(c => c !== ''),
      sizes:   splitCell(row?.['Size']  ?? '').filter(s => s !== ''),
      fluidOz: (row?.['Fluid Oz'] ?? '').trim(),
      title:   snap.productTitle ?? '',
      upc:     row?.['UPC/barcode'] ?? '',
    }
  })

  // ── Axis candidacy ─────────────────────────────────────────────────────────

  // Flatten first color per SKU (most SKUs have one; multi-value is unusual)
  const primaryColors = perSku.map(s => s.colors[0] ?? '')

  // Distinct non-empty colors
  const distinctColors = new Set(primaryColors.filter(c => c !== ''))

  // Color axis: > 1 distinct color AND not all uninformative
  const hasRealColor = distinctColors.size > 1 &&
    [...distinctColors].some(c => !UNINFORMATIVE_COLORS.has(c.toLowerCase()))

  // Primary size per SKU
  const primarySizes = perSku.map(s => s.sizes[0] ?? '')

  // Twist A: when SOME sizes are blank and others are not, fill blanks with "Regular"
  const hasSomeSize  = primarySizes.some(s => s !== '')
  const hasSomeBlank = primarySizes.some(s => s === '')
  let effectiveSizes = primarySizes
  if (hasSomeSize && hasSomeBlank) {
    effectiveSizes = primarySizes.map(s => (s === '' ? 'Regular' : s))
  }

  const distinctSizes = new Set(effectiveSizes.filter(s => s !== ''))
  const hasSizeAxis   = distinctSizes.size > 1

  // Volume axis
  const distinctFlOz = new Set(perSku.map(s => s.fluidOz).filter(oz => oz !== ''))
  const hasVolumeAxis = distinctFlOz.size > 1

  // Title remnant after stripping the base title and known size/volume values.
  // "Doxy Go Travel-Sized Wand Massager Pink" -> "Pink";
  // "Love Knot Mini Flogger Black with Pink Bow" -> "Black Pink".
  // Shared by Twist B and the color-axis repairs (Twists A2/B2) below.
  function titleRemnant(sv: SkuValues): string {
    let t = sv.title
    const baseWords = master.baseTitle.split(/\s+/)
    for (const word of baseWords) {
      if (!word) continue
      t = t.replace(new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'), ' ')
    }
    if (hasSizeAxis) {
      for (const sz of [...distinctSizes]) {
        t = t.replace(new RegExp(`\\b${escapeRegex(sz)}\\b`, 'gi'), ' ')
      }
    }
    if (hasVolumeAxis) {
      for (const oz of [...distinctFlOz]) {
        t = t.replace(new RegExp(`\\b${escapeRegex(oz)}\\b`, 'gi'), ' ')
      }
    }
    t = t.replace(VOLUME_PACKAGING_PATTERN, ' ')
    return t.replace(/\s+/g, ' ').trim().replace(/^[-_/.,\s]+|[-_/.,\s]+$/g, '').trim()
  }

  // Twist A2: real Color axis but some SKUs have a blank Color cell (color only
  // in the title, e.g. Doxy Go "Pink"). Fill blanks from the title remnant —
  // a blank option value 422s on Shopify ("Product options must have
  // corresponding variants") because options.values excludes blanks.
  let effectiveColors = primaryColors
  if (hasRealColor && primaryColors.some(c => c === '')) {
    effectiveColors = primaryColors.map((c, i) =>
      c !== '' ? c : (titleRemnant(perSku[i]!) || 'Default'))
  }

  // ── Collision check + Twist B ─────────────────────────────────────────────

  // Build initial option tuples (before Twist B)
  function buildOptionTuple(idx: number): string[] {
    const tuple: string[] = []
    if (hasRealColor)  tuple.push(effectiveColors[idx] ?? '')
    if (hasSizeAxis)   tuple.push(effectiveSizes[idx] ?? '')
    if (hasVolumeAxis) tuple.push(perSku[idx]?.fluidOz ?? '')
    return tuple
  }

  const initialTuples = perSku.map((_, i) => buildOptionTuple(i))
  const tupleStrings  = initialTuples.map(t => t.join('|'))
  const hasCollision  = tupleStrings.length !== new Set(tupleStrings).size

  let usesTwistB     = false
  let derivedColors:  string[] = []

  if (hasCollision && !hasRealColor) {
    // Twist B: try to extract color from title
    derivedColors = perSku.map(sv => titleRemnant(sv) || 'Default')

    const distinctDerived = new Set(derivedColors)
    // Accept Twist B only if: >= 2 distinct colors, covers >= half SKUs, resolves collisions
    const coverCount = derivedColors.filter(c => c !== 'Default').length
    if (distinctDerived.size >= 2 &&
        coverCount >= Math.floor(perSku.length / 2)) {
      // Verify it actually resolves the collision
      const newTuples = perSku.map((sv, i) => {
        const t: string[] = [derivedColors[i] ?? 'Default']
        if (hasSizeAxis)   t.push(effectiveSizes[i] ?? '')
        if (hasVolumeAxis) t.push(sv.fluidOz)
        return t.join('|')
      })
      if (new Set(newTuples).size === perSku.length) {
        usesTwistB = true
      }
    }
  }

  // Twist B2: collision WITH a real Color axis — two SKUs share a primary color
  // ("Black with Pink Bow" vs "Black with Purple Bow" are both Color=Black).
  // Shopify rejects duplicate tuples ("The variant 'Black' already exists"), so
  // disambiguate the colliding SKUs with their title remnant when that helps.
  if (hasCollision && hasRealColor) {
    const tupleCounts = new Map<string, number>()
    for (const t of tupleStrings) tupleCounts.set(t, (tupleCounts.get(t) ?? 0) + 1)
    effectiveColors = effectiveColors.map((c, i) => {
      if ((tupleCounts.get(tupleStrings[i]!) ?? 0) <= 1) return c
      const remnant = titleRemnant(perSku[i]!)
      return remnant && remnant.toLowerCase() !== c.toLowerCase() ? remnant : c
    })
  }

  // ── Build final axes ───────────────────────────────────────────────────────

  const axes: VariantAxis[] = []

  // Color (real or Twist B derived)
  if (hasRealColor || usesTwistB) {
    const vals = usesTwistB ? derivedColors : effectiveColors
    const dedupedColors = [...new Set(vals.filter(c => c !== ''))]
      .sort((a, b) => a.localeCompare(b))
    axes.push({ name: 'Color', values: dedupedColors })
  }

  // Size (only if <= 1 axis already used so far — spec supports up to 2)
  if (hasSizeAxis && axes.length < 2) {
    const dedupedSizes = [...new Set([...effectiveSizes].filter(s => s !== ''))]
      .sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b))
    axes.push({ name: 'Size', values: dedupedSizes })
  }

  // Volume (only if <= 1 axis already — keep within 2-axis budget)
  if (hasVolumeAxis && axes.length < 2) {
    const dedupedVols = [...new Set([...distinctFlOz])]
      .sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b))
    axes.push({ name: 'Volume', values: dedupedVols })
  }

  // ── Build variant rows ─────────────────────────────────────────────────────

  const variantRows: VariantBuild[] = perSku.map((sv, i) => {
    const optionValues: string[] = []

    for (const axis of axes) {
      if (axis.name === 'Color') {
        optionValues.push(
          usesTwistB
            ? (derivedColors[i] ?? 'Default')
            : (effectiveColors[i] ?? ''),
        )
      } else if (axis.name === 'Size') {
        optionValues.push(effectiveSizes[i] ?? '')
      } else if (axis.name === 'Volume') {
        optionValues.push(sv.fluidOz)
      }
    }

    const wholesale      = sv.snap.wholesale
    const msrp           = sv.snap.msrp
    const map            = sv.snap.mapPrice ?? 0
    const qty            = sv.snap.qty ?? 0
    const row            = sv.snap.raw.mainRow ?? sv.snap.raw.saleRow

    // Compute variant deal price (mirrors bulk-import logic)
    const price = map === 0
      ? Math.round(Math.max(wholesale * 1.4, msrp * 0.55) * 100) / 100
      : map < msrp
        ? Math.round(map * 100) / 100
        : Math.round(msrp * 100) / 100

    // Gather images
    const images: string[] = []
    for (let n = 1; n <= 10; n++) {
      const url = row?.[`Image ${n}`] ?? ''
      if (url.trim()) images.push(url.trim())
    }

    return {
      sku:          sv.sku,
      optionValues,
      price,
      compareAtPrice: msrp,
      qty,
      wholesale,
      images,
      upc: sv.upc,
    }
  })

  // Last-resort guard: if two variants still share an identical option tuple
  // after the twists above, keep the highest-qty one per tuple so the Shopify
  // product create never 422s on a duplicate variant. Skip when there are no
  // axes — every tuple is empty there and the single-variant path applies.
  if (axes.length > 0) {
    const winnerByTuple = new Map<string, VariantBuild>()
    for (const vr of variantRows) {
      const k = vr.optionValues.join('|')
      const prev = winnerByTuple.get(k)
      if (!prev || vr.qty > prev.qty) winnerByTuple.set(k, vr)
    }
    if (winnerByTuple.size !== variantRows.length) {
      const winners = new Set(winnerByTuple.values())
      return { axes, variantRows: variantRows.filter(vr => winners.has(vr)) }
    }
  }

  return { axes, variantRows }
}

// ─── needs_review flag ────────────────────────────────────────────────────────

/** Masters with >30 variants are likely grouping errors — flag for human review. */
export const NEEDS_REVIEW_THRESHOLD = 30

export function needsReview(master: MasterRecord): boolean {
  return master.variantCount > NEEDS_REVIEW_THRESHOLD
}
