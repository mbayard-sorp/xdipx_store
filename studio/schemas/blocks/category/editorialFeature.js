import { anchorIdField } from './anchorId'
import { withImageGenerator } from '../../../lib/withImageGenerator'

// One product, argued for. Max one per page, enforced on the page document's
// blocks array so a page can never turn into a wall of features.
export default {
  name: 'editorialFeature',
  title: 'Editorial feature',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'productHandle',
      title: 'Product handle',
      type: 'string',
      validation: (Rule) =>
        Rule.required().custom((value) =>
          !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Bare Shopify product handle, no slashes',
        ),
    },
    {
      name: 'kicker',
      title: 'Kicker',
      type: 'string',
      validation: (Rule) => Rule.max(28),
    },
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      validation: (Rule) => Rule.required().max(80),
    },
    {
      name: 'italicWord',
      title: 'Italic word',
      type: 'string',
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'body',
      title: 'The argument',
      type: 'text',
      rows: 4,
      description:
        'Why this one earns the slot, in terms of what the reader will feel. Emma has no lived experience: never "I tried it".',
      validation: (Rule) => Rule.max(600),
    },
    {
      name: 'ctaLabel',
      title: 'CTA label',
      type: 'string',
      initialValue: 'Take a peek →',
      description: 'Voice charter CTA whitelist only.',
      options: {
        list: ['Take a peek →', 'Show me', 'Find your fit →', 'I’ll take it ♥'],
      },
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'headline', subtitle: 'productHandle', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({
      title: title || 'Editorial feature',
      subtitle: subtitle || 'No product set',
      media,
    }),
  },
}
