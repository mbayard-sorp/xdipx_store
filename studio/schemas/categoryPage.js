// Merchandised category page — one document per top-level menu category.
//
// ADDITIVE, and deliberately NOT a new route. This doc enriches the collection
// page that already exists at /collections/{handle}: those URLs are already in
// the nav and already carry sitemap priority, and minting parallel landing URLs
// while site indexation is recovering would split signal across two thin pages
// instead of deepening one good one. `collectionPage` (SEO overrides) is
// untouched and stays the fallback layer; when no categoryPage doc exists the
// route renders exactly as it does today.
//
// Blocks are ordered by the editor. `categoryMasthead` and `sensationLegend`
// are the designed spine; `editorialFeature` is capped at one so a page cannot
// become a wall of features.
export default {
  name: 'categoryPage',
  title: 'Category page (merchandised)',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Internal title',
      type: 'string',
      description: 'For the editor list only. The customer-facing H1 lives on the masthead block.',
      validation: (Rule) => Rule.required().max(80),
    },
    {
      name: 'shopifyCollectionHandle',
      title: 'Shopify collection handle',
      type: 'string',
      description:
        'Bare handle this page enriches, e.g. "pleasure". Must match a live Shopify collection.',
      validation: (Rule) =>
        Rule.required().custom((value) =>
          !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Lowercase letters, numbers and hyphens only (no slashes, no URL)',
        ),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      initialValue: 'draft',
      description: 'Only "live" renders. Anything else leaves the collection page as it is today.',
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
      name: 'blocks',
      title: 'Blocks',
      type: 'array',
      description: 'Ordered. Drag to rearrange; the page renders them in this order.',
      of: [
        { type: 'categoryMasthead' },
        { type: 'shelfNav' },
        { type: 'sensationLegend' },
        { type: 'editorialFeature' },
        { type: 'shelfSection' },
        { type: 'learnStrip' },
        { type: 'benefitEditorial' },
        { type: 'categoryTrust' },
        { type: 'chooserBlock' },
        { type: 'faqBlock' },
      ],
      validation: (Rule) =>
        Rule.required()
          .min(1)
          .custom((blocks) => {
            if (!Array.isArray(blocks)) return true
            const features = blocks.filter((b) => b?._type === 'editorialFeature').length
            if (features > 1) return 'Only one editorial feature per page'
            const mastheads = blocks.filter((b) => b?._type === 'categoryMasthead').length
            if (mastheads > 1) return 'Only one masthead per page'
            const ids = blocks.map((b) => b?.anchorId).filter(Boolean)
            const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
            if (dupes.length) return `Anchor ids must be unique. Repeated: ${dupes.join(', ')}`
            return true
          }),
    },
  ],
  preview: {
    select: { title: 'title', handle: 'shopifyCollectionHandle', status: 'status', blocks: 'blocks' },
    prepare: ({ title, handle, status, blocks }) => {
      const n = Array.isArray(blocks) ? blocks.length : 0
      return {
        title: title || handle || 'Category page',
        subtitle: `/collections/${handle || '?'} · ${status || 'draft'} · ${n} block${n === 1 ? '' : 's'}`,
      }
    },
  },
}
