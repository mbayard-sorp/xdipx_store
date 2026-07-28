// Homepage FAQ band (Nº 11) — additive block so the merchandising team can edit
// the storefront's questions without a deploy. Modeled on `productFaq` (the PDP
// Q&A object), but as a whole SECTION rather than a single entry, because the
// homepage renders one band with its own heading.
//
// The visible answers and the FAQPage JSON-LD are emitted from the SAME array
// (StorefrontHome passes whichever set actually renders into FAQStructuredData),
// so schema and screen can never disagree. Do not hide content in JSON-LD only.
//
// When no `homepageFaq` block is published the storefront keeps its hardcoded
// FAQ array, so this is purely an override.
export default {
  name: 'homepageFaq',
  title: 'Homepage FAQ',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 90, hidden: true },
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description:
        'Section headline. The last word renders in the italic plum emphasis style. Leave unset for "Questions, answered."',
    },
    {
      name: 'items',
      title: 'Questions',
      type: 'array',
      description:
        'Rendered as the visible accordion AND as FAQPage JSON-LD. Keep them to the things a nervous first-time buyer actually asks.',
      of: [
        {
          type: 'object',
          name: 'homepageFaqItem',
          title: 'Question',
          fields: [
            {
              name: 'question',
              title: 'Question',
              type: 'string',
              description:
                'Full natural-language question, e.g. "How discreet is shipping?". Not just keywords.',
              validation: Rule => Rule.required().min(10).max(160),
            },
            {
              name: 'answer',
              title: 'Answer',
              type: 'text',
              rows: 3,
              description:
                'At least one full sentence (40+ chars). Plain text only, no HTML. Emma voice, no em-dashes. The card statement always reads XDIPX.',
              validation: Rule => Rule.required().min(40).max(800),
            },
          ],
          preview: {
            select: { title: 'question', subtitle: 'answer' },
            prepare: ({ title, subtitle }) => ({
              title: title || 'Untitled question',
              subtitle: subtitle ? subtitle.slice(0, 80) + (subtitle.length > 80 ? '…' : '') : '',
            }),
          },
        },
      ],
      validation: Rule => Rule.min(1).error('Add at least one question, or remove the block.'),
    },
  ],
  preview: {
    select: { heading: 'heading', items: 'items', active: 'active' },
    prepare: ({ heading, items, active }) => {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: heading || 'Homepage FAQ',
        subtitle: `${n} question${n === 1 ? '' : 's'} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
