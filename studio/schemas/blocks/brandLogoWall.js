export default {
  name: 'brandLogoWall',
  title: 'Brand Logo Wall',
  type: 'object',
  fields: [
    { name: 'active',  title: 'Active',  type: 'boolean', initialValue: true },
    { name: 'order',   title: 'Order',   type: 'number',  initialValue: 60, hidden: true },
    { name: 'heading', title: 'Heading', type: 'string',  initialValue: 'Top brands we carry' },
    {
      name: 'logos', title: 'Brand Logos', type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'brand', title: 'Brand Name', type: 'string' },
          { name: 'emoji', title: 'Emoji (fallback)', type: 'string' },
          { name: 'link',  title: 'Link URL', type: 'string' },
          { name: 'logo',  title: 'Logo Image', type: 'image' },
        ],
        preview: { select: { title: 'brand', media: 'logo' } },
      }],
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active', order: 'order', logos: 'logos' },
    prepare({ title, active, order, logos }) {
      const n = Array.isArray(logos) ? logos.length : 0
      return {
        title: title ?? '(no heading)',
        subtitle: `${n} brand${n !== 1 ? 's' : ''} · ${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
