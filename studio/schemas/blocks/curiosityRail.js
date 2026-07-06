// Merch components v1 — 1c Curiosity spread rail. New additive block.
// Four TYPED role slots in a fixed price-ladder order (on-ramp → standby →
// headliner → reach). The ladder order is shell, not editorial — the roles
// always render in this sequence regardless of price.
function roleSlotField(name, title, description) {
  return {
    name,
    title,
    type: 'object',
    description,
    fields: [
      {
        name: 'productHandle',
        title: 'Product Handle',
        type: 'string',
        description: 'Shopify product handle (the URL slug).',
      },
      {
        name: 'copyLine',
        title: 'Copy line',
        type: 'string',
        description: 'One short line under the product name, e.g. "Zero learning curve. All mood."',
      },
    ],
    preview: {
      select: { title: 'productHandle', subtitle: 'copyLine' },
      prepare({ title, subtitle }) {
        return { title: title ?? '(empty)', subtitle }
      },
    },
  }
}

export default {
  name: 'curiosityRail',
  title: 'Curiosity Spread Rail',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 15, hidden: true },

    { name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'e.g. "The spread · this week".' },
    { name: 'heading', title: 'Heading', type: 'string', description: 'e.g. "Four ways in."' },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the heading rendered italic plum via <em class="em">.',
    },

    roleSlotField('onRamp', 'On-ramp role', 'Sage kicker, under $30. The lowest rung on the ladder — zero learning curve.'),
    roleSlotField('standby', 'Standby role', 'The fixed anchor a returning browser recognizes.'),
    roleSlotField('headliner', 'Headliner role', 'Coral kicker + the only coral hairline card border. Usually mirrors the 1a spotlight product.'),
    roleSlotField('reach', 'Reach role', 'Plum kicker. The stretch pick for someone ready to hand over the controls.'),

    { name: 'ctaLink', title: 'See-all collection link', type: 'string' },
    {
      name: 'ctaLabelOverride',
      title: 'CTA label override (optional)',
      type: 'string',
      description: 'Component always renders "Show me" unless you override it here from the whitelist.',
      options: {
        list: ['Show me', 'Take a peek →', 'Find your fit →', "I'll take it ♥"],
      },
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active' },
    prepare({ title, active }) {
      return {
        title: title ?? '(no heading)',
        subtitle: `${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
