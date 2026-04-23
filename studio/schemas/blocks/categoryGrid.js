export default {
  name: 'categoryGrid',
  title: 'Category Grid',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 30, hidden: true },
    { name: 'heading', title: 'Heading', type: 'string',  initialValue: 'Shop by Category' },
    {
      name: 'columns', title: 'Columns', type: 'number',
      options: { list: [3, 4, 6] }, initialValue: 4,
    },
    {
      name: 'items', title: 'Category Items', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'label', title: 'Label',    type: 'string' },
          { name: 'link',  title: 'Link URL', type: 'string' },
          { name: 'emoji', title: 'Emoji (fallback)', type: 'string' },
          { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
        ],
        preview: { select: { title: 'label', media: 'image' } },
      }],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order', items: 'items' },
    prepare({ title, active, order, items }) {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} categor${n !== 1 ? 'ies' : 'y'} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
