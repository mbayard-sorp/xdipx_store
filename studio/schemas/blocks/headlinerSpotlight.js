// Merch components v1 — 1a Headliner spotlight. New additive block.
// Homepage's ONE primary CTA, directly below the hero. Price is read live
// from the product at render time; priceOverride only exists for the rare
// case Emma wants to hold a number steady across a Shopify price change.
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'headlinerSpotlight',
  title: 'Headliner Spotlight',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 5, hidden: true },

    {
      name: 'productHandle',
      title: 'Product Handle',
      type: 'string',
      description: 'Shopify product handle (the URL slug) the spotlight points to.',
      validation: (Rule) => Rule.required(),
    },

    { name: 'kicker', title: 'Kicker', type: 'string', description: 'e.g. "This week · Nº 27".' },
    { name: 'headline', title: 'Headline', type: 'string', validation: (Rule) => Rule.required() },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the headline rendered italic plum via <em class="em">.',
    },
    {
      name: 'priceOverride',
      title: 'Price override (optional)',
      type: 'number',
      description: 'Only set this to hold a number steady across a Shopify price change. Leave blank to read the live product price.',
    },
    {
      name: 'mechanismCallout',
      title: 'Mechanism callout (optional)',
      type: 'string',
      description: 'Plum hairline aside describing how the product works, e.g. "It doesn\'t touch you. It pulses the air."',
    },
    {
      name: 'ctaLabel',
      title: 'CTA Label',
      type: 'string',
      options: {
        list: ['Take a peek →', 'Show me', 'Find your fit →', "I'll take it ♥"],
      },
      initialValue: 'Take a peek →',
    },
    { name: 'ctaLink', title: 'CTA Link', type: 'string', description: 'Defaults to /products/{handle} if left blank.' },

    // AI image generation — adds imagePrompt sibling + wraps 'image' input.
    // This is the LCP image; component never wraps it in reveal motion.
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'headline', handle: 'productHandle', active: 'active' },
    prepare({ title, handle, active }) {
      return {
        title: title ?? '(no headline)',
        subtitle: `${handle ?? '(no product)'} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
