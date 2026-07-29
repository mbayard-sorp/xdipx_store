// Storefront homepage layout singleton.
//
// This is the answer to "I want all of the content blocks available in Sanity
// to edit". Until now the storefront's band order and most of its chrome copy
// lived in JSX, so changing a heading or hiding a band meant a deploy.
//
// ADDITIVE and non-destructive by design: merchandised CONTENT keeps living in
// singleton.homepage exactly as it does today, and this document only owns the
// ordering and the per-band overrides. When no storefrontHome doc is published
// the storefront renders its shipped order, byte for byte. That fallback is
// both the feature flag and the rollback.
//
// What is NOT editable here, deliberately: the headliner stays the first band.
// It carries the H1 and the LCP image, and moving it would move the largest
// paint element and break the zero-CLS contract the homepage is gated on. Order
// changes that move the headliner are a reviewed-PR decision, not a content
// edit (docs/homepage-team/routine-design-cycle.md IA fence).
export default {
  name: 'storefrontHome',
  title: 'Storefront home layout',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'note',
      title: 'Note',
      type: 'string',
      description: 'Internal reminder of what this arrangement is for.',
      validation: (Rule) => Rule.max(160),
    },
    {
      name: 'sections',
      title: 'Sections',
      type: 'array',
      description:
        'Ordered top to bottom. The headliner must stay first. Leave this empty to render the shipped default order.',
      of: [{ type: 'homeBand' }, { type: 'homeMoodPills' }, { type: 'panelDeckSection' }],
      validation: (Rule) =>
        Rule.custom((sections) => {
          if (!Array.isArray(sections) || sections.length === 0) return true
          const first = sections[0]
          if (first?._type !== 'homeBand' || first?.band !== 'hero') {
            return 'The headliner band must be first: it carries the H1 and the LCP image.'
          }
          const bands = sections
            .filter((s) => s?._type === 'homeBand')
            .map((s) => s?.band)
            .filter(Boolean)
          const dupes = bands.filter((b, i) => bands.indexOf(b) !== i)
          if (dupes.length) return `Each band may appear once. Repeated: ${dupes.join(', ')}`
          const decks = sections.filter((s) => s?._type === 'panelDeckSection').length
          if (decks > 1) return 'Only one panel deck section'
          return true
        }),
    },
  ],
  preview: {
    select: { note: 'note', sections: 'sections' },
    prepare: ({ note, sections }) => {
      const n = Array.isArray(sections) ? sections.length : 0
      return {
        title: 'Storefront home layout',
        subtitle: n === 0 ? 'Default order (nothing overridden)' : `${n} section${n === 1 ? '' : 's'}${note ? ` · ${note}` : ''}`,
      }
    },
  },
}
