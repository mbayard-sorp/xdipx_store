// Hero deep-linking (additive). Carries the `primaryCtaLabel` / `primaryCtaLink`
// fields from the `emmaHeroStorefront` spec in docs/homepage-team/new-blocks.md.
// The existing `emmaHeroSettings` schema is frozen (additive-only rule), so these
// fields live in their own singleton, `singleton.emmaHeroStorefront`, and the
// loader merges them into the emmaHero payload. Future fields from that spec
// (moodPills, bgStyle, ...) should land here too. featuredProductHandle landed
// with the pinnable headliner (pins the hero image + peek link to one product).
export default {
  name: 'emmaHeroStorefront',
  title: 'Storefront hero CTA',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton, no create/delete
  fields: [
    {
      name: 'emphasisWord',
      title: 'Headline emphasis word',
      type: 'string',
      description:
        'One word from the hero headline to italicize in the plum emphasis style (doctrine §2). Must appear verbatim in the headline. Leave unset to italicize the last word by default.',
    },
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
    {
      name: 'secondaryCtaLabel',
      title: 'Secondary CTA label',
      type: 'string',
      description:
        'Whitelist CTAs only. The storefront rejects a label that duplicates the primary CTA or the Meet Emma band ("Find your fit →"), because two identical labels on one page read as one broken CTA. A rejected or unset label falls back to whichever whitelist phrase the primary is not using.',
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
      name: 'secondaryCtaLink',
      title: 'Secondary CTA link',
      type: 'string',
      description:
        'Internal path only. Leave unset for /collections/best-sellers. Point this at a merchandised collection, never the raw /collections index, which is 170 unsorted tiles and the worst landing for a first-time visitor.',
    },
    {
      name: 'featuredProductHandle',
      title: 'Featured product handle (pins the hero image)',
      type: 'string',
      description:
        'Shopify product handle (no /products/ prefix). When set, the storefront hero image and peek link are pinned to this product instead of rotating with the discovery shuffle. Leave unset to keep the rotating behavior. Set this to the same product the hero copy targets.',
      validation: Rule =>
        Rule.custom(value => {
          if (value == null || value === '') return true
          return /^[a-z0-9][a-z0-9-]*$/.test(value)
            ? true
            : 'Must be a bare product handle, lowercase letters, digits, and hyphens only (no slashes or spaces)'
        }),
    },
    {
      name: 'anchorCollectionHandle',
      title: 'Anchor grid collection (the Nº 03 product wall)',
      type: 'string',
      description:
        'Shopify COLLECTION handle (no /collections/ prefix) that fills the promoted Nº 03 product wall. The band shows this collection in its curated (manual) order, so merchandising controls which products lead the page instead of the raw discovery ranking. Leave unset to use the default best-sellers collection. Falls back to the discovery best-of only when the collection is empty or unreachable.',
      validation: Rule =>
        Rule.custom(value => {
          if (value == null || value === '') return true
          return /^[a-z0-9][a-z0-9-]*$/.test(value)
            ? true
            : 'Must be a bare collection handle, lowercase letters, digits, and hyphens only (no slashes or spaces)'
        }),
    },
  ],
  preview: {
    select: { label: 'primaryCtaLabel', link: 'primaryCtaLink', pinned: 'featuredProductHandle' },
    prepare: ({ label, link, pinned }) => ({
      title: 'Storefront hero CTA',
      subtitle: [
        link ? `${label ?? 'Take a peek →'} · ${link}` : 'CTA unset (discovery default)',
        pinned ? `pinned: ${pinned}` : 'image: rotating',
      ].join(' · '),
    }),
  },
}
