export default {
  name: 'blogProductEmbed',
  title: 'Product Embed',
  type: 'object',

  fields: [
    {
      name: 'productHandle',
      title: 'Product Handle',
      type: 'string',
      description: 'The Shopify product URL slug (e.g. "satisfyer-pro-2")',
      validation: Rule => Rule.required(),
    },
    {
      name: 'ctaLabel',
      title: 'CTA Label',
      type: 'string',
      initialValue: 'Shop Now ♥',
    },
    {
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Card',   value: 'card' },
          { title: 'Inline', value: 'inline' },
          { title: 'Banner', value: 'banner' },
        ],
        layout: 'radio',
      },
      initialValue: 'card',
    },
  ],

  preview: {
    select: { title: 'productHandle', subtitle: 'layout' },
    prepare: ({ title, subtitle }) => ({
      title: `Product: ${title || 'Not set'}`,
      subtitle: subtitle || 'card',
    }),
  },
}
