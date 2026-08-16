import type { ProductHandleEntry } from '~/lib/product-handles'

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
  /** RAW from Sanity: productRef objects OR bare strings. Flatten with
   *  `normalizeProductHandles()` (~/lib/product-handles) before use. */
  productHandles?: ProductHandleEntry[]
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
  /** RAW from Sanity: productRef objects OR bare strings. Flatten with
   *  `normalizeProductHandles()` (~/lib/product-handles) before use. */
  productHandles?: ProductHandleEntry[]
  /**
   * Deliberate anchor takeover. Default (false/unset) renders this rail BELOW
   * the always-on "Most picked, right now" bestseller grid. True hides the
   * anchor grid and gives this rail the Nº 03 slot. Publishing a rail used to
   * displace the anchor unconditionally, which silently removed the page's
   * bestseller wall.
   */
  replacesAnchor?: boolean
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
  /**
   * Optional couples rail under the band ("A few more, chosen for sharing").
   * RAW from Sanity: productRef objects OR bare strings. Flatten with
   * `normalizeProductHandles()` (~/lib/product-handles) before use. Empty/unset
   * hides the strip.
   */
  productHandles?: ProductHandleEntry[]
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

// ─── Homepage FAQ (Nº 11 band) ────────────────────────────────────────────
// Additive override for the storefront's hardcoded FAQ array. The SAME item
// set feeds the visible accordion and the FAQPage JSON-LD, so the two can
// never disagree. `faqItems` is the projected name (the Sanity field is
// `items`, renamed in GROQ to avoid colliding with the categoryGrid /
// testimonials `items` projection, same pattern as `trustItems`).

export interface HomepageFaqItem {
  question: string
  answer: string
}

export interface HomepageFaqBlock {
  _type: 'homepageFaq'
  _key: string
  active: boolean
  order: number
  heading?: string
  faqItems?: HomepageFaqItem[]
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
  | HomepageFaqBlock

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

/** Compact sitewide footer link (brand row / category row). */
export interface FooterQuickLink {
  _key: string
  label: string
  href: string
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
  footerBrandLinks?: FooterQuickLink[]
  footerCategoryLinks?: FooterQuickLink[]
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
  // One word within `headline` to italicize in the plum emphasis style (doctrine
  // §2, one-emphasis-word treatment). Merged in from the additive
  // singleton.emmaHeroStorefront doc by getEmmaHeroSettings(). Unset, or a word
  // not present in the headline, falls back to italicizing the last word.
  emphasisWord?: string
  body?: string
  aside?: string
  pullQuote?: string
  pairProductHandle?: string
  // Hero deep-linking. Merged in from the additive singleton.emmaHeroStorefront
  // doc by getEmmaHeroSettings(); both unset = default hero CTA behavior.
  primaryCtaLabel?: string
  primaryCtaLink?: string
  // Secondary (ghost) hero CTA, same singleton, same guards: internal paths
  // only and whitelist labels only. Unset label falls back to whichever
  // whitelist phrase the primary is not using; unset link falls back to
  // /collections/best-sellers (never the raw /collections index).
  secondaryCtaLabel?: string
  secondaryCtaLink?: string
  // Pinnable headliner, also merged in from singleton.emmaHeroStorefront. When
  // set, the storefront hero image and peek link pin to this product handle
  // instead of rotating with the discovery shuffle. Unset = rotating behavior.
  featuredProductHandle?: string
  // Anchor grid source, also merged in from singleton.emmaHeroStorefront. A
  // Shopify COLLECTION handle whose products fill the promoted Nº 03 grid in
  // curated order, instead of the raw discovery best-of ranking. Unset =
  // default best-sellers collection; empty/unreachable collection = discovery
  // best-of fallback.
  anchorCollectionHandle?: string
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
  /**
   * Additive, homepage-only situational portrait (Nº 04 Meet Emma band). Null
   * when unset; the homepage loader falls back to `photoUrl`. Not consumed by
   * /about or the video pipeline identity anchor, which stay on `photoUrl`.
   */
  homepagePhotoUrl: string | null
  homepagePhotoAlt: string | null
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
  /**
   * Handle of the first product the post embeds (`blogProductEmbed`), when the
   * query projects it. Optional and additive: only `getBlogPosts` supplies it,
   * and only `NotebookRail`'s opt-in `showProductChips` reads it. The Notebook
   * is ~21% of sessions with long dwell and no path to a product, so a card can
   * offer the product it is actually about.
   */
  productHandle?: string
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

// Comparison ("X vs Y") pages — the /compare/{slug} answer surface. Additive
// doc type; see studio/schemas/comparison.js.
export interface ComparisonItem {
  name: string
  /** Shopify handle, when the item is a catalog product (links to the PDP). */
  productHandle?: string
  blurb: string
  bestFor?: string
}

export interface ComparisonAttribute {
  label: string
  /** One value per item, aligned to the `items` order. */
  values: string[]
}

export interface ComparisonFaq {
  question: string
  answer: string
}

export interface ComparisonCard {
  _id: string
  title: string
  slug: string
  excerpt: string
  publishedAt: string
  featured: boolean
  itemNames: string[]
}

export interface Comparison extends ComparisonCard {
  _updatedAt?: string
  items: ComparisonItem[]
  attributes?: ComparisonAttribute[]
  verdict?: string
  body?: unknown[]
  faqs?: ComparisonFaq[]
  seoTitle?: string
  seoDescription?: string
  noIndex?: boolean
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

// ─── Storefront home layout ──────────────────────────────────────────────────
// Singleton: singleton.storefrontHome
//
// Band order plus the per-band chrome copy that used to be hardcoded in
// StorefrontHome. Additive and optional throughout: a null layout renders the
// shipped order, and every override field left blank keeps the band's shipped
// default. That is what makes an unpublished document a safe no-op and an
// unpublish a complete rollback.

/** Bands that can be ordered independently. Mirrors BAND_NAMES in
 *  app/components/store/StorefrontHome.tsx; the trust strip and mood pills are
 *  absent because both render inside the hero rather than beside it. */
export type HomeBandName =
  | 'hero'
  | 'anchorGrid'
  | 'teamRails'
  | 'meetEmma'
  | 'wayfinder'
  | 'emmasEdit'
  | 'sensationMap'
  | 'couples'
  | 'stillDeciding'
  | 'notebook'
  | 'faq'
  | 'emailCapture'

export interface HomeBandSection {
  _type: 'homeBand'
  _key: string
  band: HomeBandName
  enabled?: boolean
  eyebrow?: string
  heading?: string
  emphasis?: string
  body?: string
  ctaLabel?: string
  ctaLink?: string
}

export interface HomeMoodPill {
  label: string
  collectionHandle: string
}

export interface HomeMoodPillsSection {
  _type: 'homeMoodPills'
  _key: string
  enabled?: boolean
  prompt?: string
  pills?: HomeMoodPill[]
}

/** Placement marker only. The deck's content lives in singleton.panelDeck, so
 *  publishing the deck and showing the deck are two separate acts. */
export interface PanelDeckSection {
  _type: 'panelDeckSection'
  _key: string
  enabled?: boolean
}

export type StorefrontHomeSection =
  | HomeBandSection
  | HomeMoodPillsSection
  | PanelDeckSection

export interface StorefrontHomeLayout {
  note?: string
  sections: StorefrontHomeSection[]
}

// ─── Merchandised category / drop pages (resolved) ───────────────────────────
// Docs: categoryPage / dropPage, resolved server-side by
// app/lib/category-page.server.ts. Every value is renderable as-is: products
// are lean cards, images are URLs, Notebook refs are slugs. A block that
// failed to resolve is absent from the array — one bad block costs itself,
// never the page.

export interface CategoryCardProduct {
  id: string
  handle: string
  title: string
  price: number
  compareAtPrice: number | null
  /** xdipx.map_price when set and positive, else null. Gates the card's struck
   *  price + badge on the MAP rule (ticket #3675); null = no MAP. */
  mapPrice: number | null
  brand: string | null
  imageUrl: string | null
  imageAlt: string | null
  /** Up to three sensation-dial readings. Empty = product has no dial data,
   *  and the card renders no dial rather than a fabricated one. */
  dial: { label: string; value: number }[]
}

export interface ResolvedShelfNavTile {
  label: string
  anchorId: string
  count: number | null
}

export interface ResolvedDialAxis {
  label: string
  definition: string | null
  scaleLow: string | null
  scaleMid: string | null
  scaleHigh: string | null
}

export type ResolvedCategoryBlock =
  | {
      _type: 'categoryMasthead'
      key: string
      anchorId: string
      kicker: string | null
      headline: string
      italicWord: string | null
      standfirst: string | null
      imageUrl: string | null
      imageAlt: string | null
    }
  | {
      _type: 'shelfNav'
      key: string
      anchorId: string
      label: string
      sticky: boolean
      tiles: ResolvedShelfNavTile[]
    }
  | {
      _type: 'sensationLegend'
      key: string
      anchorId: string
      heading: string
      intro: string | null
      axes: ResolvedDialAxis[]
    }
  | {
      _type: 'editorialFeature'
      key: string
      anchorId: string
      kicker: string | null
      headline: string
      italicWord: string | null
      body: string | null
      ctaLabel: string
      product: CategoryCardProduct | null
      imageUrl: string | null
      imageAlt: string | null
    }
  | {
      _type: 'shelfSection'
      key: string
      anchorId: string
      title: string
      collectionHandle: string
      intro: string | null
      sortRationale: string | null
      seeAllLabel: string
      products: CategoryCardProduct[]
    }
  | {
      _type: 'learnStrip'
      key: string
      anchorId: string
      heading: string
      posts: { slug: string; title: string; heroImageUrl: string | null; excerpt: string | null }[]
    }
  | {
      _type: 'benefitEditorial'
      key: string
      anchorId: string
      heading: string | null
      claims: { claim: string; detail: string | null; source: string; sourceUrl: string | null }[]
    }
  | {
      _type: 'categoryTrust'
      key: string
      anchorId: string
      items: { headline: string; subheadline: string | null }[]
    }
  | {
      _type: 'chooserBlock'
      key: string
      anchorId: string
      heading: string
      options: { label: string; tag: string; narratorCopy: string | null }[]
    }
  | {
      _type: 'faqBlock'
      key: string
      anchorId: string
      heading: string
      items: { question: string; answer: string }[]
    }
  | {
      _type: 'dropMasthead'
      key: string
      anchorId: string
      period: string | null
      headline: string
      italicWord: string | null
      standfirst: string | null
      imageUrl: string | null
      imageAlt: string | null
    }
  | {
      _type: 'justLanded'
      key: string
      anchorId: string
      kicker: string
      body: string | null
      product: CategoryCardProduct | null
    }
  | {
      _type: 'dropTimeline'
      key: string
      anchorId: string
      heading: string
      entries: { label: string; note: string | null; products: CategoryCardProduct[] }[]
    }
  | {
      _type: 'makersNote'
      key: string
      anchorId: string
      heading: string
      body: string
    }
  | {
      _type: 'comingSoon'
      key: string
      anchorId: string
      heading: string | null
      body: string | null
      ctaLabel: string
    }

export interface ResolvedCategoryPage {
  handle: string
  blocks: ResolvedCategoryBlock[]
}

export interface ResolvedDropPage {
  routeKey: 'new' | 'on-sale'
  blocks: ResolvedCategoryBlock[]
}

// ─── Panel deck (resolved) ───────────────────────────────────────────────────
// Singleton: singleton.panelDeck, resolved server-side by getPanelDeck().
//
// Everything here is already a renderable value: hrefs resolved from
// panelLink (dead collection handles dropped at build time), image assets
// resolved to URLs, blogPost references resolved to slugs. JSON-safe — this
// shape rides the homepage payload blob.

export type PanelSurface =
  | 'blush'
  | 'lilac'
  | 'stone'
  | 'paper'
  | 'plum'
  | 'coral'
  | 'ink'

export type PanelDeckTheme = 'tint' | 'photo' | 'ruled'

export interface ResolvedPanelTile {
  key: string
  label: string
  surface: PanelSurface
  mark: string | null
  imageUrl: string | null
  imageAlt: string | null
  href: string
}

export interface ResolvedPanelLarge extends ResolvedPanelTile {
  kicker: string | null
  blurb: string | null
  ctaLabel: string | null
}

export interface ResolvedPanelSmall extends ResolvedPanelTile {
  meta: string | null
  figure: string | null
}

export type ResolvedPanelRow =
  | { kind: 'square'; key: string; items: ResolvedPanelTile[] }
  | { kind: 'large'; key: string; items: ResolvedPanelLarge[] }
  | { kind: 'small'; key: string; items: ResolvedPanelSmall[] }

export interface ResolvedPanelDeck {
  eyebrow: string | null
  theme: PanelDeckTheme
  showOrdinals: boolean
  rows: ResolvedPanelRow[]
}
