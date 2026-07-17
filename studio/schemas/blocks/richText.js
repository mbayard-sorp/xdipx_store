import { ImageGeneratorInput } from '../../components/ImageGeneratorInput'

export default {
  name: 'richText',
  title: 'Rich Text',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order', title: 'Order', type: 'number', initialValue: 10, hidden: true },
    {
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [
        {
          type: 'block',
          styles: [
            { title: 'Normal', value: 'normal' },
            { title: 'Heading 2', value: 'h2' },
            { title: 'Heading 3', value: 'h3' },
            { title: 'Heading 4', value: 'h4' },
            { title: 'Quote', value: 'blockquote' },
          ],
          lists: [
            { title: 'Bullet', value: 'bullet' },
            { title: 'Numbered', value: 'number' },
          ],
          marks: {
            decorators: [
              { title: 'Bold', value: 'strong' },
              { title: 'Italic', value: 'em' },
              { title: 'Underline', value: 'underline' },
              { title: 'Strikethrough', value: 'strikethrough' },
              { title: 'Code', value: 'code' },
            ],
            annotations: [
              {
                name: 'link',
                title: 'Link',
                type: 'object',
                fields: [
                  {
                    name: 'href',
                    title: 'URL',
                    type: 'url',
                    // Allow internal relative links; the default url rule gates publish.
                    validation: (Rule) =>
                      Rule.uri({ allowRelative: true, scheme: ['http', 'https', 'mailto', 'tel'] }),
                  },
                  {
                    name: 'blank',
                    title: 'Open in new tab',
                    type: 'boolean',
                    initialValue: false,
                  },
                ],
              },
            ],
          },
        },
        {
          type: 'image',
          options: { hotspot: true },
          components: { input: ImageGeneratorInput },
          fields: [
            { name: 'alt', title: 'Alt text', type: 'string' },
            { name: 'caption', title: 'Caption', type: 'string' },
          ],
        },
      ],
    },
    {
      name: 'bgColor',
      title: 'Background Color',
      type: 'string',
      options: {
        list: [
          { title: 'White', value: 'white' },
          { title: 'Cream', value: 'cream' },
          { title: 'Mist', value: 'mist' },
          { title: 'Charcoal', value: 'charcoal' },
          { title: 'Purple', value: 'purple' },
        ],
        layout: 'radio',
      },
      initialValue: 'white',
    },
    {
      name: 'maxWidth',
      title: 'Max Width',
      type: 'string',
      options: {
        list: [
          { title: 'Narrow (prose)', value: 'narrow' },
          { title: 'Medium', value: 'medium' },
          { title: 'Wide', value: 'wide' },
        ],
      },
      initialValue: 'narrow',
    },
  ],
  preview: {
    select: { active: 'active', order: 'order', body: 'body' },
    prepare({ active, order, body }) {
      const text = (body ?? [])
        .filter((b) => b._type === 'block')
        .map((b) => (b.children ?? []).map((c) => c.text ?? '').join(''))
        .join(' ')
        .slice(0, 80)
      return {
        title: text || '(empty rich text)',
        subtitle: `${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
