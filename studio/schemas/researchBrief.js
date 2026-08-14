// Research brief: one industry/business research topic gathered by the weekly
// adult-business-researcher routine and handed to the social-media-manager,
// which turns a pending brief into a brand-voice LinkedIn draft (draft-only,
// reviewed in /admin/socials). The brief itself is internal (no voice gate);
// the gate applies at the draft stage. Field shape mirrors
// docs/store-team/routine-research-weekly.md "The researchBrief doc shape".
// Additive — does not modify any existing schema (same path podcastReviewBrief
// took). The MCP write path already works; this is the Studio rendering type so
// opening a brief no longer throws "Schema type for researchBrief not found".
export default {
  name: 'researchBrief',
  title: 'Research Brief',
  type: 'document',
  fields: [
    {
      name: 'topic',
      title: 'Topic',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'suggestedAngle',
      title: 'Suggested angle',
      type: 'text',
      rows: 2,
      description: 'One-sentence thesis for the post. Not final copy.',
    },
    {
      name: 'whyItMatters',
      title: 'Why it matters',
      type: 'text',
      rows: 3,
      description: "Who the reader is and why they'd care.",
    },
    {
      name: 'targetPlatform',
      title: 'Target platform',
      type: 'string',
      options: {
        list: [{ title: 'LinkedIn', value: 'linkedin' }],
        layout: 'radio',
      },
      initialValue: 'linkedin',
      description: 'Open for reuse by other channels later.',
    },
    {
      name: 'claims',
      title: 'Claims',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'claim', title: 'Claim', type: 'text', rows: 2, validation: (Rule) => Rule.required() },
            { name: 'sourceUrl', title: 'Source URL', type: 'url', validation: (Rule) => Rule.required() },
            {
              name: 'sourceName',
              title: 'Source name',
              type: 'string',
              description: "Publication or report, for the owner's quick scan.",
            },
            {
              name: 'retrievedAt',
              title: 'Retrieved at',
              type: 'date',
              description: "When the agent read it, NOT the source's publish date.",
            },
            {
              name: 'confidence',
              title: 'Confidence',
              type: 'string',
              options: {
                list: [
                  { title: 'High', value: 'high' },
                  { title: 'Medium', value: 'medium' },
                  { title: 'Low', value: 'low' },
                ],
                layout: 'radio',
              },
              validation: (Rule) => Rule.required(),
            },
          ],
          preview: { select: { title: 'claim', subtitle: 'sourceName' } },
        },
      ],
      description: 'Two to four claims per brief, each citing what was actually read.',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Pending', value: 'pending' },
          { title: 'Used', value: 'used' },
          { title: 'Expired', value: 'expired' },
        ],
        layout: 'radio',
      },
      initialValue: 'pending',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'usedByPostId',
      title: 'Used by post id',
      type: 'number',
      description: 'social_posts.id once a draft was written from this brief, for traceability.',
    },
    {
      name: 'createdBy',
      title: 'Created by',
      type: 'string',
      description: 'Routine or run id that wrote this brief.',
    },
    {
      name: 'createdAt',
      title: 'Created at',
      type: 'datetime',
    },
  ],
  orderings: [
    {
      title: 'Status, then newest',
      name: 'statusCreated',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'createdAt', direction: 'desc' },
      ],
    },
  ],
  preview: {
    select: { title: 'topic', status: 'status', platform: 'targetPlatform' },
    prepare: ({ title, status, platform }) => ({
      title,
      subtitle: `${platform ?? 'linkedin'} · ${status ?? 'pending'}`,
    }),
  },
}
