import { bgStyleField } from '../../lib/bgStyleField'
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'playTogetherBanner',
  title: 'Play Together Banner',
  type: 'object',
  fields: [
    { name: 'active',        title: 'Active',        type: 'boolean', initialValue: true },
    { name: 'order',         title: 'Order',         type: 'number',  initialValue: 50, hidden: true },
    { name: 'heading',       title: 'Heading',       type: 'string' },
    { name: 'body',          title: 'Body',          type: 'text' },
    { name: 'ctaLabel',      title: 'CTA Label',     type: 'string' },
    { name: 'ctaLink',       title: 'CTA Link',      type: 'string' },
    bgStyleField({ initialValue: 'cream' }),
    {
      name: 'imagePosition', title: 'Image Position', type: 'string',
      options: { list: ['left', 'right'] }, initialValue: 'right',
    },
    // AI image generation — replaces the plain image field
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'heading', media: 'image', active: 'active', order: 'order' },
    prepare({ title, media, active, order }) {
      return {
        title: title ?? '(no heading)',
        subtitle: `${active ? 'Visible' : 'Hidden'}`,
        media,
      }
    },
  },
}
