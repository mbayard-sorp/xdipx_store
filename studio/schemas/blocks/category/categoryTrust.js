import { anchorIdField } from './anchorId'

// Discretion and trust, restated on the page itself.
//
// Not in the original design: the 14-block category system had no trust block
// at all, which assumes every visitor arrived via the homepage and saw the
// trust strip there. A visitor landing here from search or an ad never did, and
// in this category that reassurance is the highest-leverage thing on the page.
export default {
  name: 'categoryTrust',
  title: 'Trust line',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'trust' }),
    {
      name: 'items',
      title: 'Items',
      type: 'array',
      validation: (Rule) => Rule.required().min(2).max(4),
      of: [
        {
          type: 'object',
          name: 'categoryTrustItem',
          title: 'Item',
          fields: [
            {
              name: 'headline',
              title: 'Headline',
              type: 'string',
              validation: (Rule) => Rule.required().max(40),
            },
            {
              name: 'subheadline',
              title: 'Subheadline',
              type: 'string',
              description: 'The card statement always reads XDIPX. Never promise more than we do.',
              validation: (Rule) => Rule.max(80),
            },
          ],
          preview: { select: { title: 'headline', subtitle: 'subheadline' } },
        },
      ],
    },
  ],
  preview: {
    select: { items: 'items' },
    prepare: ({ items }) => {
      const n = Array.isArray(items) ? items.length : 0
      return { title: 'Trust line', subtitle: `${n} item${n === 1 ? '' : 's'}` }
    },
  },
}
