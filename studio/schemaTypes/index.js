import announcementBar    from '../schemas/blocks/announcementBar.js'
import promoBanner        from '../schemas/blocks/promoBanner.js'
import editorialTiles     from '../schemas/blocks/editorialTiles.js'
import categoryGrid       from '../schemas/blocks/categoryGrid.js'
import productCarousel    from '../schemas/blocks/productCarousel.js'
import playTogetherBanner from '../schemas/blocks/playTogetherBanner.js'
import brandLogoWall      from '../schemas/blocks/brandLogoWall.js'
import testimonials       from '../schemas/blocks/testimonials.js'
import bonusDeal          from '../schemas/blocks/bonusDeal.js'
import trustBar           from '../schemas/blocks/trustBar.js'
import blogImage          from '../schemas/blocks/blogImage.js'
import blogPullQuote      from '../schemas/blocks/blogPullQuote.js'
import blogProductEmbed   from '../schemas/blocks/blogProductEmbed.js'
import blogCta            from '../schemas/blocks/blogCta.js'
import blogVideoEmbed     from '../schemas/blocks/blogVideoEmbed.js'
import richText           from '../schemas/blocks/richText.js'
import editorBio          from '../schemas/blocks/editorBio.js'
import productFaq         from '../schemas/blocks/productFaq.js'
// Homepage — team-editable FAQ band (additive; the hardcoded array stays as the
// fallback when nothing is published).
import homepageFaq        from '../schemas/blocks/homepageFaq.js'
// PDP — editor-curated Related Guides rail (references to blogPost). Additive
// block on productPage.contentBlocks; reverse product -> guide link for AEO.
import relatedGuides      from '../schemas/blocks/relatedGuides.js'
import wayfinderMosaic    from '../schemas/blocks/wayfinderMosaic.js'
import homepageSections   from '../schemas/homepageSections.js'
import siteSettings       from '../schemas/siteSettings.js'
import pdpDefaults        from '../schemas/pdpDefaults.js'
import productPage        from '../schemas/productPage.js'
import page               from '../schemas/page.js'
import trustItem          from '../schemas/trustItem.js'
import blogPost           from '../schemas/blogPost.js'
import blogCategory       from '../schemas/blogCategory.js'
import blogAuthor         from '../schemas/blogAuthor.js'
import blogHomepage       from '../schemas/blogHomepage.js'
import emmaHeroSettings   from '../schemas/emmaHeroSettings.js'
// Hero deep-linking. CTA override singleton per docs/homepage-team/new-blocks.md
// (additive; emmaHeroSettings untouched).
import emmaHeroStorefront from '../schemas/emmaHeroStorefront.js'
import emmaPreset         from '../schemas/emmaPreset.js'
import emmaPick           from '../schemas/emmaPick.js'
import emmaContextRail    from '../schemas/emmaContextRail.js'
import emmaCuratedRail    from '../schemas/blocks/emmaCuratedRail.js'
import editor             from '../schemas/editor.js'
import castMember         from '../schemas/castMember.js'
import dialRegistry       from '../schemas/dialRegistry.js'
import dialTaxonomy       from '../schemas/dialTaxonomy.js'
import dialDimension      from '../schemas/dialDimension.js'
import askEmmaVocabulary  from '../schemas/askEmmaVocabulary.js'
// SEO keyword bank — auto-discovered terms + topic clusters powering all
// AI-written copy. Additive; does not touch existing schemas.
import seoKeyword         from '../schemas/seo/seoKeyword.js'
import seoCluster         from '../schemas/seo/seoCluster.js'
// Editorial queue: planned Notebook posts derived from the keyword bank
// (seo-curator plans weekly, content-writer consumes daily). Additive.
import seoContentBrief    from '../schemas/seo/seoContentBrief.js'
// Weekly podcast review handoff: podcast-reviewer writes one brief per week,
// content-writer turns the pending brief into the podcast-notes Notebook post.
// Additive.
import podcastReviewBrief from '../schemas/podcastReviewBrief.js'
// Weekly trend handoff: trend-scout proposes topics on Saturday, seo-curator
// adopts/skips/expires them in Sunday planning. Additive.
import trendTopicBrief    from '../schemas/trendTopicBrief.js'
// Multi-author voice profiles for AI-generated content (Emma + future agents).
import editorialAuthor    from '../schemas/authors/editorialAuthor.js'
import collectionPage     from '../schemas/collectionPage.js'
import collectionsHub     from '../schemas/collectionsHub.js'
// Phase 6d — Manufacturer specs data layer (additive; does not touch existing schemas).
import mfgProductSpecs    from '../schemas/mfgProductSpecs.js'

// Discovery home page rebuild — variant toggle + Emma copy overrides (additive).
import homeConfig          from '../schemas/homeConfig.js'

// Homepage SERP snippet — team-editable title/description "update strategy"
// (additive; falls back to app/lib/brand.ts defaults when blank). Singleton.
import homeSeo             from '../schemas/homeSeo.js'

// Notebook redesign — index settings, category/post extras, and series docs
// (additive; blogPost/blogCategory/blogAuthor/blogHomepage untouched).
import notebookSettings    from '../schemas/notebookSettings.js'
import blogCategoryExtras  from '../schemas/blogCategoryExtras.js'
import blogPostExtras      from '../schemas/blogPostExtras.js'
import blogSeries          from '../schemas/blogSeries.js'
// Notebook glossary — living reference at /notebook/glossary (additive).
import blogGlossaryTerm    from '../schemas/blogGlossaryTerm.js'

// Phase 6c — Knowledge-base doc types for SMS / IVR / chat kbLookup tool.
// Additive — existing schemas untouched.
import kbShippingPolicy    from '../schemas/kbShippingPolicy.js'
import kbReturnsPolicy     from '../schemas/kbReturnsPolicy.js'
import kbCompatibilityRule from '../schemas/kbCompatibilityRule.js'
import kbTroubleshooting   from '../schemas/kbTroubleshooting.js'
import kbBrandFaq          from '../schemas/kbBrandFaq.js'

// Social bio-link landing (/social), swappable product module singleton
// (additive; existing schemas untouched).
import socialLanding       from '../schemas/socialLanding.js'

// Panel deck — the doors below the storefront headliner. Deck singleton
// plus its row/tile object types. Additive; placed on the page by the
// storefrontHome layout singleton, so nothing renders until that enables it.
import panelLink           from '../schemas/blocks/panelLink.js'
import panelTile           from '../schemas/blocks/panelTile.js'
import panelSquareRow      from '../schemas/blocks/panelSquareRow.js'
import panelLarge          from '../schemas/blocks/panelLarge.js'
import panelSmall          from '../schemas/blocks/panelSmall.js'
import panelRowLarge       from '../schemas/blocks/panelRowLarge.js'
import panelRowSmall       from '../schemas/blocks/panelRowSmall.js'
import panelDeck           from '../schemas/panelDeck.js'

// Storefront home layout singleton — band order + the chrome copy that used to
// be hardcoded in StorefrontHome. Additive: no doc published means the shipped
// order renders unchanged.
import homeBand            from '../schemas/blocks/homeBand.js'
import homeMoodPills       from '../schemas/blocks/homeMoodPills.js'
import panelDeckSection    from '../schemas/blocks/panelDeckSection.js'
import storefrontHome      from '../schemas/storefrontHome.js'

// Merchandised category and drop pages. Additive docs that enrich the existing
// /collections/{handle} and /new surfaces; no new routes, no URL churn.
import categoryMasthead    from '../schemas/blocks/category/categoryMasthead.js'
import shelfNav            from '../schemas/blocks/category/shelfNav.js'
import sensationLegend     from '../schemas/blocks/category/sensationLegend.js'
import editorialFeature    from '../schemas/blocks/category/editorialFeature.js'
import shelfSection        from '../schemas/blocks/category/shelfSection.js'
import learnStrip          from '../schemas/blocks/category/learnStrip.js'
import benefitEditorial    from '../schemas/blocks/category/benefitEditorial.js'
import categoryTrust       from '../schemas/blocks/category/categoryTrust.js'
import chooserBlock        from '../schemas/blocks/category/chooserBlock.js'
import faqBlock            from '../schemas/blocks/category/faqBlock.js'
import dropMasthead        from '../schemas/blocks/category/dropMasthead.js'
import justLanded          from '../schemas/blocks/category/justLanded.js'
import dropTimeline        from '../schemas/blocks/category/dropTimeline.js'
import makersNote          from '../schemas/blocks/category/makersNote.js'
import comingSoon          from '../schemas/blocks/category/comingSoon.js'
import categoryPage        from '../schemas/categoryPage.js'
import dropPage            from '../schemas/dropPage.js'

export const schemaTypes = [
  // Documents (singletons)
  homepageSections,
  siteSettings,
  pdpDefaults,
  // Documents (per-product content)
  productPage,
  // Documents (generic pages)
  page,
  // Documents (reusable site-wide items)
  trustItem,
  // Documents (blog)
  blogPost,
  blogCategory,
  blogAuthor,
  blogHomepage,
  // Notebook redesign — additive blog docs
  notebookSettings,
  blogCategoryExtras,
  blogPostExtras,
  blogSeries,
  blogGlossaryTerm,
  // v2 redesign — Emma hero (additive; homepageSections untouched)
  emmaHeroSettings,
  // Hero deep-linking. Primary CTA label/link singleton (additive; emmaHeroSettings untouched)
  emmaHeroStorefront,
  // v2 redesign — Emma presets for Ask Emma rail
  emmaPreset,
  // v2 redesign — Emma-voice picks indexed per featured product (Claude-generated)
  emmaPick,
  // v2 redesign — Emma context rails (AI-curated product rails under the hero)
  emmaContextRail,
  // v2 redesign — Emma-curated rails (agent-generated, draft→approve→live)
  emmaCuratedRail,
  // Editor (Emma) singleton — avatar + name + bio. Powers cart drawer avatar,
  // hero byline, /about E-E-A-T, and editor bio cards. Single source of truth.
  editor,
  // Friends of Emma — recurring AI presenter cast for the video pipeline
  // (additive; usable only when active AND approvedForUse).
  castMember,
  // PDP redesign — sensation dial label registry (singleton)
  dialRegistry,
  // PDP redesign — rich dial taxonomy (singleton, additive — companion to
  // dialRegistry that adds per-dimension definitions and 1/3/5 scale docs).
  dialTaxonomy,
  // Bulk-import — Ask Emma vocabulary singleton (mood/audience/matters tag pools)
  askEmmaVocabulary,
  // SEO keyword bank — single source of truth for keyword targeting across all
  // AI-written copy. Auto-populated by the weekly research cron; admin approves
  // pending entries in Studio.
  seoCluster,
  seoKeyword,
  seoContentBrief,
  // Weekly podcast review brief (podcast-reviewer → content-writer handoff).
  podcastReviewBrief,
  // Weekly trend topic brief (trend-scout → seo-curator handoff).
  trendTopicBrief,
  // Editorial authors — voice profiles for Emma + future AI authors.
  editorialAuthor,
  // PLP SEO — editorial overrides per Shopify collection (intro copy, FAQs,
  // related collections). Additive — Shopify is still source of truth for
  // products; Sanity wins for SEO meta when present.
  collectionPage,
  // Hub SEO — editorial copy + FAQs for the /collections hub PLP. Singleton.
  // Additive — falls back to hardcoded defaults when the doc doesn't exist.
  collectionsHub,
  // Phase 6d — Manufacturer specs per product (additive; does not touch existing schemas).
  mfgProductSpecs,
  // Block object types
  announcementBar,
  promoBanner,
  editorialTiles,
  categoryGrid,
  productCarousel,
  playTogetherBanner,
  brandLogoWall,
  testimonials,
  bonusDeal,
  trustBar,
  editorBio,
  // Plane B — team-editable "Find your way in" mosaic (additive homepage block)
  wayfinderMosaic,
  // PDP — per-product FAQ entries (Q&A pairs, additive).
  productFaq,
  // Homepage — team-editable FAQ band (Nº 11). Overrides the hardcoded array.
  homepageFaq,
  // PDP — editor-curated Related Guides rail (blogPost references, additive).
  relatedGuides,
  // PDP — rich sensation dial dimension (label + 1/3/5 scale docs).
  // Used inside dialTaxonomy arrays.
  dialDimension,
  // Blog block object types
  blogImage,
  blogPullQuote,
  blogProductEmbed,
  blogCta,
  blogVideoEmbed,
  richText,
  // Discovery home page rebuild — variant toggle + Emma copy overrides. Singleton.
  homeConfig,
  // Homepage SERP snippet — team-editable title/description. Singleton.
  homeSeo,
  // Phase 6c — Knowledge-base doc types (additive; existing schemas untouched)
  kbShippingPolicy,
  kbReturnsPolicy,
  kbCompatibilityRule,
  kbTroubleshooting,
  kbBrandFaq,
  // Social bio-link landing (/social), featured product + Emma blurb. Singleton.
  socialLanding,
  // Panel deck — doors below the headliner. Singleton + object types.
  panelDeck,
  panelLink,
  panelTile,
  panelSquareRow,
  panelLarge,
  panelSmall,
  panelRowLarge,
  panelRowSmall,
  // Storefront home layout — band order + chrome overrides. Singleton.
  storefrontHome,
  homeBand,
  homeMoodPills,
  panelDeckSection,
  // Merchandised category + drop pages (enrich existing collection routes).
  categoryPage,
  dropPage,
  categoryMasthead,
  shelfNav,
  sensationLegend,
  editorialFeature,
  shelfSection,
  learnStrip,
  benefitEditorial,
  categoryTrust,
  chooserBlock,
  faqBlock,
  dropMasthead,
  justLanded,
  dropTimeline,
  makersNote,
  comingSoon,
]
