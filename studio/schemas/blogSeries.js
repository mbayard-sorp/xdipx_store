import {withImageGenerator} from '../lib/withImageGenerator'

// Notebook redesign — editorial series / named franchises (additive).
// Posts join a series through blogPostExtras.series; this doc's posts[] array
// is the ordering source of truth for the series landing page.
export default {
  name: 'blogSeries',
  title: 'Blog Series',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {source: 'title', maxLength: 96},
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'kicker',
      title: 'Franchise kicker',
      type: 'string',
      description: 'Short franchise label shown above the series title (e.g. the recurring column name).',
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
    },
    ...withImageGenerator('coverImage'),
    {
      name: 'coverImageAlt',
      title: 'Cover image alt text',
      type: 'string',
    },
    {
      name: 'posts',
      title: 'Posts (in order)',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'blogPost'}]}],
      description: 'Ordered list of posts in this series. Order here is the "Part N" order.',
    },
  ],
  preview: {
    select: {title: 'title', subtitle: 'slug.current'},
    prepare: ({title, subtitle}) => ({
      title: title || 'Untitled series',
      subtitle: subtitle ? `/notebook/series/${subtitle}` : 'No slug set',
    }),
  },
}
