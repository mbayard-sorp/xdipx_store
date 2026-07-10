// Editorial queue entry: one planned Notebook post derived from the keyword
// bank. Created by the weekly seo-curator routine (7 per week following the
// content-plan category rhythm); consumed by the daily content-writer routine,
// which picks the highest-priority queued brief for today's category, patches
// it to `drafted` when it starts and `published` (+ publishedPost ref) when
// the post goes live. Cluster coverage is derived from published briefs:
// a seoCluster is "covered" when a published brief references it.
// Additive — does not modify any existing schema.
export default {
  name: 'seoContentBrief',
  title: 'SEO Content Brief',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Working title',
      type: 'string',
      description: 'Answer-shaped working title for the post. The writer may refine it in voice.',
      validation: (Rule) => Rule.required().min(8).max(140),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 80 },
      description: 'Pre-checked against existing blogPost slugs at plan time.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'category',
      title: 'Notebook category',
      type: 'string',
      options: {
        list: [
          { title: 'Guides', value: 'guides' },
          { title: 'Comparisons', value: 'comparisons' },
          { title: 'Care and Storage', value: 'care' },
          { title: 'Wellness Basics', value: 'wellness-basics' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'cluster',
      title: 'Keyword cluster',
      type: 'reference',
      to: [{ type: 'seoCluster' }],
      description: 'The cluster this post covers. A published brief marks its cluster covered.',
    },
    {
      name: 'targetQuery',
      title: 'Target query',
      type: 'string',
      description: 'The single search query this post should be the best answer to.',
    },
    {
      name: 'primaryKeyword',
      title: 'Primary keyword',
      type: 'reference',
      to: [{ type: 'seoKeyword' }],
    },
    {
      name: 'secondaryKeywords',
      title: 'Secondary keywords',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'seoKeyword' }] }],
      validation: (Rule) => Rule.max(6),
    },
    {
      name: 'questionKeywords',
      title: 'Question keywords',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'seoKeyword' }] }],
      description: 'Question-form terms. Each becomes an H2 or FAQ entry in the post.',
      validation: (Rule) => Rule.max(8),
    },
    {
      name: 'embedHints',
      title: 'Product embed hints',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Shopify product handles worth embedding, if in stock at write time.',
    },
    {
      name: 'internalLinks',
      title: 'Internal link targets',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Site paths the post should link to (collections, PDPs, other posts).',
    },
    {
      name: 'priority',
      title: 'Priority',
      type: 'number',
      description: 'Planner-computed. Higher = picked first within the category.',
      initialValue: 0,
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Queued', value: 'queued' },
          { title: 'Drafted', value: 'drafted' },
          { title: 'Published', value: 'published' },
          { title: 'Skipped', value: 'skipped' },
        ],
        layout: 'radio',
      },
      initialValue: 'queued',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'plannedFor',
      title: 'Planned for',
      type: 'date',
      description: 'Intended publish date. The writer prefers the earliest planned brief.',
    },
    {
      name: 'publishedPost',
      title: 'Published post',
      type: 'reference',
      to: [{ type: 'blogPost' }],
      description: 'Set by the writer when the post goes live.',
    },
    {
      name: 'createdBy',
      title: 'Created by',
      type: 'string',
      description: 'Routine or person that planned this brief (e.g. seo-curator run id).',
    },
  ],
  orderings: [
    {
      title: 'Status, then priority',
      name: 'statusPriority',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'priority', direction: 'desc' },
      ],
    },
    {
      title: 'Planned date',
      name: 'plannedFor',
      by: [{ field: 'plannedFor', direction: 'asc' }],
    },
  ],
  preview: {
    select: { title: 'title', category: 'category', status: 'status', plannedFor: 'plannedFor' },
    prepare: ({ title, category, status, plannedFor }) => ({
      title,
      subtitle: `${category ?? '—'} · ${status ?? 'queued'}${plannedFor ? ` · ${plannedFor}` : ''}`,
    }),
  },
}
