import { bgStyleField } from '../../lib/bgStyleField'
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'editorialTiles',
  title: 'Editorial Tiles',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 20, hidden: true },
    { name: 'eyebrow', title: 'Eyebrow', type: 'string' },
    { name: 'heading', title: 'Heading', type: 'string' },
    bgStyleField({ initialValue: 'white' }),
    {
      name: 'tiles', title: 'Tiles', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'label',     title: 'Label',     type: 'string' },
          { name: 'body',      title: 'Body',      type: 'text' },
          { name: 'link',      title: 'Link URL',  type: 'string' },
          { name: 'linkLabel', title: 'Link Label', type: 'string' },
          { name: 'emoji',     title: 'Emoji (fallback)', type: 'string' },
          // AI image generation — adds imagePrompt sibling + wraps 'image' input
          ...withImageGenerator('image'),
        ],
        preview: { select: { title: 'label', media: 'image' } },
      }],
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
