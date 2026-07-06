// Merch components v1 — 1f "Or" fork. New additive block.
// Two products, one plain question, each side is a whole-element link to its
// PDP. If only one side resolves, the component should not render at all —
// a half fork is worse than none (component-side logic, not schema).
function forkSideField(name, title) {
  return {
    name,
    title,
    type: 'object',
    fields: [
      {
        name: 'productHandle',
        title: 'Product Handle',
        type: 'string',
        description: 'Shopify product handle (the URL slug).',
      },
      {
        name: 'answerLine',
        title: 'Answer line',
        type: 'string',
        description: 'Short answer to the question, e.g. "Deep. Slow. Felt everywhere."',
      },
    ],
    preview: {
      select: { title: 'productHandle', subtitle: 'answerLine' },
      prepare({ title, subtitle }) {
        return { title: title ?? '(empty)', subtitle }
      },
    },
  }
}

export default {
  name: 'orFork',
  title: '"Or" Fork',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 18, hidden: true },

    { name: 'question', title: 'Question', type: 'string', description: 'e.g. "Rumbly or buzzy?"' },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the question rendered italic plum via <em class="em">.',
    },

    forkSideField('sideA', 'Side A'),
    forkSideField('sideB', 'Side B'),
  ],
  preview: {
    select: { title: 'question', active: 'active' },
    prepare({ title, active }) {
      return {
        title: title ?? '(no question)',
        subtitle: `${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
