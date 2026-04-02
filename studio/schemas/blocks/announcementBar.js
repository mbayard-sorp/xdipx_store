export default {
  name: 'announcementBar',
  title: 'Announcement Bar',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 0 },
    {
      name: 'bgStyle', title: 'Background', type: 'string',
      options: { list: ['charcoal', 'gradient', 'purple'] },
      initialValue: 'charcoal',
    },
    {
      name: 'rotationIntervalMs', title: 'Rotation Interval (ms)',
      type: 'number', initialValue: 4000,
    },
    {
      name: 'messages', title: 'Messages', type: 'array',
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
  preview: { select: { title: 'messages.0.text' } },
}
