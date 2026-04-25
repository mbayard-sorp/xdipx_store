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
import emmaPreset         from '../schemas/emmaPreset.js'
import emmaPick           from '../schemas/emmaPick.js'
import emmaContextRail    from '../schemas/emmaContextRail.js'
import emmaCuratedRail    from '../schemas/blocks/emmaCuratedRail.js'
import editor             from '../schemas/editor.js'
import dialRegistry       from '../schemas/dialRegistry.js'
import askEmmaVocabulary  from '../schemas/askEmmaVocabulary.js'

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
  // v2 redesign — Emma hero (additive; homepageSections untouched)
  emmaHeroSettings,
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
  // PDP redesign — sensation dial label registry (singleton)
  dialRegistry,
  // Bulk-import — Ask Emma vocabulary singleton (mood/audience/matters tag pools)
  askEmmaVocabulary,
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
  // PDP — per-product FAQ entries (Q&A pairs, additive).
  productFaq,
  // Blog block object types
  blogImage,
  blogPullQuote,
  blogProductEmbed,
  blogCta,
  blogVideoEmbed,
  richText,
]
