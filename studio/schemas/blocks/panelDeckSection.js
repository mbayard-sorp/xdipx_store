// Placement marker for the panel deck.
//
// The deck's content lives in the `panelDeck` singleton; this entry only says
// where it sits in the page order and whether it renders. Splitting placement
// from content is what makes the launch a two-step: publish the deck (nothing
// changes), then enable this section (deck goes live). Disabling it is the
// rollback and needs no deploy.
export default {
  name: 'panelDeckSection',
  title: 'Panel deck',
  type: 'object',
  fields: [
    {
      name: 'enabled',
      title: 'Visible',
      type: 'boolean',
      initialValue: false,
      description: 'Off until the deck singleton is filled in and reviewed.',
    },
  ],
  preview: {
    select: { enabled: 'enabled' },
    prepare: ({ enabled }) => ({
      title: 'Panel deck (eight doors)',
      subtitle: enabled ? 'Visible' : 'Hidden',
    }),
  },
}
