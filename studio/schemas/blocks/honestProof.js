// Merch components v1 — 1h Honest proof module. New additive block.
// Zero-hype testimonials with provenance always attached. If there are no
// approved quotes, the module should not render at all — never filler
// testimonials (component-side logic, not schema).
export default {
  name: 'honestProof',
  title: 'Honest Proof',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 60, hidden: true },

    { name: 'eyebrow', title: 'Eyebrow', type: 'string', initialValue: 'Word of mouth' },

    {
      name: 'quotes',
      title: 'Quotes',
      type: 'array',
      description: 'Verbatim, human-approved quotes. Also feeds the proof-chip variant reused in rails/PDP.',
      of: [
        {
          type: 'object',
          name: 'honestProofQuote',
          fields: [
            {
              name: 'verbatimText',
              title: 'Verbatim quote',
              type: 'text',
              rows: 2,
              description: 'Exact customer words. Clamp at 4 lines; chips take phrases ≤6 words only.',
              validation: (Rule) => Rule.required(),
            },
            {
              name: 'productHandle',
              title: 'Product Handle',
              type: 'string',
              description: 'Shopify product handle (the URL slug) this quote is about.',
            },
            {
              name: 'durationOwned',
              title: 'Duration owned',
              type: 'string',
              description: 'e.g. "owned 4 months".',
            },
            {
              name: 'verified',
              title: 'Verified buyer',
              type: 'boolean',
              initialValue: true,
            },
          ],
          preview: {
            select: { title: 'verbatimText', subtitle: 'productHandle' },
          },
        },
      ],
    },

    {
      name: 'press',
      title: 'Press mentions',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'honestProofPress',
          fields: [
            { name: 'quote',       title: 'Quote',       type: 'string', validation: (Rule) => Rule.required() },
            { name: 'publication', title: 'Publication', type: 'string' },
          ],
          preview: {
            select: { title: 'quote', subtitle: 'publication' },
          },
        },
      ],
      validation: (Rule) => Rule.max(4),
    },
  ],
  preview: {
    select: { active: 'active', quotes: 'quotes' },
    prepare({ active, quotes }) {
      const n = Array.isArray(quotes) ? quotes.length : 0
      return {
        title: 'Honest Proof',
        subtitle: `${n} quote${n !== 1 ? 's' : ''} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
