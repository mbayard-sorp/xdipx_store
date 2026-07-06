// Merch components v1 — 1k PLP merch header. New additive block.
// Masthead + up to 5 curated emmaPreset pills with a narrator line. Can live
// on a collectionPage document (see additive `merchHeader` field added to
// studio/schemas/collectionPage.js) or stand alone between homepage rails.
export default {
  name: 'plpMerchHeader',
  title: 'PLP Merch Header',
  type: 'object',
  fields: [
    { name: 'active', title: 'Active', type: 'boolean', initialValue: true },
    { name: 'order',  title: 'Order',  type: 'number',  initialValue: 6, hidden: true },

    {
      name: 'mastheadKicker',
      title: 'Masthead kicker',
      type: 'string',
      description: 'e.g. "Beginners · curated weekly".',
    },
    {
      name: 'themeLine',
      title: 'Theme line',
      type: 'string',
      description: 'Masthead headline, e.g. "Gentle starts, nothing intimidating." Font steps 30→26→24 before wrapping to 2 lines.',
    },
    {
      name: 'emphasisWord',
      title: 'Emphasis word',
      type: 'string',
      description: 'The single word in the theme line rendered italic plum via <em class="em">.',
    },

    {
      name: 'presets',
      title: "Emma's presets (max 5)",
      type: 'array',
      description: 'Curated preset pills. Presets with zero matching products should not be published — validated at publish time, not render time.',
      of: [{ type: 'reference', to: [{ type: 'emmaPreset' }] }],
      validation: (Rule) => Rule.max(5),
    },
  ],
  preview: {
    select: { title: 'themeLine', kicker: 'mastheadKicker', active: 'active' },
    prepare({ title, kicker, active }) {
      return {
        title: title ?? '(no theme line)',
        subtitle: `${kicker ?? ''} · ${active === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
