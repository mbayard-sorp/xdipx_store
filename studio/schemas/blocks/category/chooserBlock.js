import { anchorIdField } from './anchorId'

// The curiosity chooser, scoped to this category. Two taps maximum, and it
// filters the shelf in place. Tapping an incompatible tile replaces the
// selection rather than dead-ending on an empty result.
export default {
  name: 'chooserBlock',
  title: 'Chooser',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'What are you after?',
      validation: (Rule) => Rule.max(48),
    },
    {
      name: 'options',
      title: 'Options',
      type: 'array',
      validation: (Rule) => Rule.required().min(2).max(6),
      of: [
        {
          type: 'object',
          name: 'chooserOption',
          title: 'Option',
          fields: [
            {
              name: 'label',
              title: 'Label',
              type: 'string',
              validation: (Rule) => Rule.required().max(20),
            },
            {
              name: 'tag',
              title: 'Tag',
              type: 'string',
              description:
                'Must exist in the live Ask Emma vocabulary, or the tile matches zero products and renders dead.',
              validation: (Rule) => Rule.required().max(48),
            },
            {
              name: 'narratorCopy',
              title: 'Narrator line',
              type: 'string',
              description: 'Shown when this option is active. Emma voice.',
              validation: (Rule) => Rule.max(120),
            },
          ],
          preview: { select: { title: 'label', subtitle: 'tag' } },
        },
      ],
    },
  ],
  preview: {
    select: { title: 'heading', options: 'options' },
    prepare: ({ title, options }) => {
      const n = Array.isArray(options) ? options.length : 0
      return { title: title || 'Chooser', subtitle: `${n} option${n === 1 ? '' : 's'}` }
    },
  },
}
