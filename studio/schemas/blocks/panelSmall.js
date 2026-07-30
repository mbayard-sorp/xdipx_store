import { SURFACES, MARKS } from './panelTokens'
import { withImageGenerator } from '../../lib/withImageGenerator'

// Small horizontal panel — the deck's utilities (Notebook, Sale).
//
// These rows carry a full-bleed art zone (owner direction 2026-07-30), on the
// same copy-zone/art-zone split as panelLarge so the label never sits on
// photography. Sale still stays the quietest panel in the deck: paper ground,
// never coral, no urgency shapes. A discount door given equal weight to the
// category doors trains discount-shopping on a brand positioned on curation, and
// a third of a 64px row is not equal weight to a full square tile.
//
// The art zone renders at roughly 64px, where an image is a silhouette and a
// colour and nothing else — brief abstract product macros, not packshots.
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
      description: 'Empty state. Ignored once an image is set.',
      options: { list: MARKS },
      hidden: ({ parent }) => !!parent?.figure || !!parent?.image,
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
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
    select: { title: 'label', subtitle: 'meta', media: 'image' },
  },
}
