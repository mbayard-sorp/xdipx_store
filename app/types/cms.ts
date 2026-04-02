// ─── Sanity CMS Block Types ────────────────────────────────────────────────

export interface SanityImageAsset {
  _type: 'image'
  asset: { _ref: string; _type: 'reference' }
  url?: string   // populated after image URL resolution
  alt?: string
}

// ─── Announcement Bar ─────────────────────────────────────────────────────

export interface AnnouncementMessage {
  text: string
  link?: string
  linkLabel?: string
}

export interface AnnouncementBarBlock {
  _type: 'announcementBar'
  _key: string
  active: boolean
  order: number
  messages: AnnouncementMessage[]
  rotationIntervalMs: number
  bgStyle: 'charcoal' | 'gradient' | 'purple'
}

// ─── Promo Banner ─────────────────────────────────────────────────────────

export interface PromoBannerBlock {
  _type: 'promoBanner'
  _key: string
  active: boolean
  order: number
  headline: string
  subtext?: string
  ctaLabel: string
  ctaLink: string
  image?: SanityImageAsset
  layout: 'text-only' | 'image-left' | 'image-right' | 'full-bleed'
  bgStyle: 'charcoal' | 'gradient' | 'mist' | 'purple' | 'cream'
}

// ─── Editorial Tiles ──────────────────────────────────────────────────────

export interface EditorialTile {
  label: string
  body?: string
  link: string
  linkLabel?: string
  image?: SanityImageAsset
  emoji?: string
}

export interface EditorialTilesBlock {
  _type: 'editorialTiles'
  _key: string
  active: boolean
  order: number
  eyebrow?: string
  heading: string
  tiles: EditorialTile[]
}

// ─── Category Grid ────────────────────────────────────────────────────────

export interface CategoryGridItem {
  label: string
  link: string
  image?: SanityImageAsset
  emoji?: string
}

export interface CategoryGridBlock {
  _type: 'categoryGrid'
  _key: string
  active: boolean
  order: number
  heading: string
  items: CategoryGridItem[]
  columns: 3 | 4 | 6
}

// ─── Product Carousel ─────────────────────────────────────────────────────

export interface ProductCarouselBlock {
  _type: 'productCarousel'
  _key: string
  active: boolean
  order: number
  heading: string
  eyebrow?: string
  shopifyTag: string
  productLimit: number
  ctaLink?: string
  ctaLabel?: string
  bgStyle?: 'white' | 'mist' | 'cream'
}

// ─── Play Together Banner ─────────────────────────────────────────────────

export interface PlayTogetherBannerBlock {
  _type: 'playTogetherBanner'
  _key: string
  active: boolean
  order: number
  heading: string
  body: string
  ctaLabel: string
  ctaLink: string
  image?: SanityImageAsset
  imagePosition: 'left' | 'right'
}

// ─── Brand Logo Wall ──────────────────────────────────────────────────────

export interface BrandLogo {
  brand: string
  logo?: SanityImageAsset
  emoji?: string
  link?: string
}

export interface BrandLogoWallBlock {
  _type: 'brandLogoWall'
  _key: string
  active: boolean
  order: number
  heading?: string
  logos: BrandLogo[]
}

// ─── Testimonials ─────────────────────────────────────────────────────────

export interface TestimonialItem {
  quote: string
  author: string
  rating: 1 | 2 | 3 | 4 | 5
  verified: boolean
}

export interface TestimonialsBlock {
  _type: 'testimonials'
  _key: string
  active: boolean
  order: number
  heading: string
  items: TestimonialItem[]
}

// ─── Union ────────────────────────────────────────────────────────────────

export type ContentBlock =
  | AnnouncementBarBlock
  | PromoBannerBlock
  | EditorialTilesBlock
  | CategoryGridBlock
  | ProductCarouselBlock
  | PlayTogetherBannerBlock
  | BrandLogoWallBlock
  | TestimonialsBlock

export interface HomepageSections {
  _id: string
  sections: ContentBlock[]
}

// ─── Site Settings ────────────────────────────────────────────────────────────

export type SocialPlatform = 'x' | 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'pinterest'

export interface SocialLink {
  _key: string
  platform: SocialPlatform
  handle: string
  url: string
}

export interface SiteSettings {
  _id: string
  logoUrl?: string
  logoAlt?: string
  socialLinks: SocialLink[]
}
