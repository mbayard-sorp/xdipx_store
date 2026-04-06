export default {
  name: 'editorialTiles',
  title: 'Editorial Tiles',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 20 },
    { name: 'eyebrow', title: 'Eyebrow', type: 'string' },
    { name: 'heading', title: 'Heading', type: 'string' },
    {
      name: 'tiles', title: 'Tiles', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'label',     title: 'Label',     type: 'string' },
          { name: 'body',      title: 'Body',      type: 'text' },
          { name: 'link',      title: 'Link URL',  type: 'string' },
          { name: 'linkLabel', title: 'Link Label', type: 'string' },
          { name: 'emoji',     title: 'Emoji (fallback)', type: 'string' },
          { name: 'image',     title: 'Image', type: 'image', options: { hotspot: true } },
        ],
        preview: { select: { title: 'label', media: 'image' } },
      }],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order', count: 'tiles' },
    prepare({ title, active, order, count }) {
      const n = Array.isArray(count) ? count.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} tile${n !== 1 ? 's' : ''} · Order ${order ?? 0} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
