// Ad Studio v2, PR-D (additive). The curated product subset for one paid lane.
// Meta (docs/ads-policy.md M5) never runs the raw Shopify feed: only the
// object-first products listed here, under display titles with no category
// word. app/lib/ad-lane-subset.server.ts reads this; the PDP renders the
// health and body-literacy block for any handle listed in the `meta` lane.
// One document per lane, id `adLaneProductSubset.<lane>`.
export default {
  name: 'adLaneProductSubset',
  title: 'Ad lane product subset',
  type: 'document',
  fields: [
    {
      name: 'lane',
      title: 'Lane',
      type: 'string',
      options: { list: ['meta', 'snap', 'google'], layout: 'radio' },
      validation: Rule => Rule.required(),
    },
    {
      name: 'entries',
      title: 'Products',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'adLaneProductEntry',
          fields: [
            {
              name: 'productHandle',
              title: 'Shopify product handle',
              type: 'string',
              validation: Rule =>
                Rule.required().custom(value => (/^[a-z0-9][a-z0-9-]*$/.test(value ?? '') ? true : 'Bare handle only')),
            },
            {
              name: 'displayTitle',
              title: 'Display title',
              type: 'string',
              description: 'Object-first, no category word. For example "Wild Rose, the classic" or "ROMP Lipstick".',
              validation: Rule => Rule.required(),
            },
            {
              name: 'positionZeroOk',
              title: 'Position-0 packshot is object-first',
              type: 'boolean',
              initialValue: false,
              description:
                'True only after someone has looked at media position 0 and it is the product as an object on a clean ground.',
            },
          ],
          preview: { select: { title: 'displayTitle', subtitle: 'productHandle' } },
        },
      ],
    },
  ],
  preview: {
    select: { lane: 'lane', entries: 'entries' },
    prepare: ({ lane, entries }) => ({
      title: `${lane ?? '?'} lane subset`,
      subtitle: `${(entries ?? []).length} products`,
    }),
  },
}
