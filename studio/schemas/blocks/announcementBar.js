export default {
  name: 'announcementBar',
  title: 'Announcement Bar',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true,
      description: 'Uncheck to hide this section without deleting it.' },
    { name: 'order',  title: 'Display Order', type: 'number', initialValue: 0, hidden: true,
      description: 'Deprecated — drag to reorder in the Homepage Sections array.' },
    {
      name: 'bgStyle', title: 'Background Color', type: 'string',
      options: { list: ['charcoal', 'gradient', 'purple'] },
      initialValue: 'charcoal',
      description: 'charcoal = dark bar, gradient = coral→orange, purple = brand purple.',
    },
    {
      name: 'rotationIntervalMs', title: 'Rotation Speed',
      type: 'number', initialValue: 4000,
      description: 'Time between messages in milliseconds (4000 = 4 seconds).',
    },
    {
      name: 'messages', title: 'Messages', type: 'array',
      description: 'Each message rotates in the bar. Add a Link URL + Label to make it clickable.',
      of: [{
        type: 'object',
        fields: [
          { name: 'text',      title: 'Text',      type: 'string' },
          { name: 'link',      title: 'Link URL',  type: 'string' },
          { name: 'linkLabel', title: 'Link Label', type: 'string' },
        ],
      }],
    },
  ],
  preview: {
    select: { title: 'messages.0.text', active: 'active', order: 'order' },
    prepare({ title, active, order }) {
      return {
        title: title ?? '(no messages)',
        subtitle: `${active ? 'Visible' : 'Hidden'}`,
      }
    },
  },
}
