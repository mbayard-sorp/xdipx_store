import { anchorIdField } from './anchorId'

// Why this drop exists. A buyer's note, in Emma's voice, about what she was
// looking for when she picked these. She is an AI guide with no lived
// experience, so this is reasoning about the catalog, never a personal anecdote.
export default {
  name: 'makersNote',
  title: 'Buyer’s note',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'Why these',
      validation: (Rule) => Rule.max(48),
    },
    {
      name: 'body',
      title: 'Note',
      type: 'text',
      rows: 5,
      description: 'No "I tried it". Speak to what the reader will find, and why it was chosen.',
      validation: (Rule) => Rule.required().max(800),
    },
  ],
  preview: {
    select: { title: 'heading', subtitle: 'body' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Buyer’s note',
      subtitle: subtitle ? subtitle.slice(0, 80) + (subtitle.length > 80 ? '…' : '') : '',
    }),
  },
}
