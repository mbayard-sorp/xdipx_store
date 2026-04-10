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
  source?: 'tag' | 'collection' | 'manual'
  shopifyTag?: string
  collectionHandle?: string
  productHandles?: { handle: string }[]
  productLimit: number
  layout?: 'carousel' | 'grid' | 'grid-3'
  ctaLink?: string
  ctaLabel?: string
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
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

// ─── Bonus Deal ──────────────────────────────────────────────────────────

export interface BonusDealBlock {
  _type: 'bonusDeal'
  _key: string
  active: boolean
  order: number
  heading?: string
  eyebrow?: string
}

// ─── Rich Text ───────────────────────────────────────────────────────────

export interface RichTextBlock {
  _type: 'richText'
  _key: string
  active: boolean
  order: number
  body: unknown[]
  bgColor: 'white' | 'cream' | 'mist' | 'charcoal' | 'purple'
  maxWidth: 'narrow' | 'medium' | 'wide'
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
  | BonusDealBlock
  | RichTextBlock

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

export interface MegaMenuBanner {
  _key: string
  menuLabel: string
  position: 'left' | 'right'
  link?: string
  imageUrl?: string
  imageAlt?: string
}

export interface FooterLink {
  _key: string
  label: string
  url: string
}

export interface FooterColumn {
  _key: string
  heading: string
  links: FooterLink[]
}

export interface SiteSettings {
  _id: string
  logoUrl?: string
  logoAlt?: string
  buyButtonText?: string
  megaMenuBanners?: MegaMenuBanner[]
  socialLinks: SocialLink[]
  footerTagline?: string
  footerDiscreetHeading?: string
  footerDiscreetBody?: string
  footerCopyright?: string
  footerDisclaimer?: string
  footerColumns?: FooterColumn[]
}

// ─── Generic Page ─────────────────────────────────────────────────────────────

// Pages can use all blocks except the site-wide announcementBar
export type PageSection =
  | PromoBannerBlock
  | EditorialTilesBlock
  | CategoryGridBlock
  | ProductCarouselBlock
  | PlayTogetherBannerBlock
  | BrandLogoWallBlock
  | TestimonialsBlock
  | RichTextBlock

export interface SanityPage {
  _id: string
  title: string
  slug: string
  seoTitle?: string
  seoDescription?: string
  sections: PageSection[]
}

// ─── Blog ────────────────────────────────────────────────────────────────────

export interface BlogAuthor {
  name: string
  slug: string
  bio?: string
  avatarUrl?: string
  role?: string
  socialLinks?: { platform: string; url: string }[]
}

export interface BlogHomepage {
  heading?: string
  subtext?: string
  heroImageUrl?: string
  heroImageAlt?: string
}

export interface BlogCategory {
  name: string
  slug: string
  description?: string
  color?: string
  seoTitle?: string
  seoDescription?: string
}

export interface BlogPostCard {
  _id: string
  title: string
  slug: string
  excerpt: string
  publishedAt: string
  featured: boolean
  heroImageUrl?: string
  heroImageAlt?: string
  author?: BlogAuthor
  category?: BlogCategory
  readingTime: number
}

export interface BlogPost extends BlogPostCard {
  _updatedAt?: string
  body: unknown[]
  seoTitle?: string
  seoDescription?: string
  ogImageUrl?: string
  noIndex?: boolean
  tags?: string[]
  relatedPosts?: BlogPostCard[]
}
