import { anchorIdField } from './anchorId'

// Category-scoped questions. Same array feeds the visible accordion and the
// FAQPage JSON-LD, so screen and schema can never disagree.
//
// These pages sit next to materials and body-safety topics, so the blog
// addendum's no-medical-claims rule applies here too: describe materials and
// care plainly, and hand off to a clinician rather than diagnosing.
export default {
  name: 'faqBlock',
  title: 'FAQ',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'faq' }),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'Questions, answered.',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'items',
      title: 'Questions',
      type: 'array',
      validation: (Rule) => Rule.required().min(1).max(12),
      of: [
        {
          type: 'object',
          name: 'categoryFaqItem',
          title: 'Question',
          fields: [
            {
              name: 'question',
              title: 'Question',
              type: 'string',
              description: 'Full natural-language question, not keywords.',
              validation: (Rule) => Rule.required().min(10).max(160),
            },
            {
              name: 'answer',
              title: 'Answer',
              type: 'text',
              rows: 3,
              description:
                'Plain text, at least one full sentence. No em-dashes, no medical claims. The card statement always reads XDIPX.',
              validation: (Rule) => Rule.required().min(40).max(800),
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
    },
  ],
  preview: {
    select: { title: 'heading', items: 'items' },
    prepare: ({ title, items }) => {
      const n = Array.isArray(items) ? items.length : 0
      return { title: title || 'FAQ', subtitle: `${n} question${n === 1 ? '' : 's'}` }
    },
  },
}
