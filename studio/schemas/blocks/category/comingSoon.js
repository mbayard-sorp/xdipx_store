import { anchorIdField } from './anchorId'

// Notify capture for things not here yet. No price is shown, because there is
// nothing to buy.
//
// The copy pattern is the charter's own: picks land on an irregular schedule,
// and the offer is to hear about it first. No date, no countdown, no scarcity.
export default {
  name: 'comingSoon',
  title: 'Coming soon',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'body',
      title: 'Body',
      type: 'text',
      rows: 2,
      description:
        'Irregular-schedule framing only, e.g. "New picks land on an irregular schedule. Be first to hear." Never a date or a countdown.',
      validation: (Rule) => Rule.max(240),
    },
    {
      name: 'ctaLabel',
      title: 'CTA label',
      type: 'string',
      initialValue: 'Show me',
      options: { list: ['Show me', 'Take a peek →', 'Find your fit →'] },
    },
  ],
  preview: {
    select: { title: 'heading', subtitle: 'body' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Coming soon',
      subtitle: subtitle ? subtitle.slice(0, 80) : 'Notify capture',
    }),
  },
}
