export default {
  name: 'playTogetherBanner',
  title: 'Play Together Banner',
  type: 'object',
  fields: [
    { name: 'active',        title: 'Active',        type: 'boolean', initialValue: true },
    { name: 'order',         title: 'Order',         type: 'number',  initialValue: 50 },
    { name: 'heading',       title: 'Heading',       type: 'string' },
    { name: 'body',          title: 'Body',          type: 'text' },
    { name: 'ctaLabel',      title: 'CTA Label',     type: 'string' },
    { name: 'ctaLink',       title: 'CTA Link',      type: 'string' },
    {
      name: 'imagePosition', title: 'Image Position', type: 'string',
      options: { list: ['left', 'right'] }, initialValue: 'right',
    },
    { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
  ],
  preview: { select: { title: 'heading', media: 'image' } },
}
