// Merchandised drop page — a merchandising moment rather than an aisle.
//
// Like categoryPage this is additive and route-less: it enriches surfaces that
// already exist (/new, and the Sale collection), so no new URL is minted.
// `routeKey` says which one it enriches.
//
// `sourceRule` decides how products are gathered, and the default is `tag`
// precisely so the page stays current without anyone touching it: the shelf
// refreshes from Shopify while the editorial copy above it changes on a human
// rhythm.
export default {
  name: 'dropPage',
  title: 'Drop page (merchandised)',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Internal title',
      type: 'string',
      validation: (Rule) => Rule.required().max(80),
    },
    {
      name: 'routeKey',
      title: 'Surface',
      type: 'string',
      description: 'Which existing surface this page enriches.',
      options: {
        list: [
          { title: 'New arrivals (/new)', value: 'new' },
          { title: 'Sale (/collections/on-sale)', value: 'on-sale' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      initialValue: 'draft',
      options: {
        list: [
          { title: 'Draft', value: 'draft' },
          { title: 'Live', value: 'live' },
          { title: 'Archived', value: 'archived' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'sourceRule',
      title: 'How products are gathered',
      type: 'object',
      fields: [
        {
          name: 'kind',
          title: 'Rule',
          type: 'string',
          initialValue: 'tag',
          options: {
            list: [
              { title: 'By tag', value: 'tag' },
              { title: 'By date range', value: 'dateRange' },
              { title: 'Manual list', value: 'manual' },
            ],
            layout: 'radio',
          },
          validation: (Rule) => Rule.required(),
        },
        {
          name: 'tag',
          title: 'Tag',
          type: 'string',
          initialValue: 'new-arrival',
          hidden: ({ parent }) => parent?.kind !== 'tag',
        },
        {
          name: 'fromDate',
          title: 'From',
          type: 'date',
          hidden: ({ parent }) => parent?.kind !== 'dateRange',
        },
        {
          name: 'toDate',
          title: 'To',
          type: 'date',
          hidden: ({ parent }) => parent?.kind !== 'dateRange',
        },
        {
          name: 'handles',
          title: 'Product handles',
          type: 'array',
          of: [{ type: 'string' }],
          hidden: ({ parent }) => parent?.kind !== 'manual',
        },
      ],
    },
    {
      name: 'blocks',
      title: 'Blocks',
      type: 'array',
      description: 'Ordered. Drag to rearrange.',
      of: [
        { type: 'dropMasthead' },
        { type: 'justLanded' },
        { type: 'dropTimeline' },
        { type: 'makersNote' },
        { type: 'comingSoon' },
        { type: 'learnStrip' },
        { type: 'categoryTrust' },
        { type: 'faqBlock' },
      ],
      validation: (Rule) =>
        Rule.required()
          .min(1)
          .custom((blocks) => {
            if (!Array.isArray(blocks)) return true
            const mastheads = blocks.filter((b) => b?._type === 'dropMasthead').length
            if (mastheads > 1) return 'Only one masthead per page'
            const ids = blocks.map((b) => b?.anchorId).filter(Boolean)
            const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
            if (dupes.length) return `Anchor ids must be unique. Repeated: ${dupes.join(', ')}`
            return true
          }),
    },
  ],
  preview: {
    select: { title: 'title', routeKey: 'routeKey', status: 'status', blocks: 'blocks' },
    prepare: ({ title, routeKey, status, blocks }) => {
      const n = Array.isArray(blocks) ? blocks.length : 0
      return {
        title: title || 'Drop page',
        subtitle: `${routeKey || '?'} · ${status || 'draft'} · ${n} block${n === 1 ? '' : 's'}`,
      }
    },
  },
}
