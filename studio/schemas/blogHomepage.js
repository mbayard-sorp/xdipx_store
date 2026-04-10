import {withImageGenerator} from '../lib/withImageGenerator'

export default {
  name: 'blogHomepage',
  title: 'Blog Homepage',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description: 'Main heading at the top of the blog index (e.g. "The xdipx Blog")',
    },
    {
      name: 'subtext',
      title: 'Subtext',
      type: 'text',
      rows: 2,
      description: 'Short description below the heading',
    },
    ...withImageGenerator('heroImage'),
    {
      name: 'heroImageAlt',
      title: 'Hero image alt text',
      type: 'string',
    },
  ],
  preview: {prepare: () => ({title: 'Blog Homepage'})},
}
