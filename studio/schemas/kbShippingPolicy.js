/**
 * kbShippingPolicy — singleton-like. Shipping policy text surfaced by the
 * kbLookup tool for SMS / IVR / chat. Additive — does not touch existing schema.
 */
export default {
  name: 'kbShippingPolicy',
  title: 'KB: Shipping Policy',
  type: 'document',
  description: 'Shipping policy copy used by the SMS / IVR / chat knowledge-base lookup. One authoritative doc — treat as a singleton.',
  fields: [
    {
      name: 'title',
      title: 'Internal title',
      type: 'string',
      initialValue: 'Shipping Policy',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'quickAnswer',
      title: 'Quick answer (SMS / IVR)',
      type: 'string',
      description: 'Max 280 chars. Used verbatim in SMS replies and IVR slots. Plain text only.',
      validation: (Rule) => Rule.required().max(280),
    },
    {
      name: 'body',
      title: 'Full policy (rich text)',
      type: 'array',
      of: [
        {
          type: 'block',
          styles: [
            { title: 'Normal', value: 'normal' },
            { title: 'Heading 3', value: 'h3' },
          ],
          marks: {
            decorators: [
              { title: 'Bold', value: 'strong' },
              { title: 'Italic', value: 'em' },
            ],
          },
        },
      ],
      description: 'Full policy body — rendered in web-chat richer surface and admin preview.',
    },
    {
      name: 'lastReviewedAt',
      title: 'Last reviewed at',
      type: 'datetime',
      description: 'When a human last reviewed and approved this policy text.',
    },
  ],
  preview: {
    select: { title: 'title', quickAnswer: 'quickAnswer', lastReviewedAt: 'lastReviewedAt' },
    prepare: ({ title, quickAnswer, lastReviewedAt }) => ({
      title: title || 'Shipping Policy',
      subtitle: [lastReviewedAt ? `Reviewed ${lastReviewedAt.slice(0, 10)}` : 'Not reviewed', quickAnswer ? quickAnswer.slice(0, 60) : ''].filter(Boolean).join(' — '),
    }),
  },
}
