export default {
  name: 'productCarousel',
  title: 'Product Carousel',
  type: 'object',
  fields: [
    { name: 'active',       title: 'Active',       type: 'boolean', initialValue: true },
    { name: 'order',        title: 'Order',        type: 'number',  initialValue: 40 },
    { name: 'heading',      title: 'Heading',      type: 'string' },
    { name: 'eyebrow',      title: 'Eyebrow',      type: 'string' },
    { name: 'shopifyTag',   title: 'Shopify Tag',  type: 'string',
      description: 'Shopify product tag to query (e.g. "for-him", "new-arrivals")' },
    { name: 'productLimit', title: 'Max Products', type: 'number', initialValue: 8 },
    { name: 'ctaLink',      title: 'CTA Link',     type: 'string' },
    { name: 'ctaLabel',     title: 'CTA Label',    type: 'string', initialValue: 'See all →' },
    {
      name: 'bgStyle', title: 'Background', type: 'string',
      options: { list: ['white', 'mist', 'cream'] }, initialValue: 'white',
    },
  ],
  preview: { select: { title: 'heading', subtitle: 'shopifyTag' } },
}
