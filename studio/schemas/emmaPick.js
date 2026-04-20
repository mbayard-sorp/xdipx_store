export default {
  name: 'emmaPick',
  title: "Emma's pick (generated)",
  type: 'document',
  description: 'Emma-voice hero copy generated at deal activation. One doc per featured product — indexed here so Emma gets smarter over time. Do not hand-edit; regenerate via admin to update.',
  fields: [
    {
      name: 'productId',
      title: 'Shopify product ID',
      type: 'string',
      description: 'gid://shopify/Product/... — stable key. Used as the Sanity _id prefix.',
      validation: (Rule) => Rule.required(),
      readOnly: true,
    },
    {
      name: 'productHandle',
      title: 'Shopify handle',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'productTitle',
      title: 'Product title',
      type: 'string',
    },
    {
      name: 'brand',
      title: 'Brand',
      type: 'string',
    },
    {
      name: 'category',
      title: 'Category',
      type: 'string',
    },
    {
      name: 'dealDate',
      title: 'Deal date',
      type: 'string',
      description: 'YYYY-MM-DD (EST) — the day this pick went live.',
    },
    {
      name: 'variant',
      title: 'Hero variant',
      type: 'string',
      options: {
        list: [
          { title: 'Loving',  value: 'loving' },
          { title: 'Bundle',  value: 'bundle' },
          { title: 'Quote',   value: 'quote'  },
        ],
      },
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow (dynamic feeling)',
      type: 'string',
    },
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
    },
    {
      name: 'body',
      title: 'Body',
      type: 'text',
      rows: 3,
    },
    {
      name: 'aside',
      title: 'Aside',
      type: 'string',
    },
    {
      name: 'pullQuote',
      title: 'Pull quote',
      type: 'string',
    },
    {
      name: 'voiceHash',
      title: 'Voice hash',
      type: 'string',
      description: 'SHA1 of brandVoice used — lets admin detect drift when the IVR voice changes.',
      readOnly: true,
    },
    {
      name: 'generatedAt',
      title: 'Generated at',
      type: 'datetime',
      readOnly: true,
    },
  ],
  preview: {
    select: { title: 'productTitle', eyebrow: 'eyebrow', headline: 'headline', dealDate: 'dealDate' },
    prepare: ({ title, eyebrow, headline, dealDate }) => ({
      title: title || 'Untitled pick',
      subtitle: [dealDate, eyebrow, headline].filter(Boolean).join(' · '),
    }),
  },
  orderings: [
    { title: 'Deal date (newest first)', name: 'dealDateDesc', by: [{ field: 'dealDate', direction: 'desc' }] },
  ],
}
