import { SURFACES, MARKS } from './panelTokens'

// Small horizontal panel — the deck's utilities (Notebook, Sale).
//
// Sale stays the quietest panel in the deck: paper or ink, a mono figure, never
// coral. A discount door given equal weight to the category doors trains
// discount-shopping on a brand positioned on curation.
export default {
  name: 'panelSmall',
  title: 'Small horizontal panel',
  type: 'object',
  fields: [
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      validation: (Rule) => Rule.required().max(14),
    },
    {
      name: 'meta',
      title: 'Meta line',
      type: 'string',
      description: 'Desktop sub-line, hidden at 375.',
      validation: (Rule) => Rule.max(40),
    },
    {
      name: 'figure',
      title: 'Figure',
      type: 'string',
      description: 'Mono trailing figure, e.g. −30%. Excludes the mark.',
      validation: (Rule) =>
        Rule.max(8).custom((value, context) =>
          value && context.parent?.mark ? 'Use a figure or a mark, not both' : true,
        ),
    },
    {
      name: 'mark',
      title: 'Mark',
      type: 'string',
      options: { list: MARKS },
      hidden: ({ parent }) => !!parent?.figure,
    },
    {
      name: 'surface',
      title: 'Surface',
      type: 'string',
      initialValue: 'paper',
      options: { list: SURFACES },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'link',
      title: 'Destination',
      type: 'panelLink',
      validation: (Rule) => Rule.required(),
    },
  ],
  preview: {
    select: { title: 'label', subtitle: 'meta' },
  },
}
