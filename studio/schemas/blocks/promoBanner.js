// AI image generation — see docs/ai-image-generation.md
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'promoBanner',
  title: 'Promo Banner',
  type: 'object',
  fields: [
    { name: 'active',   title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',    title: 'Order',  type: 'number',  initialValue: 10 },
    { name: 'headline', title: 'Headline', type: 'string' },
    { name: 'subtext',  title: 'Subtext',  type: 'string' },
    { name: 'ctaLabel', title: 'CTA Label', type: 'string' },
    { name: 'ctaLink',  title: 'CTA Link',  type: 'string' },
    {
      name: 'layout', title: 'Layout', type: 'string',
      options: { list: ['text-only', 'image-left', 'image-right', 'full-bleed'] },
      initialValue: 'text-only',
    },
    {
      name: 'bgStyle', title: 'Background', type: 'string',
      options: { list: ['charcoal', 'gradient', 'mist', 'purple', 'cream'] },
      initialValue: 'gradient',
    },
    // AI image generation — replaces the plain image field
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'headline', active: 'active', order: 'order' },
    prepare({ title, active, order }) {
      return {
        title: title ?? '(no headline)',
        subtitle: `Order ${order ?? 0} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
