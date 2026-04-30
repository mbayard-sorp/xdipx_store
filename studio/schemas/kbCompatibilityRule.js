/**
 * kbCompatibilityRule — a row in a product-compatibility matrix.
 * Used by the kbLookup tool to answer "can I use X with Y?" questions
 * via SMS / IVR / chat. Additive — does not touch existing schema.
 */
export default {
  name: 'kbCompatibilityRule',
  title: 'KB: Compatibility Rule',
  type: 'document',
  description: 'One row in the product-type compatibility matrix. Drives the kbLookup compatibility topic for SMS / IVR / chat.',
  fields: [
    {
      name: 'productTypeA',
      title: 'Product type A',
      type: 'string',
      description: 'e.g. "silicone-toy", "latex-condom", "porous-toy". Use kebab-case.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'productTypeB',
      title: 'Product type B',
      type: 'string',
      description: 'e.g. "silicone-lube", "water-based-lube", "oil-based-lube". Use kebab-case.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'compatible',
      title: 'Compatible?',
      type: 'boolean',
      description: 'True = safe to use together. False = NOT safe.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'note',
      title: 'Note (SMS / IVR)',
      type: 'string',
      description: 'Max 280 chars. Plain-text explanation surfaced in SMS / IVR replies.',
      validation: (Rule) => Rule.max(280),
    },
    {
      name: 'categoryTags',
      title: 'Category tags',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Tags used to match this rule by product category. e.g. ["silicone-toy", "silicone-lube"]. The kbLookup tool filters on these.',
      options: {
        layout: 'tags',
      },
    },
  ],
  preview: {
    select: { typeA: 'productTypeA', typeB: 'productTypeB', compatible: 'compatible' },
    prepare: ({ typeA, typeB, compatible }) => ({
      title: `${typeA || '?'} + ${typeB || '?'}`,
      subtitle: compatible ? 'Compatible' : 'NOT compatible',
    }),
  },
  orderings: [
    { title: 'Type A (A-Z)', name: 'typeAAsc', by: [{ field: 'productTypeA', direction: 'asc' }] },
  ],
}
