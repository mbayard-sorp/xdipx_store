// Single SEO keyword — the unit the keyword bank is built from.
// Auto-discovered by the weekly research cron (DataForSEO + LLM clusterer)
// and approved in Studio. Read at gen-time by app/lib/seo-keywords.server.ts
// to inject targeting hints into product copy and blog generation.
// Additive — does not modify any existing schema.
export default {
  name: 'seoKeyword',
  title: 'SEO Keyword',
  type: 'document',
  fields: [
    {
      name: 'term',
      title: 'Term',
      type: 'string',
      description: 'The keyword exactly as searched. Lowercased on write.',
      validation: (Rule) => Rule.required().min(2).max(120),
    },
    {
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Head', value: 'head' },
          { title: 'Long-tail', value: 'long-tail' },
          { title: 'Question', value: 'question' },
          { title: 'Branded', value: 'branded' },
        ],
        layout: 'radio',
      },
      initialValue: 'long-tail',
    },
    {
      name: 'intent',
      title: 'Search intent',
      type: 'string',
      options: {
        list: [
          { title: 'Informational', value: 'informational' },
          { title: 'Transactional', value: 'transactional' },
          { title: 'Navigational', value: 'navigational' },
          { title: 'Commercial investigation', value: 'commercial' },
        ],
      },
    },
    {
      name: 'cluster',
      title: 'Cluster',
      type: 'reference',
      to: [{ type: 'seoCluster' }],
      description: 'Topic group this term belongs to.',
    },
    {
      name: 'volume',
      title: 'Monthly volume',
      type: 'number',
      description: 'Approx monthly searches (from DataForSEO).',
    },
    {
      name: 'difficulty',
      title: 'Difficulty',
      type: 'number',
      description: 'Keyword difficulty 0–100 (from DataForSEO).',
      validation: (Rule) => Rule.min(0).max(100),
    },
    {
      name: 'cpc',
      title: 'CPC',
      type: 'number',
      description: 'Approx commercial value per click (USD).',
    },
    {
      name: 'relevanceScore',
      title: 'Relevance score',
      type: 'number',
      description: 'LLM-rated fit against the xdipx catalog, 0–1.',
      validation: (Rule) => Rule.min(0).max(1),
    },
    {
      name: 'productTypeDials',
      title: 'Product type dials',
      type: 'array',
      of: [
        {
          type: 'string',
          options: {
            list: [
              { title: 'Air pulsation', value: 'air-pulsation' },
              { title: 'Vibrator', value: 'vibrator' },
              { title: 'Wand', value: 'wand' },
              { title: 'Lube', value: 'lube' },
              { title: 'Wear', value: 'wear' },
            ],
          },
        },
      ],
      description: 'Which product_type_dial values this term naturally describes.',
    },
    {
      name: 'moodTags',
      title: 'Mood tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugs from askEmmaVocabulary.mood — used for tag-overlap matching.',
    },
    {
      name: 'audienceTags',
      title: 'Audience tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugs from askEmmaVocabulary.audience.',
    },
    {
      name: 'mattersTags',
      title: 'What-matters tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugs from askEmmaVocabulary.matters.',
    },
    {
      name: 'contentTypes',
      title: 'Content types',
      type: 'array',
      of: [
        {
          type: 'string',
          options: {
            list: [
              { title: 'Product PDP', value: 'pdp' },
              { title: 'Blog article', value: 'blog' },
              { title: 'FAQ', value: 'faq' },
              { title: 'Collection page', value: 'collection' },
              { title: 'Any', value: 'any' },
            ],
          },
        },
      ],
      description: 'Where this keyword should be considered. Empty = any.',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Pending review', value: 'pending' },
          { title: 'Approved', value: 'approved' },
          { title: 'Rejected', value: 'rejected' },
          { title: 'Archived', value: 'archived' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'flagged',
      title: 'Flagged',
      type: 'boolean',
      description: 'True for competitor brand names, off-brand explicit terms, regulated medical claims.',
      initialValue: false,
    },
    {
      name: 'flagReason',
      title: 'Flag reason',
      type: 'string',
    },
    {
      name: 'firstSeenAt',
      title: 'First seen',
      type: 'datetime',
      description: 'When the research pipeline first added this term.',
    },
    {
      name: 'lastResearchedAt',
      title: 'Last researched',
      type: 'datetime',
      description: 'When volume / difficulty were last refreshed.',
    },
    {
      name: 'sources',
      title: 'Sources',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Where this term came from (e.g. "dataforseo:keywords-for-keywords:wand vibrator", "gsc", "manual").',
    },
    {
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 2,
    },
  ],
  preview: {
    select: {
      term: 'term',
      status: 'status',
      kind: 'kind',
      volume: 'volume',
      score: 'relevanceScore',
    },
    prepare: ({ term, status, kind, volume, score }) => ({
      title: term,
      subtitle: `${status} · ${kind ?? '?'} · vol ${volume ?? '?'} · rel ${score != null ? score.toFixed(2) : '?'}`,
    }),
  },
  orderings: [
    { title: 'Status, then volume', name: 'statusVolume', by: [{ field: 'status', direction: 'asc' }, { field: 'volume', direction: 'desc' }] },
    { title: 'Most relevant', name: 'relevance', by: [{ field: 'relevanceScore', direction: 'desc' }, { field: 'volume', direction: 'desc' }] },
    { title: 'Newest', name: 'newest', by: [{ field: 'firstSeenAt', direction: 'desc' }] },
  ],
}
