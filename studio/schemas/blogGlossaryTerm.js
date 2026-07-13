// Notebook glossary — living plain-language reference (additive).
// One doc per term; rendered A-to-Z at /notebook/glossary with DefinedTerm
// JSON-LD. Definitions are answer-shaped: the first sentence should stand
// alone as the answer to "what is X".
export default {
  name: 'blogGlossaryTerm',
  title: 'Glossary Term',
  type: 'document',
  fields: [
    {
      name: 'term',
      title: 'Term',
      type: 'string',
      description: 'Display name, sentence case (e.g. "Air pulsation").',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'term', maxLength: 96},
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'definition',
      title: 'Definition',
      type: 'text',
      rows: 4,
      description: '2-4 plain sentences, definition-first. No prices, no medical claims.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'collectionHandle',
      title: 'Collection handle',
      type: 'string',
      description: 'Optional store collection this term maps to (renders a "Find your fit" link).',
    },
    {
      name: 'relatedPost',
      title: 'Related post',
      type: 'reference',
      to: [{type: 'blogPost'}],
      description: 'Optional Notebook post that goes deeper on this term.',
    },
    {
      name: 'seeAlso',
      title: 'See also',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'blogGlossaryTerm'}]}],
      validation: (Rule) => Rule.max(3),
    },
  ],
  preview: {
    select: {title: 'term', subtitle: 'definition'},
  },
  orderings: [
    {title: 'Term A-Z', name: 'termAsc', by: [{field: 'term', direction: 'asc'}]},
  ],
}
