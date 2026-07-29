import { anchorIdField } from './anchorId'
import { withImageGenerator } from '../../../lib/withImageGenerator'

// Drop-page opener. Counts are live from Shopify.
//
// Period is a calendar fact ("July"), never a countdown. No end dates, no "x
// days left", no progress bars: the charter bans urgency theater, and that ban
// covers the pixels as well as the words (no clock or starburst imagery).
export default {
  name: 'dropMasthead',
  title: 'Drop masthead',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'top' }),
    {
      name: 'period',
      title: 'Period label',
      type: 'string',
      description: 'Calendar statement, e.g. "This month". Never a countdown.',
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
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'standfirst',
      title: 'Standfirst',
      type: 'text',
      rows: 2,
      validation: (Rule) => Rule.max(280),
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'headline', subtitle: 'period', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({
      title: title || 'Drop masthead',
      subtitle: subtitle || '',
      media,
    }),
  },
}
