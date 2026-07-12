import {withImageGenerator} from '../lib/withImageGenerator'

// Notebook redesign — per-category presentation extras (additive; blogCategory
// untouched). One doc per category; archive pages fall back to a plain header
// when no extras doc exists.
export default {
  name: 'blogCategoryExtras',
  title: 'Blog Category Extras',
  type: 'document',
  fields: [
    {
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{type: 'blogCategory'}],
      validation: (Rule) => Rule.required(),
    },
    ...withImageGenerator('headerImage'),
    {
      name: 'headerImageAlt',
      title: 'Header image alt text',
      type: 'string',
    },
    {
      name: 'intro',
      title: 'Intro',
      type: 'text',
      rows: 3,
      description: 'Short editorial intro shown under the category name.',
    },
    {
      name: 'accent',
      title: 'Accent override',
      type: 'string',
      description: 'Overrides the code-side category accent map when set.',
      options: {
        list: [
          {title: 'Coral', value: 'coral'},
          {title: 'Plum', value: 'plum'},
          {title: 'Sage', value: 'sage'},
          {title: 'Ink', value: 'ink'},
        ],
        layout: 'radio',
      },
    },
  ],
  preview: {
    select: {title: 'category.name'},
    prepare: ({title}) => ({title: title ? `Extras — ${title}` : 'Category extras'}),
  },
}
