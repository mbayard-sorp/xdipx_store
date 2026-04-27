// One sensation-dial dimension — label + scale documentation.
// Used inside `dialTaxonomy` arrays so editors can curate what a value MEANS
// for each dimension, per product type.
export default {
  name: 'dialDimension',
  title: 'Dial dimension',
  type: 'object',
  fields: [
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      validation: (Rule) => Rule.required().min(2).max(40),
      description: 'Short label shown on the PDP dial (e.g. "Intensity", "Quietness").',
    },
    {
      name: 'definition',
      title: 'Definition',
      type: 'text',
      rows: 2,
      description: 'Plain-language description of what this dimension measures (Emma-voice; <300 chars).',
      validation: (Rule) => Rule.max(400),
    },
    {
      name: 'scaleLow',
      title: 'Scale 1 (low end)',
      type: 'string',
      description: 'What does a value of 1 feel like / mean?',
      validation: (Rule) => Rule.max(160),
    },
    {
      name: 'scaleMid',
      title: 'Scale 3 (middle)',
      type: 'string',
      description: 'What does a value of 3 feel like / mean?',
      validation: (Rule) => Rule.max(160),
    },
    {
      name: 'scaleHigh',
      title: 'Scale 5 (high end)',
      type: 'string',
      description: 'What does a value of 5 feel like / mean?',
      validation: (Rule) => Rule.max(160),
    },
  ],
  preview: {
    select: { title: 'label', subtitle: 'definition' },
  },
}
