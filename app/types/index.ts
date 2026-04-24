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
  featureBullets: string[]
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
  type: 'tagline' | 'full_story' | 'both_ways' | 'bullets' | 'box_contents' | 'email_subjects' | 'seo_meta' | 'specifications'
  product: {
    title: string
    brand: string
    description: string
    categories: string[]
    dealPrice?: number
    msrp?: number
  }
}

export interface GenerateCopyResult {
  type: string
  content: string | string[] | { forHim: string; forHer: string }
}

// ─── Klaviyo ──────────────────────────────────────────────────────────────

export interface KlaviyoProfile {
  email: string
  firstName?: string
  properties?: Record<string, unknown>
}

// ─── Consent ──────────────────────────────────────────────────────────────

export type ConsentType = 'all' | 'essential_only' | 'chat'
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
