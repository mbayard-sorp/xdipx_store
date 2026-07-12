// Podcast review brief: one sexual-wellness podcast episode reviewed by the
// weekly podcast-reviewer routine and handed to the daily content-writer,
// which turns the pending brief into that day's Notebook post (category
// podcast-notes) with contextually fitting product embeds from productAngles.
// The brief itself is internal (no voice gate); the gate applies at the post
// stage as always. Additive — does not modify any existing schema.
export default {
  name: 'podcastReviewBrief',
  title: 'Podcast Review Brief',
  type: 'document',
  fields: [
    {
      name: 'showName',
      title: 'Show name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'episodeTitle',
      title: 'Episode title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'episodeUrl',
      title: 'Episode URL',
      type: 'url',
      description: 'Canonical episode page (show site or major podcast platform). Always linked from the post.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'publishedDate',
      title: 'Episode published',
      type: 'date',
    },
    {
      name: 'hosts',
      title: 'Hosts',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Host names and credentials where stated (e.g. "Dr. ..., certified sex therapist").',
    },
    {
      name: 'summary',
      title: 'Episode summary',
      type: 'text',
      rows: 5,
      description: 'What the episode covers, in plain factual language. Internal notes, not customer copy.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'keyTakeaways',
      title: 'Key takeaways',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'claim', title: 'Claim / point made', type: 'text', rows: 2, validation: (Rule) => Rule.required() },
            { name: 'timestampNote', title: 'Where in the episode', type: 'string', description: 'Timestamp or segment, when known.' },
            {
              name: 'agreeOrPushback',
              title: 'Emma agrees or pushes back',
              type: 'text',
              rows: 2,
              description: 'The editorial angle: what Emma would affirm, nuance, or gently push back on. Medical claims get flagged here, never repeated as fact.',
            },
          ],
          preview: { select: { title: 'claim' } },
        },
      ],
      validation: (Rule) => Rule.min(3).max(8),
    },
    {
      name: 'productAngles',
      title: 'Product angles',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'theme', title: 'Theme from the episode', type: 'string', validation: (Rule) => Rule.required() },
            {
              name: 'suggestedProductHandles',
              title: 'Suggested product handles',
              type: 'array',
              of: [{ type: 'string' }],
              description: 'Shopify handles that genuinely fit the theme. Writer verifies in stock before embedding.',
            },
            { name: 'why', title: 'Why they fit', type: 'text', rows: 2 },
          ],
          preview: { select: { title: 'theme' } },
        },
      ],
      description: 'The contextual-embed handoff: products only where the conversation naturally leads to them.',
    },
    {
      name: 'suggestedTitle',
      title: 'Suggested post title',
      type: 'string',
      description: 'Answer-shaped working title for the Notebook post. The writer may refine it in voice.',
    },
    {
      name: 'sourceQuality',
      title: 'Source quality',
      type: 'string',
      options: {
        list: [
          { title: 'Full transcript reviewed', value: 'transcript' },
          { title: 'Show notes + coverage only', value: 'show-notes' },
        ],
        layout: 'radio',
      },
      description: 'Honesty guard: what the reviewer actually accessed. Show-notes-only briefs keep claims modest and the post says it reviewed the episode’s published notes.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Pending', value: 'pending' },
          { title: 'Drafted', value: 'drafted' },
          { title: 'Published', value: 'published' },
          { title: 'Skipped', value: 'skipped' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'blogPostRef',
      title: 'Blog post slug',
      type: 'string',
      description: 'Slug of the published Notebook post written from this brief.',
    },
    {
      name: 'createdBy',
      title: 'Created by',
      type: 'string',
      description: 'Routine or person that wrote this brief (e.g. podcast-reviewer run id).',
    },
  ],
  orderings: [
    {
      title: 'Status, then newest episode',
      name: 'statusDate',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'publishedDate', direction: 'desc' },
      ],
    },
  ],
  preview: {
    select: { title: 'episodeTitle', show: 'showName', status: 'status' },
    prepare: ({ title, show, status }) => ({
      title,
      subtitle: `${show ?? '—'} · ${status ?? 'pending'}`,
    }),
  },
}
