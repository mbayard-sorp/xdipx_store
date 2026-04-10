export default {
  name: 'blogPullQuote',
  title: 'Pull Quote',
  type: 'object',

  fields: [
    {
      name: 'quote',
      title: 'Quote',
      type: 'text',
      rows: 3,
      validation: Rule => Rule.required(),
    },
    {
      name: 'attribution',
      title: 'Attribution',
      type: 'string',
      description: 'Who said it (optional)',
    },
    {
      name: 'style',
      title: 'Style',
      type: 'string',
      options: {
        list: [
          { title: 'Default', value: 'default' },
          { title: 'Accent',  value: 'accent' },
          { title: 'Large',   value: 'large' },
        ],
        layout: 'radio',
      },
      initialValue: 'default',
    },
  ],

  preview: {
    select: { title: 'quote', subtitle: 'attribution' },
    prepare: ({ title, subtitle }) => ({
      title: (title || '').slice(0, 80) + ((title || '').length > 80 ? '...' : ''),
      subtitle: subtitle ? `— ${subtitle}` : '',
    }),
  },
}
