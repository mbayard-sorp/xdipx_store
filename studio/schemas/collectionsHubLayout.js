// Shopper-facing grouping for the /collections hub (collections audit
// 2026-10-23, owner-approved 2026-10-24).
//
// Additive singleton ("singleton.collectionsHubLayout") rather than new fields
// on collectionsHub. When it is missing or has no groups the hub renders
// exactly as before (category / brand / theme sections from collectionPage).
//
// Handles not live in Shopify, empty, or unlisted (utility lists) are dropped
// at render time, so a stale handle here fails soft.
export default {
  name: 'collectionsHubLayout',
  title: 'Collections hub layout',
  type: 'document',
  fields: [
    {
      name: 'groups',
      title: 'Groups (in display order)',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'hubGroup',
          fields: [
            {
              name: 'heading',
              title: 'Heading',
              type: 'string',
              validation: (Rule) => Rule.required().max(60),
            },
            {
              name: 'handles',
              title: 'Collection handles (in display order)',
              type: 'array',
              of: [{ type: 'string' }],
              validation: (Rule) => Rule.required().min(1).unique(),
            },
          ],
          preview: {
            select: { title: 'heading', handles: 'handles' },
            prepare: ({ title, handles }) => ({ title, subtitle: `${(handles ?? []).length} collections` }),
          },
        },
      ],
    },
    {
      name: 'featuredBrandHandles',
      title: 'Featured brands (shown as cards)',
      type: 'array',
      description: 'Up to 24 brand collection handles, in order. Every other live brand collection is listed A to Z beneath them.',
      of: [{ type: 'string' }],
      validation: (Rule) => Rule.max(24).unique(),
    },
  ],
  preview: {
    prepare: () => ({ title: 'Collections hub layout' }),
  },
}
