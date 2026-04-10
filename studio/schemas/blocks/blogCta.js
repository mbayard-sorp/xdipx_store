export default {
  name: 'blogCta',
  title: 'Call to Action',
  type: 'object',

  fields: [
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
    },
    {
      name: 'body',
      title: 'Body',
      type: 'text',
      rows: 3,
    },
    {
      name: 'ctaLabel',
      title: 'Button Label',
      type: 'string',
    },
    {
      name: 'ctaLink',
      title: 'Button Link',
      type: 'string',
      description: 'URL or path (e.g. "/vault" or "https://...")',
    },
    {
      name: 'bgStyle',
      title: 'Background Style',
      type: 'string',
      options: {
        list: [
          { title: 'Charcoal', value: 'charcoal' },
          { title: 'Gradient',  value: 'gradient' },
          { title: 'Mist',      value: 'mist' },
          { title: 'Purple',    value: 'purple' },
          { title: 'Cream',     value: 'cream' },
        ],
        layout: 'radio',
      },
      initialValue: 'gradient',
    },
  ],

  preview: {
    select: { title: 'heading', subtitle: 'ctaLabel' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'CTA Block',
      subtitle: subtitle ? `Button: ${subtitle}` : '',
    }),
  },
}
