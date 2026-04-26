// SEO topic cluster — groups related keywords around a pillar term.
// Used at gen-time to constrain keyword selection to a coherent theme,
// and at content-strategy time to plan internal links.
// Additive — does not modify any existing schema.
export default {
  name: 'seoCluster',
  title: 'SEO Cluster',
  type: 'document',
  fields: [
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 64 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required().max(80),
    },
    {
      name: 'pillarTerm',
      title: 'Pillar term',
      type: 'string',
      description: 'The head term this cluster is built around (e.g. "best wand vibrator").',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 2,
      description: 'Editorial intent for this cluster — what content goal does it serve?',
    },
    {
      name: 'targetUrl',
      title: 'Target URL',
      type: 'string',
      description: 'Optional canonical landing page (relative or absolute) this cluster should rank.',
    },
    {
      name: 'relatedClusters',
      title: 'Related clusters',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'seoCluster' }] }],
      description: 'For internal-linking suggestions across content.',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Active', value: 'active' },
          { title: 'Paused', value: 'paused' },
          { title: 'Archived', value: 'archived' },
        ],
        layout: 'radio',
      },
      initialValue: 'active',
    },
  ],
  preview: {
    select: { title: 'title', pillar: 'pillarTerm', status: 'status' },
    prepare: ({ title, pillar, status }) => ({
      title,
      subtitle: `${pillar ?? '—'} · ${status ?? 'active'}`,
    }),
  },
}
