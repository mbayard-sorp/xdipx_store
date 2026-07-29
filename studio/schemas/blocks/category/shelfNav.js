import { anchorIdField } from './anchorId'

// Sticky subcategory nav. Tiles are derived from the Shopify menu at render
// time (children of this category's top-level item, with live product counts),
// so renaming a menu item never needs a Sanity edit. The editor only chooses
// whether the block appears and how it is introduced.
export default {
  name: 'shelfNav',
  title: 'Shelf nav',
  type: 'object',
  fields: [
    anchorIdField({ initialValue: 'shelves' }),
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      initialValue: 'Jump to',
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'sticky',
      title: 'Sticky on scroll',
      type: 'boolean',
      initialValue: true,
    },
    {
      name: 'showCounts',
      title: 'Show product counts',
      type: 'boolean',
      initialValue: true,
      description: 'Counts come from Shopify. A shelf with zero products is dropped either way.',
    },
  ],
  preview: {
    prepare: () => ({ title: 'Shelf nav', subtitle: 'Tiles from the Shopify menu' }),
  },
}
