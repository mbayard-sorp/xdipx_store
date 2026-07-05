// Hero deep-linking (additive). Carries the `primaryCtaLabel` / `primaryCtaLink`
// fields from the `emmaHeroStorefront` spec in docs/homepage-team/new-blocks.md.
// The existing `emmaHeroSettings` schema is frozen (additive-only rule), so these
// fields live in their own singleton, `singleton.emmaHeroStorefront`, and the
// loader merges them into the emmaHero payload. Future fields from that spec
// (featuredProductHandle, moodPills, bgStyle, ...) should land here too.
export default {
  name: 'emmaHeroStorefront',
  title: 'Storefront hero CTA',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton, no create/delete
  fields: [
    {
      name: 'primaryCtaLabel',
      title: 'Primary CTA label',
      type: 'string',
      description:
        'Whitelist CTAs only. Anything else (or unset) falls back to "Take a peek →" at render time.',
      options: {
        list: [
          'Take a peek →',
          'Show me',
          'Find your fit →',
          "I'll take it ♥",
        ],
      },
    },
    {
      name: 'primaryCtaLink',
      title: 'Primary CTA link',
      type: 'string',
      description:
        'Internal path only, usually /products/{handle}. Leave unset to keep the default behavior (hero links to the lead discovery product).',
    },
  ],
  preview: {
    select: { label: 'primaryCtaLabel', link: 'primaryCtaLink' },
    prepare: ({ label, link }) => ({
      title: 'Storefront hero CTA',
      subtitle: link ? `${label ?? 'Take a peek →'} · ${link}` : 'unset (discovery default)',
    }),
  },
}
