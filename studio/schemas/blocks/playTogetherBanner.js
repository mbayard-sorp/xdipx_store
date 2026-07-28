import { bgStyleField } from '../../lib/bgStyleField'
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'playTogetherBanner',
  title: 'Play Together Banner',
  type: 'object',
  fields: [
    { name: 'active',        title: 'Active',        type: 'boolean', initialValue: true },
    { name: 'order',         title: 'Order',         type: 'number',  initialValue: 50, hidden: true },
    { name: 'heading',       title: 'Heading',       type: 'string' },
    { name: 'body',          title: 'Body',          type: 'text' },
    { name: 'ctaLabel',      title: 'CTA Label',     type: 'string' },
    { name: 'ctaLink',       title: 'CTA Link',      type: 'string' },
    // Couples rail (additive). The storefront's Nº 08 band renders a "chosen for
    // sharing" product strip under the banner when handles are published here,
    // and hides the strip entirely when the array is empty. Same productRef
    // shape as emmaCuratedRail; bare strings are tolerated too (see
    // app/lib/product-handles.ts).
    {
      name: 'productHandles',
      title: 'Couples Rail Product Handles',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'productRef',
          fields: [
            {
              name: 'handle',
              title: 'Product Handle',
              type: 'string',
              description: 'Shopify product handle (the URL slug), no /products/ prefix.',
            },
          ],
          preview: {
            select: { title: 'handle' },
            prepare({ title }) {
              return { title: title ?? '(empty)' }
            },
          },
        },
      ],
      description:
        'Optional. Products shown in the "A few more, chosen for sharing" strip below the banner. Leave empty to render the banner alone.',
    },
    bgStyleField({ initialValue: 'cream' }),
    {
      name: 'imagePosition', title: 'Image Position', type: 'string',
      options: { list: ['left', 'right'] }, initialValue: 'right',
    },
    // AI image generation — replaces the plain image field
    ...withImageGenerator('image'),
  ],
  preview: {
    select: { title: 'heading', media: 'image', active: 'active', order: 'order' },
    prepare({ title, media, active, order }) {
      return {
        title: title ?? '(no heading)',
        subtitle: `${active ? 'Visible' : 'Hidden'}`,
        media,
      }
    },
  },
}
