// PDP "Related guides" rail — editor-curated Notebook posts for this product.
// Closes the internal-linking loop for AEO: guides embed products, this is the
// reverse product -> guide link. Added to productPage.contentBlocks as an
// optional block. When no block is placed (or it has no published picks) the
// PDP route falls back to the latest guides sharing the product type, so every
// product still links out to editorial. Renders through the shared
// ContentBlockRenderer -> NotebookRail.
export default {
  name: 'relatedGuides',
  title: 'Related Guides',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 10, hidden: true },
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description: 'Section title shown above the guide cards.',
      initialValue: 'Related guides',
    },
    {
      name: 'guides',
      title: 'Guides',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'blogPost' }] }],
      description:
        'Notebook posts to feature on this product page. Leave the whole block off to fall back to the latest guides for this product type. Unpublished picks are skipped on the storefront.',
      validation: Rule => Rule.required().min(1).max(6),
    },
  ],
  preview: {
    select: { heading: 'heading', guides: 'guides' },
    prepare: ({ heading, guides }) => {
      const count = Array.isArray(guides) ? guides.length : 0
      return {
        title: heading || 'Related guides',
        subtitle: `${count} guide${count === 1 ? '' : 's'}`,
      }
    },
  },
}
