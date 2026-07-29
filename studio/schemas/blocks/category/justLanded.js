import { anchorIdField } from './anchorId'

// The single hero arrival on a drop page. One product, not a grid.
export default {
  name: 'justLanded',
  title: 'Just landed',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'kicker',
      title: 'Kicker',
      type: 'string',
      initialValue: 'Just landed',
      validation: (Rule) => Rule.max(28),
    },
    {
      name: 'productHandle',
      title: 'Product handle',
      type: 'string',
      validation: (Rule) =>
        Rule.required().custom((value) =>
          !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Bare Shopify product handle, no slashes',
        ),
    },
    {
      name: 'body',
      title: 'Why it matters',
      type: 'text',
      rows: 3,
      validation: (Rule) => Rule.max(400),
    },
  ],
  preview: {
    select: { title: 'kicker', subtitle: 'productHandle' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Just landed',
      subtitle: subtitle || 'No product set',
    }),
  },
}
