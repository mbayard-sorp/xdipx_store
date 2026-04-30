/**
 * kbBrandFaq — many. Brand FAQ entries surfaced by the kbLookup tool
 * for SMS / IVR / chat. Additive — does not touch existing schema.
 *
 * IMPORTANT: The billing descriptor for xdipx.com reads "XDIPX" on credit
 * card statements. Never use "DIPCOM" or any other variant in content here.
 */
export default {
  name: 'kbBrandFaq',
  title: 'KB: Brand FAQ',
  type: 'document',
  description: 'A brand FAQ entry surfaced by the kbLookup tool. Matched by keyword overlap with tags and question text.',
  fields: [
    {
      name: 'question',
      title: 'Question',
      type: 'string',
      description: 'The question as a customer would ask it.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'answer',
      title: 'Answer (SMS / IVR)',
      type: 'string',
      description: 'Max 280 chars. Used verbatim in SMS / IVR replies. Plain text. BILLING: The credit card statement reads "XDIPX" — never "DIPCOM".',
      validation: (Rule) => Rule.required().max(280),
    },
    {
      name: 'tags',
      title: 'Match tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Keyword tags the kbLookup tool uses to match this FAQ to a query. e.g. ["discreet", "billing-descriptor", "shipping-origin"]. Lowercase.',
      options: {
        layout: 'tags',
      },
    },
  ],
  preview: {
    select: { question: 'question', answer: 'answer', tags: 'tags' },
    prepare: ({ question, answer, tags }) => ({
      title: question || 'Untitled FAQ',
      subtitle: [Array.isArray(tags) ? tags.slice(0, 3).join(', ') : '', answer ? answer.slice(0, 60) : ''].filter(Boolean).join(' — '),
    }),
  },
  orderings: [
    { title: 'Question (A-Z)', name: 'questionAsc', by: [{ field: 'question', direction: 'asc' }] },
  ],
}
