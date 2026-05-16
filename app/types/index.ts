// ─── Vault Filter Tabs ────────────────────────────────────────────────────

export type VaultFilterTab = {
  id: string
  label: string
  slug: string
  filter:
    | { type: 'all' }
    | { type: 'collection'; handle: string }
    | { type: 'price'; max: number }
}

// ─── Product / Deal ────────────────────────────────────────────────────────

export interface ProductImage {
  url: string
  altText: string
}

export interface ProductVideo {
  previewImageUrl: string
  sources: { url: string; mimeType: string }[]
  aspect?: 'portrait' | 'landscape' | 'square'
  width?: number
  height?: number
}

export interface ProductVariant {
  id: string
  title: string
  selectedOptions: { name: string; value: string }[]
  image?: ProductImage
  price: string
  compareAtPrice: string | null
  availableForSale: boolean
  quantityAvailable: number
  barcode?: string
  originalDescription?: string
}

// v2 redesign — sensation dial + hero video
// Phase 1 rebuild — hierarchical taxonomy. Top-level is the closed enum below;
// the per-parent subtype lives in custom.product_subtype_dial. See
// PRODUCT_SUBTYPES_BY_TYPE in app/lib/claude.server.ts for the per-parent enum.
// Migration note: old values `air-pulsation` and `wand` are now subtypes under
// `vibrator` parent. Existing products are reclassified during the Phase 1
// backfill pass; downstream readers (dial-registry, SensationDial, emma-aside)
// degrade gracefully for unknown top-level types until Sanity content catches up.
export type ProductTypeDial =
  | 'vibrator' | 'dildo' | 'anal' | 'bondage' | 'cock-ring' | 'stroker'
  | 'couples' | 'harness' | 'extender' | 'pump' | 'lube' | 'massage'
  | 'enhancer' | 'wear' | 'condom' | 'wellness' | 'novelty' | 'book-media'
  | 'sex-machine'

/** Closed list of top-level ProductTypeDial values — runtime equivalent of the
 *  TypeScript union. Useful for validation and iteration. */
export const PRODUCT_TYPE_DIALS = [
  'vibrator', 'dildo', 'anal', 'bondage', 'cock-ring', 'stroker',
  'couples', 'harness', 'extender', 'pump', 'lube', 'massage',
  'enhancer', 'wear', 'condom', 'wellness', 'novelty', 'book-media',
  'sex-machine',
] as const satisfies readonly ProductTypeDial[]

/** Per-parent subtype enum. Closed list per top-level type; `null` when
 *  classification is `sex-machine` (no subtype) or too ambiguous to commit.
 *  Validated at runtime against PRODUCT_SUBTYPES_BY_TYPE. */
export type ProductSubtypeDial =
  // vibrator subtypes
  | 'bullet-egg' | 'rabbit' | 'g-spot' | 'finger-clit' | 'wand'
  | 'air-pulsation' | 'rotating-thrusting' | 'remote' | 'wearable'
  // dildo subtypes
  | 'realistic' | 'glass-metal' | 'silicone' | 'dual-density' | 'non-phallic'
  | 'vibrating' | 'packer' | 'large'
  // anal subtypes
  | 'plug' | 'prostate' | 'beads' | 'dilator' | 'douche-enema'
  // bondage subtypes
  | 'paddle-whip' | 'restraint' | 'blindfold' | 'gag' | 'collar-leash'
  | 'nipple' | 'body-harness' | 'sensory' | 'electrostim'
  // cock-ring subtypes
  | 'classic' | 'cock-ball-sling' | 'ball-stretcher' | 'set'
  // stroker subtypes
  | 'vagina' | 'mouth' | 'pocket' | 'non-realistic' | 'doll' | 'disposable'
  // couples subtypes
  | 'game-romance' | 'bedroom-accessory' | 'positioning-aid' | 'swing-sling'
  // harness subtypes
  | 'fabric' | 'leather' | 'vegan-leather' | 'o-ring' | 'set-kit'
  // extender subtypes
  | 'sling' | 'sleeve' | 'strap-on'
  // pump subtypes
  | 'penis'
  // lube subtypes (note: 'anal' here is a lube-base subtype, not the top-level
  // anal category — both share the same literal string; TS unions tolerate it)
  | 'water-based' | 'silicone-based' | 'hybrid' | 'flavored' | 'natural'
  | 'anal' | 'warming-cooling' | 'toy-cleaner'
  // massage subtypes
  | 'body-care' | 'candle' | 'perfume-pheromone' | 'hygiene' | 'cbd'
  // enhancer subtypes
  | 'desensitizer-relaxer' | 'oral' | 'arousal-gel' | 'male-arousal'
  | 'female-arousal' | 'gummy-edible' | 'pill'
  // wear subtypes
  | 'mens-underwear' | 'panty' | 'bra-panty-set' | 'bodysuit-teddy'
  | 'bodystocking' | 'hosiery' | 'pasty' | 'apparel' | 'sock' | 'accessory'
  | 'plus-queen'
  // condom subtypes
  | 'glyde' | 'trojan' | 'lifestyles' | 'durex'
  // wellness subtypes
  | 'kegel' | 'aftercare'
  // novelty subtypes
  | 'candy-edible' | 'pin-keychain' | 'game' | 'plushie-pillow'
  | 'novelty-gift' | 'party-supply'
  // book-media subtypes
  | 'book' | 'coloring-book'

/** @deprecated Use SensationDialV2 — kept for read-fallback only. */
export interface SensationDial {
  intensity?:      number
  quietness?:      number
  softness?:       number
  suction?:        number
  buildup?:        number
  learningCurve?:  number
  patternVariety?: number
  reach?:          number
  slipperiness?:   number
  longevity?:      number
  fit?:            number
  [key: string]:   number | undefined
}

export type DialValue = 1 | 2 | 3 | 4 | 5

export interface SensationDialItem {
  label:    string
  value:    DialValue
  proposed?: boolean
}

export interface SensationDialV2 {
  items: SensationDialItem[]
}

export type CareInstructions = string[]

export interface HeroVideo {
  src:      string
  poster?:  string
  duration: number
}

export type EmmaHeroVariant = 'loving' | 'bundle' | 'quote'

export interface EmmaHeroCopy {
  variant:     EmmaHeroVariant
  eyebrow:     string
  headline:    string
  body:        string
  aside:       string
  pullQuote?:  string
  generatedAt: string
  voiceHash:   string
}

/** Quiet-endorsement homepage template copy (Haiku-generated, stored per product). */
export interface QuietEndorsementCopy {
  eyebrow:        string
  subhead:        string
  body:           string
  bannerHeadline: string
}

export interface PairBundleCopyWhyCard { head: string; body: string }
export interface PairBundleCopyMoment  { lead: string; body: string }

/**
 * Endorsement homepage template copy — single product editorial card.
 * Generated by Claude per primary product. The hero renders a left
 * "Emma says" card and a right product card with a small contextual rail
 * stack rendered below the hero. Distinct from QuietEndorsementCopy which
 * is a different (older) layout.
 */
export interface EndorsementContextRail {
  /** Rail heading shown to shoppers (e.g. "Emma's slow-burn picks"). */
  title:             string
  /** Optional collection handle to source the rail from. */
  collectionHandle?: string
  /** Optional explicit product handles for the rail (overrides collection). */
  productHandles?:   string[]
}
export interface EndorsementCopy {
  /** One-line "what Emma's about right now" tagline shown next to her avatar. */
  emmaIntro:                string
  /** Three-line editorial pull quote about the product, in Emma's voice.
   *  Wrap any phrases that should highlight in coral with `_underscores_`. */
  quote:                    string
  /** Optional override for the secondary CTA label. Defaults to "I'm also into". */
  alsoIntoLabel?:           string
  /** Collection handle linked from the secondary CTA. */
  alsoIntoCollectionHandle?: string
  /** Sticky-note label shown above the avatar (e.g. "quiet endorsement · works for MAP-restricted"). */
  noteLabel?:               string
  /** Contextual product rails Emma curates below the hero. */
  rails?:                   EndorsementContextRail[]
  generatedAt?:             string
}

/** Pair-bundle homepage template copy (Haiku-generated per primary product).
 *  The Pair bundle · Full Bleed template (the only live pair template) renders
 *  `headline`, `emmaByline`, `knotCaption`, `whyCards`, `emmaQuote`, `momentTitle`,
 *  and `moments`. The other fields are retained as optional so legacy metafields
 *  written by the deprecated `pair_bundle` template still parse without error. */
export interface PairBundleCopy {
  headline:     string
  /** Short Emma-voice continuation of "Picked by Emma." shown next to her avatar
   *  in the Full Bleed hero. e.g. "two picks I think really click together". */
  emmaByline?:  string
  pairedHandle: string
  generatedAt:  string
  knotCaption:  string
  whyCards:     PairBundleCopyWhyCard[]
  emmaQuote:    string
  momentTitle:  string
  moments:      PairBundleCopyMoment[]
  // ── Legacy fields (deprecated `pair_bundle` template — Full Bleed ignores) ──
  eyebrow?:     string
  subhead?:     string
  body?:        string
  bannerLine?:  string
  primaryTag?:  string
  partnerTag?:  string
  /** @deprecated never rendered; superseded by emmaByline */
  conciergeSalutation?: string
}

export interface Deal {
  id: string
  shopifyProductId: string
  sku: string
  handle: string
  seoTitle: string
  tagline: string
  fullStory: string
  worksForHim: string
  worksForHer: string
  boxContents: string[]
  /** Phase 2 — string[] of "Label: Value" spec bullet pairs (e.g.
   *  ["Color: Black", "Material: Nylon straps"]). Mirrors care/box bullet shape;
   *  renders as a `<ul>` in the Specs grid card. Stored on Shopify as
   *  xdipx.specifications (JSON-stringified). */
  specifications?: string[]
  images: ProductImage[]
  videos: ProductVideo[]
  moodImageUrl?: string
  dealPrice: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  brand: string
  /** Phase 2 — multi-select. Empty array = unspecified. The legacy single-value
   *  `'both'` is now expressed as `['for-him', 'for-her']`. */
  category: Array<'for-him' | 'for-her' | 'couples'>
  dealStatus: 'draft' | 'scheduled' | 'live' | 'archived'
  dealDate: string
  qty: number
  accessoryProductIds: string[]
  metaDescription: string
  rawDescription?: string
  dealScore?: number
  nalpacSku?: string
  variantId: string
  variants?: ProductVariant[]
  options?: { name: string; values: string[] }[]
  sellingPlanGroups?: SellingPlanGroup[]
  tags: string[]
  rating?: { value: number; count: number }
  // v2 redesign metafields (all optional — legacy products skip gracefully)
  mapRestricted?:          boolean
  heroVideo?:              HeroVideo
  moodTags?:               string[]
  audienceTags?:           string[]
  mattersTags?:            string[]
  productTypeDial?:        ProductTypeDial
  /** @deprecated Use sensationDialV2 — read-fallback only. */
  sensationDial?:          SensationDial
  sensationDialV2?:        SensationDialV2
  careInstructions?:       CareInstructions
  /** Sanitized HTML from Shopify product.descriptionHtml — Emma's take, rendered in PDP tab #1. */
  descriptionHtml?:        string
  pairingWhy?:             Record<string, string>
  emmaHero?:               EmmaHeroCopy
  quietEndorsementCopy?:   QuietEndorsementCopy
  pairBundleCopy?:         PairBundleCopy
  endorsementCopy?:        EndorsementCopy
  /** Shopify collection memberships — used for breadcrumb resolution against the main menu. */
  collections?:            { handle: string; title: string }[]
  /** Shopify Product.createdAt — fed to JSON-LD `datePublished`. */
  createdAt?:              string
  /** Shopify Product.updatedAt — fed to JSON-LD `dateModified`. */
  updatedAt?:              string
}

export interface Product {
  id: string
  handle: string
  title: string
  seoTitle?: string
  metaDescription?: string
  images: ProductImage[]
  videos: ProductVideo[]
  variants: ProductVariant[]
  price: number
  compareAtPrice?: number
  brand?: string
  tags: string[]
  category?: string
  sellingPlanGroups?: SellingPlanGroup[]
  rating?: { value: number; count: number }
  // v2 redesign — Ask Emma tag facets
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  // v2 redesign — 9:16 card hero video
  heroVideo?:    HeroVideo
}

/**
 * Legacy single-value category. The canonical `Deal.category` is now an array
 * (Phase 2 multi-select), but several legacy sinks — analytics events
 * (`item_category`), social posts, video gen prompts, Sanity emmaCuratedRail —
 * still want a single string. This collapses the array to the closest legacy
 * value: 'both' when empty or split for-him+for-her, 'couples' when present,
 * otherwise the first entry.
 */
export function categoryToLegacyString(
  c: ReadonlyArray<'for-him' | 'for-her' | 'couples'> | string | undefined,
): string {
  if (typeof c === 'string') return c
  if (!c || c.length === 0) return 'both'
  if (c.includes('couples')) return 'couples'
  if (c.length >= 2 && c.includes('for-him') && c.includes('for-her')) return 'both'
  return c[0] ?? 'both'
}

export interface VaultDeal {
  id: string
  handle: string
  seoTitle: string
  dealDate: string
  dealPrice: number
  msrp: number
  images: ProductImage[]
  brand: string
  /** Phase 2 — multi-select audience tags. Empty array = unspecified. */
  category: Array<'for-him' | 'for-her' | 'couples'>
  dealStatus: 'draft' | 'scheduled' | 'live' | 'archived'
  qty: number
  defaultVariantId?:    string | null
  hasMultipleVariants?: boolean
  /** Card-level option preview for the lower-right swatch on PLP cards. */
  colorValues?: string[]
  sizeValues?:  string[]
  /** Set when variants span a price range; both equal `dealPrice` otherwise. */
  priceMin?:    number
  priceMax?:    number
  /** Biggest (compareAtPrice - price) seen across variants, when any variant has a discount. */
  maxSavingsAmount?:  number
  maxSavingsPercent?: number
  // v2 redesign — tag facets for Ask Emma filtering
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  // v2 redesign — 9:16 card hero video
  heroVideo?:    HeroVideo
  // GMC feed fields (all optional — absent on products not yet backfilled)
  /** First variant barcode (UPC/GTIN) — null when not set. */
  barcode?: string | null
  /** xdipx.seo_meta_description */
  seoDesc?: string | null
  /** xdipx.mood_image_url */
  moodImageUrl?: string | null
  /** xdipx.feature_bullets — JSON array of strings */
  featureBullets?: string[]
  /** xdipx.specifications — JSON array of "Label: Value" strings */
  specifications?: string[]
  /** xdipx.product_type_dial */
  productTypeDial?: string | null
  /** xdipx.original_price (already mapped to msrp but kept raw for feed) */
  originalPrice?: string | null
  // mm-google-shopping metafields
  gmcCategory?:  string | null
  gmcAgeGroup?:  string | null
  gmcGender?:    string | null
  gmcMpn?:       string | null
  gmcColor?:     string | null
  gmcMaterial?:  string | null
  gmcSize?:      string | null
  gmcLabel0?:    string | null
  gmcLabel1?:    string | null
  gmcLabel2?:    string | null
  gmcLabel3?:    string | null
  gmcLabel4?:    string | null
  /** xdipx.deal_score — numeric 0-100 score used for custom_label_2 tier derivation */
  dealScore?: number | null
  /** xdipx.is_daily_deal — true when this product is the active daily deal */
  isDailyDeal?: boolean
}

// ─── Bundles ──────────────────────────────────────────────────────────────

export interface BundleComponent {
  product: Product
  quantity: number
}

export interface Bundle {
  handle: string
  title: string
  tagline?: string
  images: ProductImage[]
  moodImageUrl?: string
  components: BundleComponent[]
  discountPct: number
  /** Sum of component MSRPs × quantities (pre-discount). */
  originalTotal: number
  /** originalTotal after discountPct is applied. */
  bundlePrice: number
  /** Shopify tag to attach to the cart so a Shopify Automatic Discount can target this bundle. */
  bundleTag: string
}

// ─── Selling Plans / Subscriptions ───────────────────────────────────────

export interface SellingPlanPriceAdjustment {
  adjustmentValue:
    | { __typename: 'SellingPlanPercentagePriceAdjustment'; adjustmentPercentage: number }
    | { __typename: 'SellingPlanFixedAmountPriceAdjustment'; adjustmentAmount: { amount: string; currencyCode: string } }
    | { __typename: 'SellingPlanFixedPriceAdjustment'; price: { amount: string; currencyCode: string } }
}

export interface SellingPlan {
  id: string
  name: string
  description?: string
  options: { name: string; value: string }[]
  recurringDeliveries: boolean
  priceAdjustments: SellingPlanPriceAdjustment[]
}

export interface SellingPlanGroup {
  name: string
  appName: string
  options: { name: string; values: string[] }[]
  sellingPlans: SellingPlan[]
}

// ─── Cart ─────────────────────────────────────────────────────────────────

export interface CartLine {
  id: string
  quantity: number
  merchandise: {
    id: string
    title: string
    product: {
      id: string
      title: string
      handle: string
      images: ProductImage[]
    }
    price: { amount: string; currencyCode: string }
  }
  sellingPlanAllocation?: {
    sellingPlan: { id: string; name: string }
    discountPct?: number
  }
}

export interface Cart {
  id: string
  checkoutUrl: string
  totalQuantity: number
  lines: CartLine[]
  cost: {
    subtotalAmount: { amount: string; currencyCode: string }
    totalAmount:    { amount: string; currencyCode: string }
  }
}

// ─── Emma Cart Context (drawer personalization) ──────────────────────────

export type EmmaCartVariant =
  | 'first-timer'
  | 'repeat'
  | 'gift'
  | 'free-ship-adjacent'
  | 'back-after-abandon'

export interface EmmaCartContext {
  variant:      EmmaCartVariant
  greeting:     string
  body:         string
  contextFacts: string[]
  pairing:      Product | null
  pairingWhy:   string
  freeShip: {
    threshold: number
    remaining: number
    progress:  number
  }
}

// ─── Nalpac Feed ──────────────────────────────────────────────────────────

export interface NalpacProduct {
  SKU: string
  'UPC/barcode': string
  'Product Title': string
  'Product Description': string
  'Image 1': string
  'Image 2': string
  'Image 3': string
  'Image 4': string
  'Image 5': string
  'Image 6': string
  'Image 7': string
  'Image 8': string
  'Image 9': string
  'Image 10': string
  Wholesale: string
  MSRP: string
  MAP: string
  'Nalpac qty available': string
  'Entrenue qty available': string
  'Total qty available': string
  'Fluid Oz': string
  Brand: string
  Material: string
  Color: string
  'Main Category': string
  'Sub-Category': string
  Size: string
}

export interface ProductScore {
  sku: string
  title: string
  brand: string
  description: string
  score: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  dealPrice: number
  discountPct: number
  profitPerUnit: number
  qty: number
  mapType: 'no-map' | 'below-msrp' | 'equals-msrp'
  images: string[]
  categories: string[]
}

// ─── DB / Deals ───────────────────────────────────────────────────────────

export type DealHistoryStatus = 'draft' | 'scheduled' | 'live'

export interface DealHistoryRow {
  id: number
  sku: string
  seoTitle: string | null
  brand: string | null
  categories: string[] | null
  dealDate: string
  wholesaleCost: string | null
  dealPrice: string | null
  msrp: string | null
  mapPrice: string | null
  unitsAvailable: number | null
  unitsSold: number
  totalRevenue: string
  totalProfit: string
  dealScore: string | null
  vaultPrice: string | null
  status: DealHistoryStatus
  shopifyProductId: string | null
  createdAt: Date
  activatedAt: Date | null
  completedAt: Date | null
}

export interface DailyProfitSummaryRow {
  summaryDate: string
  totalOrders: number | null
  totalRevenue: string | null
  totalCogs: string | null
  totalProfit: string | null
  avgOrderValue: string | null
  featuredSku: string | null
  adSpend: string
}

// ─── Admin ─────────────────────────────────────────────────────────────────

export interface GenerateCopyRequest {
  type: 'tagline' | 'full_story' | 'both_ways' | 'box_contents' | 'bullets' | 'email_subjects' | 'seo_meta' | 'specifications' | 'quiet_endorsement' | 'pair_bundle' | 'blog_article' | 'endorsement'
  product: {
    title: string
    brand: string
    description: string
    categories: string[]
    dealPrice?: number
    msrp?: number
    mapRestricted?: boolean
    /** Product type dial — used by SEO keyword filter to scope candidate terms. */
    productTypeDial?: ProductTypeDial
    /** Editorial tag overlap inputs for SEO keyword selection. */
    moodTags?: string[]
    audienceTags?: string[]
    mattersTags?: string[]
    partner?: {
      title:       string
      brand:       string
      description: string
      categories:  string[]
      dealPrice?:  number
    }
  }
  /**
   * Optional editorial author slug. When set, the author's voiceRules are
   * appended to the brand-voice system prompt and seoMode is honored for
   * keyword targeting. Defaults to the base brand voice with seoMode=natural.
   */
  authorSlug?: string
  /**
   * Optional topic — required for blog_article generation. Drives keyword
   * selection and outline.
   */
  topic?: string
  /**
   * Toggle keyword targeting. Defaults to 'natural'. Set 'off' to skip the
   * keyword bank entirely (e.g. internal admin previews).
   */
  seoMode?: 'aggressive' | 'natural' | 'off'
  /**
   * Roster of published Shopify collections — the AI picks from this list
   * when populating endorsement `alsoIntoCollectionHandle` and `rails[].collectionHandle`
   * so handles always resolve. Required for `endorsement` to populate handles.
   */
  availableCollections?: { handle: string; title: string; description?: string }[]
}

/** Blog article generation output — Sanity Portable Text body + metadata. */
export interface BlogArticleCopy {
  title:           string
  slug:            string
  excerpt:         string
  seoTitle:        string
  seoDescription:  string
  /** Sanity Portable Text array — compatible with blogPost.body. */
  body:            unknown[]
  /** Keyword cluster slug this article targets (from the keyword bank). */
  clusterSlug?:    string
}

export interface GenerateCopyResult {
  type: string
  content: string | string[] | { forHim: string; forHer: string } | QuietEndorsementCopy | PairBundleCopy | BlogArticleCopy | EndorsementCopy
}

// ─── Klaviyo ──────────────────────────────────────────────────────────────

export interface KlaviyoProfile {
  email: string
  firstName?: string
  properties?: Record<string, unknown>
}

// ─── Consent ──────────────────────────────────────────────────────────────

export type ConsentType = 'all' | 'essential_only'
export type VerificationLevel = 'click_through' | 'dob_entry' | 'id_verify'

// ─── Bulk Import ──────────────────────────────────────────────────────────

export interface BulkImportRow extends NalpacProduct {
  'Master SKU': string
  'Variant Option Name': string
  'Variant Option Value': string
  'Variant Option Name 2': string
  'Variant Option Value 2': string
  'Nav Category': string
  'Nav Path': string
  Collections: string
  MPN: string
}

export interface BulkVariantRow {
  sku: string
  /** Length 1 for single-axis groups, 2 for two-axis groups. Index 0 = primary option, index 1 = secondary. */
  optionValues: string[]
  price: number
  compareAtPrice: number
  qty: number
  wholesale: number
  images: string[]
}

export interface MasterProductGroup {
  masterRow: BulkImportRow
  variants: BulkVariantRow[]
  isSingleVariant: boolean
}

export interface BulkImportJob {
  jobId: string
  status: 'idle' | 'running' | 'paused' | 'done' | 'error'
  total: number
  processed: number
  skipped: number
  failed: number
  errors: { sku: string; message: string; level?: 'error' | 'warning' }[]
  parseErrors: { sku: string; message: string }[]
  groups: MasterProductGroup[]
  currentIndex: number
  startedAt: string
  updatedAt: string
}

/** BulkImportJob without the groups array — safe to send to the client */
export type BulkImportJobSummary = Omit<BulkImportJob, 'groups'>
