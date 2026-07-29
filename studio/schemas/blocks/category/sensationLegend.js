import { anchorIdField } from './anchorId'

// Teaches this category's dial axes before the shelves use them.
//
// Axes are per-category and are NOT authored here: they resolve from the
// dialTaxonomy singleton so one product has one truth across PDP, card, and
// legend. Dial VALUES live on the Shopify product metafield. Where a product
// has no dial value, the card renders no dial rather than a fake one
// (design-doctrine §6, never fabricate proof).
export default {
  name: 'sensationLegend',
  title: 'Sensation legend',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'legend' }),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'How we describe these',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'intro',
      title: 'Intro',
      type: 'text',
      rows: 2,
      description: 'Plain, spec-register copy. This is a mechanism surface, not a desire surface.',
      validation: (Rule) => Rule.max(240),
    },
    {
      name: 'axisSet',
      title: 'Axis set',
      type: 'string',
      description:
        'Which dialTaxonomy axis set this category reads. Leave blank to use the category default.',
      validation: (Rule) => Rule.max(48),
    },
  ],
  preview: {
    select: { title: 'heading', subtitle: 'axisSet' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Sensation legend',
      subtitle: subtitle ? `Axis set: ${subtitle}` : 'Category default axes',
    }),
  },
}
