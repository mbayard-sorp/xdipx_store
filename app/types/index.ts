// ─── Product / Deal ────────────────────────────────────────────────────────

export interface ProductImage {
  url: string
  altText: string
}

export interface ProductVariant {
  id: string
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
  images: ProductImage[]
  moodImageUrl?: string
  dealPrice: number
  msrp: number
  wholesaleCost: number
  mapPrice: number
  brand: string
  category: 'for-him' | 'for-her' | 'both' | 'couples'
  dealStatus: 'pending_approval' | 'approved' | 'live' | 'archived'
  dealDate: string
  qty: number
  accessoryProductIds: string[]
  metaDescription: string
  dealScore?: number
  nalpacSku?: string
  variantId: string
  rating?: { value: number; count: number }
}

export interface Product {
  id: string
  handle: string
  title: string
  seoTitle?: string
  metaDescription?: string
  images: ProductImage[]
  variants: ProductVariant[]
  price: number
  compareAtPrice?: number
  brand?: string
  tags: string[]
  category?: string
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
  dealStatus: 'archived'
  qty: number
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
  score: number
  dealPrice: number
  discountPct: number
  profitPerUnit: number
  qty: number
  mapType: 'no-map' | 'below-msrp' | 'equals-msrp'
  images: string[]
  categories: string[]
}

// ─── DB / Deals ───────────────────────────────────────────────────────────

export type DealHistoryStatus = 'pending' | 'approved' | 'live' | 'archived'

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
  status: DealHistoryStatus
  shopifyProductId: string | null
  createdAt: Date
  activatedAt: Date | null
  archivedAt: Date | null
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
  type: 'tagline' | 'full_story' | 'both_ways' | 'bullets' | 'email_subjects' | 'seo_meta'
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
  content: string | string[]
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
