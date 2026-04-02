import announcementBar    from '../schemas/blocks/announcementBar.js'
import promoBanner        from '../schemas/blocks/promoBanner.js'
import editorialTiles     from '../schemas/blocks/editorialTiles.js'
import categoryGrid       from '../schemas/blocks/categoryGrid.js'
import productCarousel    from '../schemas/blocks/productCarousel.js'
import playTogetherBanner from '../schemas/blocks/playTogetherBanner.js'
import brandLogoWall      from '../schemas/blocks/brandLogoWall.js'
import testimonials       from '../schemas/blocks/testimonials.js'
import homepageSections   from '../schemas/homepageSections.js'
import siteSettings       from '../schemas/siteSettings.js'
import productPage        from '../schemas/productPage.js'

export const schemaTypes = [
  // Documents (singletons)
  homepageSections,
  siteSettings,
  // Documents (per-product content)
  productPage,
  // Block object types
  announcementBar,
  promoBanner,
  editorialTiles,
  categoryGrid,
  productCarousel,
  playTogetherBanner,
  brandLogoWall,
  testimonials,
]
