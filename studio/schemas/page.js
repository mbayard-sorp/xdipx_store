export default {
  name: 'page',
  title: 'Page',
  type: 'document',

  fields: [
    {
      name: 'title',
      title: 'Page Title',
      type: 'string',
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'URL Slug',
      type: 'slug',
      description: 'The URL path for this page (e.g. "about" → xdipx.com/pages/about)',
      options: { source: 'title', maxLength: 96 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      description: 'Overrides the page title in search results (max 70 chars)',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'string',
      description: 'Meta description shown in search results (max 160 chars)',
      validation: Rule => Rule.max(160),
    },
    {
      name: 'sections',
      title: 'Content Sections',
      type: 'array',
      description: 'Add and reorder content blocks to build this page.',
      of: [
        { type: 'promoBanner'        },
        { type: 'editorialTiles'     },
        { type: 'categoryGrid'       },
        { type: 'productCarousel'    },
        { type: 'playTogetherBanner' },
        { type: 'brandLogoWall'      },
        { type: 'testimonials'       },
      ],
    },
  ],

  preview: {
    select: { title: 'title', slug: 'slug.current' },
    prepare: ({ title, slug }) => ({
      title:    title || 'Untitled page',
      subtitle: slug ? `/pages/${slug}` : 'No slug set',
    }),
  },

  orderings: [
    {
      title: 'Title A–Z',
      name: 'titleAsc',
      by: [{ field: 'title', direction: 'asc' }],
    },
  ],
}
