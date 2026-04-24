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
}

// v2 redesign — sensation dial + hero video
export type ProductTypeDial = 'air-pulsation' | 'vibrator' | 'wand' | 'lube' | 'wear'

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

/** Pair-bundle homepage template copy (Haiku-generated per primary product). */
export interface PairBundleCopy {
  eyebrow:      string
  subhead:      string
  headline:     string
  body:         string
  bannerLine:   string
  pairedHandle: string
  generatedAt:  string
  primaryTag:   string
  partnerTag:   string
  knotCaption:  string
  whyCards:     PairBundleCopyWhyCard[]
  emmaQuote:    string
  momentTitle:  string
  moments:      PairBundleCopyMoment[]
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
  specifications?: string
  images: ProductImage[]
  videos: ProductVideo[]
  moodImageUrl?: string
  dealPrice: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  brand: string
  category: 'for-him' | 'for-her' | 'both' | 'couples'
  dealStatus: 'draft' | 'scheduled' | 'live'
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
  sensationDial?:          SensationDial
  pairingWhy?:             Record<string, string>
  emmaHero?:               EmmaHeroCopy
  quietEndorsementCopy?:   QuietEndorsementCopy
  pairBundleCopy?:         PairBundleCopy
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

export interface VaultDeal {
  id: string
  handle: string
  seoTitle: string
  dealDate: string
  dealPrice: number
  msrp: number
  images: ProductImage[]
  brand: string
  category: string
  dealStatus: 'draft' | 'scheduled' | 'live' | 'archived'
  qty: number
  // v2 redesign — tag facets for Ask Emma filtering
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  // v2 redesign — 9:16 card hero video
  heroVideo?:    HeroVideo
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
  type: 'tagline' | 'full_story' | 'both_ways' | 'box_contents' | 'email_subjects' | 'seo_meta' | 'specifications' | 'quiet_endorsement' | 'pair_bundle'
  product: {
    title: string
    brand: string
    description: string
    categories: string[]
    dealPrice?: number
    msrp?: number
    mapRestricted?: boolean
    partner?: {
      title:       string
      brand:       string
      description: string
      categories:  string[]
      dealPrice?:  number
    }
  }
}

export interface GenerateCopyResult {
  type: string
  content: string | string[] | { forHim: string; forHer: string } | QuietEndorsementCopy | PairBundleCopy
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
  'Nav Category': string
  'Nav Path': string
  Collections: string
  MPN: string
}

export interface BulkVariantRow {
  sku: string
  optionValue: string
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
  errors: { sku: string; message: string }[]
  parseErrors: { sku: string; message: string }[]
  groups: MasterProductGroup[]
  currentIndex: number
  startedAt: string
  updatedAt: string
}

/** BulkImportJob without the groups array — safe to send to the client */
export type BulkImportJobSummary = Omit<BulkImportJob, 'groups'>
