// Merch components v1 — 1i Email capture band ("Emma's list"). New additive
// block. The Klaviyo POST is handled by the existing EmailSubscribe action in
// the component; this schema only models the copy slots.
export default {
  name: 'emailCaptureBand',
  title: 'Email Capture Band',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 65, hidden: true },

    { name: 'eyebrow', title: 'Eyebrow', type: 'string', initialValue: "Emma's list" },
    { name: 'heading', title: 'Heading', type: 'string', description: 'e.g. "A quiet note when something good arrives."' },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the heading rendered italic plum via <em class="em">.',
    },
    {
      name: 'subcopy',
      title: 'Subcopy',
      type: 'text',
      rows: 2,
      description: 'e.g. "Now and then, not weekly. Plain subject lines your lock screen can show anyone."',
    },
    {
      name: 'buttonLabel',
      title: 'Button label',
      type: 'string',
      options: { list: ['Show me', 'Take a peek →', 'Find your fit →', "I'll take it ♥"] },
      initialValue: 'Show me',
    },
    {
      name: 'finePrint',
      title: 'Fine print',
      type: 'string',
      description: 'e.g. "Unsubscribe anytime. Your inbox stays as discreet as your doorstep."',
    },
  ],
  preview: {
    select: { title: 'heading', active: 'active' },
    prepare({ title, active }) {
      return {
        title: title ?? '(no heading)',
        subtitle: `${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
