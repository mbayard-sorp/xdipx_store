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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
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

// ─── Emma Curated Rail (agent-generated cross-sell) ──────────────────────

export interface EmmaCuratedRailBlock {
  _type: 'emmaCuratedRail'
  _key: string
  _id?: string
  active: boolean
  order: number
  heading: string
  eyebrow?: string
  emmaAside?: string
  productHandles?: { handle: string }[]
  layout?: 'carousel' | 'grid' | 'grid-3'
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
  ctaLink?: string
  ctaLabel?: string
  target?: 'homepage' | 'pdp'
  status?: 'draft' | 'approved' | 'live' | 'archived'
  sourceDealId?: string
  generatedAt?: string
  rationale?: string
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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
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
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
}

// ─── Bonus Deal ──────────────────────────────────────────────────────────

export interface BonusDealBlock {
  _type: 'bonusDeal'
  _key: string
  active: boolean
  order: number
  heading?: string
  eyebrow?: string
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
}

// ─── Wayfinder Mosaic ("Find your way in") ────────────────────────────────

export interface WayfinderTile {
  _key: string
  label: string
  link: string
  emmaAside?: string
  image?: SanityImageAsset
}

export interface WayfinderPromo {
  eyebrow?: string
  heading?: string
  emphasis?: string
  body?: string
  ctaLabel?: string
  ctaLink?: string
  image?: SanityImageAsset
}

export interface WayfinderMosaicBlock {
  _type: 'wayfinderMosaic'
  _key: string
  active: boolean
  order: number
  eyebrow?: string
  heading?: string
  emphasis?: string
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
  wayfinderTiles?: WayfinderTile[]
  promo?: WayfinderPromo
}

// ─── Trust Bar ───────────────────────────────────────────────────────────

export type TrustIcon = 'lock' | 'shield' | 'package' | 'heart' | 'truck' | 'star' | 'leaf' | 'chat'

export interface TrustItem {
  icon: TrustIcon
  headline: string
  subheadline?: string
  active?: boolean
}

export interface TrustBarBlock {
  _type: 'trustBar'
  _key: string
  active: boolean
  order: number
  trustItems?: TrustItem[]
  bgStyle?: 'white' | 'mist' | 'cream' | 'charcoal' | 'purple'
}

// PDP-wide defaults singleton — currently just the sitewide trust bar shown
// below the buy button on every product page. See app/lib/sanity.server.ts
// `getPdpTrustBar()`.
export interface PdpDefaults {
  trustBar: TrustBarBlock | null
}

// ─── Editor Bio Card ─────────────────────────────────────────────────────

export type EditorBioVariant = 'hero' | 'card' | 'quote'

export interface EditorBioBlock {
  _type: 'editorBio'
  _key: string
  active: boolean
  order: number
  variant: EditorBioVariant
  eyebrow?: string
  headingOverride?: string
  hideLongBio?: boolean
  hideSocials?: boolean
  bgStyle?: 'cream' | 'paper' | 'cream-2'
  showCta?: boolean
  editor?: {
    name: string
    role: string
    photoUrl: string | null
    photoAlt: string | null
    shortBio: string | null
    longBio: unknown[] | null
    picksSince: string | null
    instagram: string | null
    email: string | null
  } | null
}

// ─── Product FAQ ─────────────────────────────────────────────────────────

export type ProductFaqCategory =
  | 'general'
  | 'care'
  | 'usage'
  | 'compatibility'
  | 'shipping'

export interface ProductFaq {
  question:  string
  answer:    string
  category?: ProductFaqCategory
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

// ─── Related Guides (PDP) ────────────────────────────────────────────────
// Editor-curated Notebook posts for a product page. `guides` is resolved to
// card shape (published only) at query time in getProductPageBlocks.

export interface RelatedGuidesBlock {
  _type: 'relatedGuides'
  _key: string
  active: boolean
  order: number
  heading?: string
  guides: BlogPostCard[]
}

// ─── Union ────────────────────────────────────────────────────────────────

export type ContentBlock =
  | AnnouncementBarBlock
  | PromoBannerBlock
  | EditorialTilesBlock
  | CategoryGridBlock
  | ProductCarouselBlock
  | EmmaCuratedRailBlock
  | PlayTogetherBannerBlock
  | BrandLogoWallBlock
  | TestimonialsBlock
  | BonusDealBlock
  | TrustBarBlock
  | RichTextBlock
  | EditorBioBlock
  | WayfinderMosaicBlock
  | RelatedGuidesBlock

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

export interface SiteBanner {
  enabled?: boolean
  imageUrl?: string
  imageAlt?: string
  link?: string
}

export interface SiteSettings {
  _id: string
  logoUrl?: string
  logoAlt?: string
  buyButtonText?: string
  siteBanner?: SiteBanner
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
  | EmmaCuratedRailBlock
  | PlayTogetherBannerBlock
  | BrandLogoWallBlock
  | TestimonialsBlock
  | TrustBarBlock
  | RichTextBlock
  | EditorBioBlock

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

// v2 redesign — Emma hero settings (additive singleton)
export type EmmaHeroVariant = 'loving' | 'bundle' | 'quote'

export interface EmmaHeroSettings {
  heroVariant?: EmmaHeroVariant
  eyebrow?: string
  headline?: string
  body?: string
  aside?: string
  pullQuote?: string
  pairProductHandle?: string
  // Hero deep-linking. Merged in from the additive singleton.emmaHeroStorefront
  // doc by getEmmaHeroSettings(); both unset = default hero CTA behavior.
  primaryCtaLabel?: string
  primaryCtaLink?: string
  // Pinnable headliner, also merged in from singleton.emmaHeroStorefront. When
  // set, the storefront hero image and peek link pin to this product handle
  // instead of rotating with the discovery shuffle. Unset = rotating behavior.
  featuredProductHandle?: string
}

// v2 redesign — Emma persona singleton (avatar + display name)
export interface EmmaPersona {
  avatarUrl:   string | null
  avatarAlt:   string | null
  displayName: string | null
}

// Editor persona singleton — powers hero byline + /about E-E-A-T
export interface Editor {
  name: string
  role: string
  photoUrl: string | null
  photoAlt: string | null
  shortBio: string | null
  longBio: unknown[] | null
  picksSince: string | null
  instagram: string | null
  email: string | null
}

// v2 redesign — Emma presets (Ask Emma rail)
export interface EmmaPreset {
  label:         string
  slug:          string
  narratorCopy?: string
  moodTags?:     string[]
  audienceTags?: string[]
  mattersTags?:  string[]
  priceMax?:     number
  featured?:     boolean
  order?:        number
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
  heroLqip?: string
  heroWidth?: number
  heroHeight?: number
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
  // Notebook redesign — additive fields joined at query time (all optional;
  // legacy posts render fine without any of them).
  prevPost?: BlogPostLink | null
  nextPost?: BlogPostLink | null
  extras?: BlogPostExtras | null
}

// Notebook redesign — lightweight link target for next/prev navigation.
export interface BlogPostLink {
  title: string
  slug: string
  heroImageUrl?: string
  heroLqip?: string
  category?: { name: string; slug: string; color?: string }
}

// Notebook redesign — optional per-post extras from the additive
// blogPostExtras doc type (deck, sources, series membership).
export interface BlogPostExtras {
  deck?: string
  sources?: { label: string; url?: string }[]
  reviewedNote?: string
  series?: BlogSeriesRef | null
  seriesOrder?: number
}

export interface BlogSeriesRef {
  title: string
  slug: string
  kicker?: string
  coverImageUrl?: string
  postCount?: number
}

// Notebook redesign — full series doc for /notebook/series/:slug.
export interface BlogSeries {
  title: string
  slug: string
  kicker?: string
  description?: string
  coverImageUrl?: string
  coverImageAlt?: string
  coverLqip?: string
  posts: BlogPostCard[]
}

// Notebook glossary — living reference at /notebook/glossary.
export interface GlossaryTerm {
  term: string
  slug: string
  definition: string
  collectionHandle?: string
  relatedPost?: { title: string; slug: string } | null
  seeAlso?: { term: string; slug: string }[]
}

// Notebook redesign — index-level settings singleton (additive; falls back to
// blogHomepage / hardcoded copy when absent).
export interface NotebookSettings {
  kicker?: string
  mastheadImageUrl?: string
  mastheadImageAlt?: string
  newsletterHeading?: string
  newsletterBody?: string
  newsletterButtonLabel?: string
}

// Notebook redesign — per-category presentation extras.
export interface BlogCategoryExtras {
  headerImageUrl?: string
  headerImageAlt?: string
  headerLqip?: string
  intro?: string
  accent?: string
}

// ─── Home Config (discovery rebuild) ─────────────────────────────────────────
// Singleton: singleton.homeConfig
// Controls which home page variant is active and lets editors override
// Emma's AI-generated contextual copy per chip-combination state.

export interface HomeConfig {
  activeVariant: 'a' | 'b' | 'off'
  welcomeBackEnabled: boolean
  emmaCopyOverrides: {
    intro?: string
    moodOnly?: string
    audOnly?: string
    mattersOnly?: string
    moodAud?: string
    moodMatters?: string
    audMatters?: string
    full?: string
  }
  analyticsLabel: string
}

// ─── Home SEO (SERP snippet) ─────────────────────────────────────────────────
// Singleton: singleton.homeSeo
// Team-editable homepage <title> + meta description. Blank fields fall back to
// the brand defaults in app/lib/brand.ts. This is the "update strategy" surface
// the strategy/merchandising team rotates against the marketing calendar.
export interface HomeSeo {
  seoTitle?: string
  seoDescription?: string
  ogImageUrl?: string
}
