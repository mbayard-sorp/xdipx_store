import { anchorIdField } from './anchorId'

// Two or three Notebook articles between the shelves. No products: this block
// exists to let a reader step sideways into learning without leaving the aisle.
export default {
  name: 'learnStrip',
  title: 'Learn strip',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      initialValue: 'Worth reading first',
      validation: (Rule) => Rule.max(48),
    },
    {
      name: 'posts',
      title: 'Notebook posts',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'blogPost' }] }],
      description: 'Two or three. Unpublished posts are dropped at render.',
      validation: (Rule) => Rule.required().min(2).max(3),
    },
  ],
  preview: {
    select: { title: 'heading', posts: 'posts' },
    prepare: ({ title, posts }) => {
      const n = Array.isArray(posts) ? posts.length : 0
      return { title: title || 'Learn strip', subtitle: `${n} post${n === 1 ? '' : 's'}` }
    },
  },
}
