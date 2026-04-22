export default {
  name: 'productCarousel',
  title: 'Product Carousel',
  type: 'object',
  fields: [
    { name: 'active',       title: 'Active',       type: 'boolean', initialValue: true },
    { name: 'order',        title: 'Order',        type: 'number',  initialValue: 40, hidden: true },
    { name: 'heading',      title: 'Heading',      type: 'string' },
    { name: 'eyebrow',      title: 'Eyebrow',      type: 'string' },

    // ─── Product Source ──────────────────────────────────────────────
    {
      name: 'source',
      title: 'Product Source',
      type: 'string',
      options: {
        list: [
          { title: 'Shopify Tag',        value: 'tag' },
          { title: 'Shopify Collection', value: 'collection' },
          { title: 'Manual Selection',   value: 'manual' },
        ],
        layout: 'radio',
      },
      initialValue: 'tag',
    },
    {
      name: 'shopifyTag',
      title: 'Shopify Tag',
      type: 'string',
      description: 'Shopify product tag to query (e.g. "for-him", "new-arrivals")',
      hidden: ({ parent }) => parent?.source !== 'tag',
    },
    {
      name: 'collectionHandle',
      title: 'Collection Handle',
      type: 'string',
      description: 'Shopify collection handle (e.g. "vibrators", "best-sellers")',
      hidden: ({ parent }) => parent?.source !== 'collection',
    },
    {
      name: 'productHandles',
      title: 'Product Handles',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'productRef',
          fields: [
            {
              name: 'handle',
              title: 'Product Handle',
              type: 'string',
              description: 'Shopify product handle (the URL slug)',
            },
          ],
          preview: {
            select: { title: 'handle' },
            prepare({ title }) {
              return { title: title ?? '(empty)' }
            },
          },
        },
      ],
      description: 'Manually pick products by their Shopify handle',
      hidden: ({ parent }) => parent?.source !== 'manual',
    },
    { name: 'productLimit', title: 'Max Products', type: 'number', initialValue: 8 },

    // ─── Layout & Style ──────────────────────────────────────────────
    {
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Carousel (horizontal scroll)', value: 'carousel' },
          { title: 'Grid (2 columns mobile, 4 desktop)', value: 'grid' },
          { title: 'Grid (2 columns mobile, 3 desktop)', value: 'grid-3' },
        ],
        layout: 'radio',
      },
      initialValue: 'carousel',
    },
    {
      name: 'bgStyle',
      title: 'Background',
      type: 'string',
      options: {
        list: [
          { title: 'White',    value: 'white' },
          { title: 'Cream',    value: 'cream' },
          { title: 'Mist',     value: 'mist' },
          { title: 'Charcoal', value: 'charcoal' },
          { title: 'Purple',   value: 'purple' },
        ],
      },
      initialValue: 'white',
    },

    // ─── CTA ─────────────────────────────────────────────────────────
    { name: 'ctaLink',  title: 'CTA Link',  type: 'string' },
    { name: 'ctaLabel', title: 'CTA Label', type: 'string', initialValue: 'See all →' },
  ],
  preview: {
    select: { title: 'heading', source: 'source', tag: 'shopifyTag', collection: 'collectionHandle', active: 'active', order: 'order' },
    prepare({ title, source, tag, collection, active, order }) {
      const sourceLabel =
        source === 'collection' ? `Collection: ${collection ?? '?'}`
        : source === 'manual'   ? 'Manual'
        : `Tag: ${tag ?? '?'}`
      return {
        title: title ?? '(no heading)',
        subtitle: `${sourceLabel} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
