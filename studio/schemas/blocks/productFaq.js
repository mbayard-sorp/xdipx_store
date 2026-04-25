// Per-product FAQ entry — shapes 1:1 to schema.org Question / acceptedAnswer.
// Used by productPage.productFaqs[]. Renders as visible Q&A on the PDP and
// emits FAQPage JSON-LD. Visible answer text MUST match JSON-LD answer text
// (do not hide content in schema only — Google flags that).
export default {
  name: 'productFaq',
  title: 'Product FAQ',
  type: 'object',
  fields: [
    {
      name: 'question',
      title: 'Question',
      type: 'string',
      description: 'Full natural-language question, e.g. "How long does it take to charge?". Not just keywords.',
      validation: Rule => Rule.required().min(10).max(160),
    },
    {
      name: 'answer',
      title: 'Answer',
      type: 'text',
      rows: 3,
      description: 'At least one full sentence (40+ chars). Plain text only, no HTML. Emma voice. No em-dashes.',
      validation: Rule => Rule.required().min(40).max(800),
    },
    {
      name: 'category',
      title: 'Category',
      type: 'string',
      description: 'Groups FAQs on the PDP. "Care" entries also surface in the Care Instructions summary card.',
      options: {
        list: [
          { title: 'General',       value: 'general'       },
          { title: 'Care',          value: 'care'          },
          { title: 'Usage',         value: 'usage'         },
          { title: 'Compatibility', value: 'compatibility' },
          { title: 'Shipping',      value: 'shipping'      },
        ],
        layout: 'dropdown',
      },
      initialValue: 'general',
    },
  ],
  preview: {
    select: { title: 'question', subtitle: 'answer' },
    prepare: ({ title, subtitle }) => ({
      title:    title    || 'Untitled question',
      subtitle: subtitle ? subtitle.slice(0, 80) + (subtitle.length > 80 ? '…' : '') : '',
    }),
  },
}
