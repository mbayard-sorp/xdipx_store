const ICON_LIST = [
  { title: 'Lock (shipping/privacy)',  value: 'lock' },
  { title: 'Shield (security)',        value: 'shield' },
  { title: 'Package (billing/orders)', value: 'package' },
  { title: 'Heart (returns/love)',     value: 'heart' },
  { title: 'Truck (delivery)',         value: 'truck' },
  { title: 'Star (quality)',           value: 'star' },
  { title: 'Leaf (body-safe)',         value: 'leaf' },
  { title: 'Chat (support)',           value: 'chat' },
]

export default {
  name: 'trustItem',
  title: 'Trust Item',
  type: 'document',
  fields: [
    {
      name: 'icon',
      title: 'Icon',
      type: 'string',
      options: { list: ICON_LIST, layout: 'dropdown' },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      description: 'Primary line (e.g. "Discreet Shipping").',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'subheadline',
      title: 'Sub-headline',
      type: 'string',
      description: 'Optional supporting line shown below the headline.',
    },
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      description: 'Uncheck to hide this item everywhere it is linked.',
      initialValue: true,
    },
  ],
  preview: {
    select: { title: 'headline', subtitle: 'subheadline', icon: 'icon', active: 'active' },
    prepare: ({ title, subtitle, icon, active }) => ({
      title: title ?? '(no headline)',
      subtitle: `${icon ?? '?'}${subtitle ? ' · ' + subtitle : ''}${active === false ? ' · Hidden' : ''}`,
    }),
  },
}
