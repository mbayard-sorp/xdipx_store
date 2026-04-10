export default {
  name: 'blogVideoEmbed',
  title: 'Video Embed',
  type: 'object',

  fields: [
    {
      name: 'url',
      title: 'Video URL',
      type: 'url',
      description: 'YouTube or Vimeo URL',
      validation: Rule => Rule.required(),
    },
    {
      name: 'caption',
      title: 'Caption',
      type: 'string',
    },
  ],

  preview: {
    select: { title: 'url', subtitle: 'caption' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Video',
      subtitle: subtitle || '',
    }),
  },
}
