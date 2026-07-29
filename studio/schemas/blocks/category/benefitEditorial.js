import { anchorIdField } from './anchorId'

// Three claims, each with a REQUIRED source.
//
// The required source is the whole point of the block and is enforced here at
// the schema, not by convention: the voice charter forbids invented facts
// ("every fact must trace to feed data, specs, or reviews") and the design
// doctrine forbids fabricated proof. A claim whose source is blank cannot be
// saved, so an unsourced claim can never reach the accuracy gate, let alone
// a customer.
export default {
  name: 'benefitEditorial',
  title: 'Benefit editorial',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'claims',
      title: 'Claims',
      type: 'array',
      validation: (Rule) => Rule.required().min(1).max(3),
      of: [
        {
          type: 'object',
          name: 'benefitClaim',
          title: 'Claim',
          fields: [
            {
              name: 'claim',
              title: 'Claim',
              type: 'string',
              description: 'One plain sentence. No medical claims.',
              validation: (Rule) => Rule.required().min(10).max(160),
            },
            {
              name: 'detail',
              title: 'Detail',
              type: 'text',
              rows: 2,
              validation: (Rule) => Rule.max(300),
            },
            {
              name: 'source',
              title: 'Source',
              type: 'string',
              description:
                'Where this is verifiable: a spec field, a manufacturer sheet, or a citable URL. Required.',
              validation: (Rule) => Rule.required().min(4).max(300),
            },
            {
              name: 'sourceUrl',
              title: 'Source URL',
              type: 'url',
              description: 'Optional link, when the source is a public page.',
            },
          ],
          preview: {
            select: { title: 'claim', subtitle: 'source' },
          },
        },
      ],
    },
  ],
  preview: {
    select: { title: 'heading', claims: 'claims' },
    prepare: ({ title, claims }) => {
      const n = Array.isArray(claims) ? claims.length : 0
      return {
        title: title || 'Benefit editorial',
        subtitle: `${n} sourced claim${n === 1 ? '' : 's'}`,
      }
    },
  },
}
