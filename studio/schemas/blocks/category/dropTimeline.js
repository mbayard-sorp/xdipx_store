import { anchorIdField } from './anchorId'

// A dated spine of what arrived when. Dates are retrospective facts about
// things already here, which is why this is not a countdown: nothing on this
// block ever refers to a deadline or a remaining window.
export default {
  name: 'dropTimeline',
  title: 'Drop timeline',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'What landed, and when',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'entries',
      title: 'Entries',
      type: 'array',
      validation: (Rule) => Rule.required().min(1).max(12),
      of: [
        {
          type: 'object',
          name: 'dropTimelineEntry',
          title: 'Entry',
          fields: [
            {
              name: 'label',
              title: 'Date label',
              type: 'string',
              description: 'Plain calendar wording, e.g. "Week of 14 July".',
              validation: (Rule) => Rule.required().max(32),
            },
            {
              name: 'productHandles',
              title: 'Product handles',
              type: 'array',
              of: [{ type: 'string' }],
              validation: (Rule) => Rule.required().min(1).max(6),
            },
            {
              name: 'note',
              title: 'Note',
              type: 'string',
              validation: (Rule) => Rule.max(160),
            },
          ],
          preview: {
            select: { title: 'label', handles: 'productHandles' },
            prepare: ({ title, handles }) => {
              const n = Array.isArray(handles) ? handles.length : 0
              return { title: title || 'Entry', subtitle: `${n} product${n === 1 ? '' : 's'}` }
            },
          },
        },
      ],
    },
  ],
  preview: {
    select: { title: 'heading', entries: 'entries' },
    prepare: ({ title, entries }) => {
      const n = Array.isArray(entries) ? entries.length : 0
      return { title: title || 'Drop timeline', subtitle: `${n} entr${n === 1 ? 'y' : 'ies'}` }
    },
  },
}
