import { anchorIdField } from './anchorId'
import { withImageGenerator } from '../../../lib/withImageGenerator'

// Required opening block of every merchandised category and drop page.
// Carries the page's H1, so it is also the page's LCP element.
export default {
  name: 'categoryMasthead',
  title: 'Category masthead',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'top' }),
    {
      name: 'kicker',
      title: 'Kicker',
      type: 'string',
      description: 'Mono label above the headline. Factual, e.g. "42 in this aisle".',
      validation: (Rule) => Rule.max(28),
    },
    {
      name: 'headline',
      title: 'Headline (H1)',
      type: 'string',
      validation: (Rule) => Rule.required().max(60),
    },
    {
      name: 'italicWord',
      title: 'Italic word',
      type: 'string',
      description: 'The word in the headline rendered italic plum via <em class="em">.',
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'standfirst',
      title: 'Standfirst',
      type: 'text',
      rows: 3,
      description:
        'One or two sentences on what this aisle is for. Emma voice, no em-dashes, no countdowns.',
      validation: (Rule) => Rule.max(280),
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'headline', subtitle: 'kicker', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({
      title: title || 'Category masthead',
      subtitle: subtitle || 'No kicker',
      media,
    }),
  },
}
