// Curiosity Shelf singleton (Nº 07) — the daily-editable slate for the homepage
// discovery band that replaces the Sensation Map.
//
// ADDITIVE and non-destructive, exactly like `storefrontHome`: when no
// curiosityShelf doc is published (or `enabled` is false) the storefront renders
// its code-side `DEFAULT_SHELF_CONTENT`, byte for byte. That fallback is both the
// feature flag and the rollback. The Routine A daily merchandiser rewrites this
// via `scripts/sanity-content-cli.ts` (never the Sanity MCP), and lane labels /
// Emma lines are voice-gated copy.
export default {
  name: 'curiosityShelf',
  title: 'Curiosity shelf',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'note',
      title: 'Note',
      type: 'string',
      description: 'Internal: what this slate is for. Shows in the Studio preview.',
      validation: (Rule) => Rule.max(160),
    },
    {
      name: 'enabled',
      title: 'Enabled',
      type: 'boolean',
      description: 'Kill switch back to the code defaults without unpublishing.',
      initialValue: true,
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      description: 'Mono kicker. Default "TONIGHT\'S CURIOSITIES".',
      validation: (Rule) => Rule.max(28),
    },
    {
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description: 'Default "What are you curious about?"',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'emphasis',
      title: 'Emphasis word',
      type: 'string',
      description:
        'The one plum italic word. Must be a substring of the heading (exactly one emphasis word, never two).',
      validation: (Rule) =>
        Rule.max(20).custom((emphasis, context) => {
          if (!emphasis) return true
          const heading = context?.document?.heading
          if (typeof heading === 'string' && !heading.includes(emphasis)) {
            return 'The emphasis word must appear in the heading.'
          }
          return true
        }),
    },
    {
      name: 'emmaLine',
      title: "Emma's band line",
      type: 'text',
      rows: 2,
      description: 'The sub-line under the heading. Emma voice, no em-dashes.',
      validation: (Rule) => Rule.max(140),
    },
    {
      name: 'lanes',
      title: 'Lanes',
      type: 'array',
      of: [{ type: 'curiosityLane' }],
      description: 'Fewer, clearer choices. Min 3, max 5 (6 wraps to three lines at 375px).',
      validation: (Rule) => Rule.min(3).max(5),
    },
    {
      name: 'updatedAt',
      title: 'Updated at',
      type: 'datetime',
      readOnly: true,
      description: 'Provenance for the daily diff.',
    },
  ],
  preview: {
    select: { note: 'note', enabled: 'enabled', lanes: 'lanes' },
    prepare: ({ note, enabled, lanes }) => {
      const n = Array.isArray(lanes) ? lanes.length : 0
      return {
        title: 'Curiosity shelf',
        subtitle: `${n} lane${n === 1 ? '' : 's'}${enabled === false ? ' · disabled (code default)' : ''}${note ? ` · ${note}` : ''}`,
      }
    },
  },
}
