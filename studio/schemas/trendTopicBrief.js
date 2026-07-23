// Trend topic brief: one topic proposal from the weekly trend-scout routine
// (Saturday), judged by the seo-curator's Sunday planning run: adopted into
// the seoContentBrief queue, skipped with a reason, or expired when stale.
// The brief itself is internal (no voice gate); trend-scout never writes
// blogPost or seoContentBrief docs, only this handoff type. Additive; does
// not modify any existing schema.
export default {
  name: 'trendTopicBrief',
  title: 'Trend Topic Brief',
  type: 'document',
  fields: [
    {
      name: 'topic',
      title: 'Topic',
      type: 'string',
      description: 'The question or subject people are actually discussing, in plain words.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'angle',
      title: 'Angle',
      type: 'text',
      rows: 3,
      description: 'Why this is worth a Notebook post now and what the honest xdipx answer looks like. Internal notes, not customer copy.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'evidence',
      title: 'Evidence',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'sourceUrl', title: 'Source URL', type: 'url', validation: (Rule) => Rule.required() },
            { name: 'sourceNote', title: 'What it shows', type: 'string', description: 'One line: what this source demonstrates about the trend.' },
            {
              name: 'sourceQuality',
              title: 'Source quality',
              type: 'string',
              options: {
                list: [
                  { title: 'Viewed directly', value: 'viewed-directly' },
                  { title: 'Coverage only', value: 'coverage-only' },
                ],
                layout: 'radio',
              },
              description: 'Honesty guard: whether the scout read the source itself or only secondary coverage of it.',
              validation: (Rule) => Rule.required(),
            },
          ],
          preview: { select: { title: 'sourceNote', subtitle: 'sourceUrl' } },
        },
      ],
      description: 'Real URLs the scout actually resolved. A trend with no checkable evidence does not get a brief.',
      validation: (Rule) => Rule.required().min(1),
    },
    {
      name: 'suggestedCategory',
      title: 'Suggested category',
      type: 'string',
      options: {
        list: [
          { title: 'Guides', value: 'guides' },
          { title: 'Comparisons', value: 'comparisons' },
          { title: 'Care', value: 'care' },
          { title: 'Wellness basics', value: 'wellness-basics' },
          { title: 'Real Talk', value: 'real-talk' },
          { title: 'Podcast Notes', value: 'podcast-notes' },
        ],
        layout: 'radio',
      },
      description: 'Which weekly slot this topic fits (content-plan §2).',
    },
    {
      name: 'suggestedTerms',
      title: 'Suggested search terms',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Phrasings people use for this topic; hints for mapping into the keyword bank. The curator judges; the scout never writes seoKeyword docs.',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Pending', value: 'pending' },
          { title: 'Adopted', value: 'adopted' },
          { title: 'Skipped', value: 'skipped' },
          { title: 'Expired', value: 'expired' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'expiresAt',
      title: 'Expires',
      type: 'date',
      description: 'Trends go stale: the curator marks past-due pending briefs expired. Scout sets this to creation + 14 days.',
    },
    {
      name: 'adoptedBrief',
      title: 'Adopted as brief',
      type: 'reference',
      to: [{ type: 'seoContentBrief' }],
      description: 'The seoContentBrief the curator minted or boosted from this trend, when adopted.',
    },
    {
      name: 'skipReason',
      title: 'Skip reason',
      type: 'string',
      description: 'Why the curator passed on this trend, when skipped.',
    },
    {
      name: 'createdBy',
      title: 'Created by',
      type: 'string',
      description: 'Routine or person that wrote this brief (e.g. trend-scout run id).',
    },
  ],
  orderings: [
    {
      title: 'Status, then newest',
      name: 'statusNewest',
      by: [
        { field: 'status', direction: 'asc' },
        { field: '_createdAt', direction: 'desc' },
      ],
    },
  ],
  preview: {
    select: { title: 'topic', category: 'suggestedCategory', status: 'status' },
    prepare: ({ title, category, status }) => ({
      title,
      subtitle: `${category ?? 'uncategorized'} · ${status ?? 'pending'}`,
    }),
  },
}
