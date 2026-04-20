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
import homepageSections   from '../schemas/homepageSections.js'
import siteSettings       from '../schemas/siteSettings.js'
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

export const schemaTypes = [
  // Documents (singletons)
  homepageSections,
  siteSettings,
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
  // Blog block object types
  blogImage,
  blogPullQuote,
  blogProductEmbed,
  blogCta,
  blogVideoEmbed,
  richText,
]
