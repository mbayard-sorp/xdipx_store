import { bgStyleField } from '../../lib/bgStyleField'
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'wayfinderMosaic',
  title: 'Wayfinder Mosaic (Find your way in)',
  type: 'object',
  fields: [
    { name: 'active',   title: 'Active',   type: 'boolean', initialValue: true },
    { name: 'order',    title: 'Order',    type: 'number',  initialValue: 40, hidden: true },
    { name: 'eyebrow',  title: 'Eyebrow',  type: 'string',  initialValue: 'Where to begin' },
    { name: 'heading',  title: 'Heading',  type: 'string',  initialValue: 'Find your way in.' },
    {
      name: 'emphasis',
      title: 'Emphasis word',
      type: 'string',
      initialValue: 'way',
      description: 'The word in the heading rendered coral via <em class="em">.',
    },
    bgStyleField({ initialValue: 'white' }),
    {
      name: 'tiles',
      title: 'Tiles',
      type: 'array',
      validation: (Rule) => Rule.min(3).max(4),
      of: [{
        type: 'object',
        name: 'wayfinderTile',
        title: 'Wayfinder Tile',
        fields: [
          { name: 'label', title: 'Label',    type: 'string' },
          { name: 'link',  title: 'Link URL', type: 'string' },
          {
            name: 'emmaAside',
            title: 'Emma aside (optional)',
            type: 'string',
            description: 'Short Emma-voice line, no em-dashes. Use ♥ only in CTAs/asides.',
          },
          // AI image generation — adds imagePrompt sibling + wraps 'image' input
          ...withImageGenerator('image'),
        ],
        preview: { select: { title: 'label', subtitle: 'link', media: 'image' } },
      }],
    },
    {
      name: 'promo',
      title: 'Promo Tile',
      type: 'object',
      fields: [
        { name: 'eyebrow',   title: 'Eyebrow',   type: 'string', initialValue: 'Discover You' },
        { name: 'heading',   title: 'Heading',   type: 'string' },
        { name: 'emphasis',  title: 'Emphasis word', type: 'string' },
        { name: 'body',      title: 'Body',      type: 'text', rows: 2 },
        { name: 'ctaLabel',  title: 'CTA Label', type: 'string', initialValue: 'Find your fit →' },
        { name: 'ctaLink',   title: 'CTA Link',  type: 'string', initialValue: '/discover' },
        // AI image generation — adds imagePrompt sibling + wraps 'image' input
        ...withImageGenerator('image'),
      ],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order', count: 'tiles' },
    prepare({ title, active, order, count }) {
      const n = Array.isArray(count) ? count.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} tile${n !== 1 ? 's' : ''} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
