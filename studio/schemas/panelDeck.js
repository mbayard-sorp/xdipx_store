// Panel deck singleton — the doors below the storefront headliner.
//
// Additive: nothing existing is modified. The deck is placed on the page by the
// `storefrontHome` layout singleton, so publishing this document alone changes
// nothing until the layout enables its section. That two-step is the flip and
// the rollback both.
//
// Rows are an unbounded ordered array, so how many rows of each kind there are
// and which panels sit where is editorial and needs no deploy: rows stack down
// the page in the order listed. What is NOT editable here is the deck's
// position relative to the rest
// of the page shell: moving the headliner would move the LCP element and break
// the zero-CLS contract, so macro section order stays a reviewed-PR decision
// (docs/homepage-team/routine-design-cycle.md IA fence).
export default {
  name: 'panelDeck',
  title: 'Panel Deck',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      initialValue: 'Eight doors in',
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'theme',
      title: 'Theme',
      type: 'string',
      initialValue: 'tint',
      description:
        'Tinted fields is the shipped default. Panels carry product cutout stills on the tint; photographic is for the large panels.',
      options: {
        list: [
          { title: 'Tinted fields', value: 'tint' },
          { title: 'Photographic', value: 'photo' },
          { title: 'Ruled index', value: 'ruled' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'showOrdinals',
      title: 'Number the panels',
      type: 'boolean',
      initialValue: false,
      description: 'Ruled theme only. Numbers the square panels 01, 02, 03… in row order.',
      hidden: ({ parent }) => parent?.theme !== 'ruled',
    },
    {
      name: 'rows',
      title: 'Rows',
      type: 'array',
      of: [{ type: 'panelSquareRow' }, { type: 'panelRowLarge' }, { type: 'panelRowSmall' }],
      description:
        'Default order is squares, then large, then small. Any order renders, and any number of rows of each kind: they stack down the page in the order listed here.',
      validation: (Rule) => Rule.required().min(1),
    },
  ],
  preview: {
    select: { theme: 'theme', rows: 'rows' },
    prepare: ({ theme, rows }) => {
      const n = Array.isArray(rows) ? rows.length : 0
      return {
        title: 'Panel deck',
        subtitle: `${theme || 'tint'} · ${n} row${n === 1 ? '' : 's'}`,
      }
    },
  },
}
