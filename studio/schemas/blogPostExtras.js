// Notebook redesign — per-post editorial extras (additive; blogPost untouched).
// Joined by reference at query time. Every field is optional and the daily
// content-writer never needs to create one of these docs.
export default {
  name: 'blogPostExtras',
  title: 'Blog Post Extras',
  type: 'document',
  fields: [
    {
      name: 'post',
      title: 'Post',
      type: 'reference',
      to: [{type: 'blogPost'}],
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'deck',
      title: 'Deck (standfirst)',
      type: 'text',
      rows: 2,
      description: 'Editorial standfirst shown under the title, replacing the excerpt on the post page when set.',
    },
    {
      name: 'sources',
      title: 'Sources',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {name: 'label', title: 'Label', type: 'string', validation: (Rule) => Rule.required()},
            {name: 'url', title: 'URL', type: 'url'},
          ],
          preview: {select: {title: 'label', subtitle: 'url'}},
        },
      ],
      description: 'Reference list rendered in a "Sources" footer on the post.',
    },
    {
      name: 'reviewedNote',
      title: 'Reviewed note',
      type: 'string',
      description: 'Optional trust line, e.g. fact-check or review provenance. No medical claims.',
    },
    {
      name: 'series',
      title: 'Series',
      type: 'reference',
      to: [{type: 'blogSeries'}],
      description: 'Series this post belongs to (shows the "continue the series" card).',
    },
    {
      name: 'seriesOrder',
      title: 'Series order',
      type: 'number',
      description: 'Tiebreaker when the series posts[] array is not set.',
    },
  ],
  preview: {
    select: {title: 'post.title'},
    prepare: ({title}) => ({title: title ? `Extras — ${title}` : 'Post extras'}),
  },
}
