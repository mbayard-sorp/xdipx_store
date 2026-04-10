import { defineLocations, defineDocuments } from 'sanity/presentation'

export const resolve = {
  locations: {
    homepageSections: defineLocations({
      select: { title: '_type' },
      resolve: () => ({
        locations: [{ title: 'Homepage', href: '/' }],
      }),
    }),
    siteSettings: defineLocations({
      select: { title: '_type' },
      resolve: () => ({
        locations: [{ title: 'Homepage', href: '/' }],
      }),
    }),
    page: defineLocations({
      select: { title: 'title', slug: 'slug.current' },
      resolve: (doc) => {
        if (!doc?.slug) return null
        return {
          locations: [{ title: doc.title || 'Untitled Page', href: `/pages/${doc.slug}` }],
        }
      },
    }),
    blogPost: defineLocations({
      select: { title: 'title', slug: 'slug.current' },
      resolve: (doc) => {
        if (!doc?.slug) return null
        return {
          locations: [
            { title: doc.title || 'Untitled Post', href: `/blog/${doc.slug}` },
            { title: 'Blog Index', href: '/blog' },
          ],
        }
      },
    }),
    blogCategory: defineLocations({
      select: { title: 'name', slug: 'slug.current' },
      resolve: (doc) => {
        if (!doc?.slug) return null
        return {
          locations: [
            { title: doc.title || 'Category', href: `/blog/category/${doc.slug}` },
            { title: 'Blog Index', href: '/blog' },
          ],
        }
      },
    }),
    blogHomepage: defineLocations({
      select: { title: '_type' },
      resolve: () => ({
        locations: [{ title: 'Blog', href: '/blog' }],
      }),
    }),
    blogAuthor: defineLocations({
      select: { title: 'name' },
      resolve: (doc) => ({
        locations: [{ title: 'Blog Index', href: '/blog' }],
      }),
    }),
    productPage: defineLocations({
      select: { title: 'title', handle: 'shopifyHandle' },
      resolve: (doc) => {
        if (!doc?.handle) return null
        return {
          locations: [{ title: doc.title || 'Product', href: `/products/${doc.handle}` }],
        }
      },
    }),
  },
  mainDocuments: defineDocuments([
    { route: '/', type: 'homepageSections' },
    {
      route: '/pages/:slug',
      filter: '_type == "page" && slug.current == $slug',
    },
    {
      route: '/blog/:slug',
      filter: '_type == "blogPost" && slug.current == $slug',
    },
    {
      route: '/blog/category/:slug',
      filter: '_type == "blogCategory" && slug.current == $slug',
    },
    {
      route: '/products/:slug',
      filter: '_type == "productPage" && shopifyHandle == $slug',
    },
  ]),
}
