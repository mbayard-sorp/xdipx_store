import { SURFACES, MARKS, CTA_LABELS } from './panelTokens'
import { withImageGenerator } from '../../lib/withImageGenerator'

// Large horizontal panel — the deck's merchandising drivers (Discover, New).
// These are the two panels allowed richer photography, because a wide box has
// room for a focal point. Text never overlays the image: the image holds one
// side, the label card the other.
export default {
  name: 'panelLarge',
  title: 'Large horizontal panel',
  type: 'object',
  fields: [
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      description: 'Sets at 34px on desktop, so keep it short.',
      validation: (Rule) => Rule.required().max(16),
    },
    {
      name: 'kicker',
      title: 'Kicker',
      type: 'string',
      description: 'Factual, e.g. "14 this month". Not a slogan, never a countdown.',
      validation: (Rule) => Rule.max(22),
    },
    {
      name: 'blurb',
      title: 'Blurb',
      type: 'string',
      description: 'Desktop only, hidden below 768. Never load-bearing.',
      validation: (Rule) => Rule.max(70),
    },
    {
      name: 'ctaLabel',
      title: 'CTA label',
      type: 'string',
      description: 'Navigational affordance. Action CTAs follow the voice charter whitelist.',
      options: { list: CTA_LABELS },
    },
    {
      name: 'surface',
      title: 'Surface',
      type: 'string',
      initialValue: 'plum',
      options: { list: SURFACES },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'mark',
      title: 'Mark',
      type: 'string',
      description: 'Empty state. Ignored once an image is set.',
      options: { list: MARKS },
      hidden: ({ parent }) => !!parent?.image,
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
    {
      name: 'link',
      title: 'Destination',
      type: 'panelLink',
      validation: (Rule) => Rule.required(),
    },
  ],
  preview: {
    select: { title: 'label', subtitle: 'kicker', media: 'image' },
  },
}
