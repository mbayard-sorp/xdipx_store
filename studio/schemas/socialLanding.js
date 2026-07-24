// Social bio-link landing (additive). Powers the swappable product module on
// /social, the single link-in-bio destination for IG/TikTok/YT. Singleton
// `singleton.socialLanding`; the /social loader resolves featuredProductHandle
// against the discovery index, falling back to the storefront hero pin
// (singleton.emmaHeroStorefront.featuredProductHandle), then to no module.
// Existing schemas untouched per the additive-only rule.
export default {
  name: 'socialLanding',
  title: 'Social landing (/social)',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton, no create/delete
  fields: [
    {
      name: 'heading',
      title: 'Product module heading',
      type: 'string',
      description:
        'Short Emma-voice heading above the featured product card. Unset falls back to the built-in default.',
    },
    {
      name: 'emmaBlurb',
      title: 'Emma blurb',
      type: 'text',
      rows: 3,
      description:
        'One or two Emma-voice sentences under the featured product. Catalog knowledge only, no lived experience, no em-dashes, no urgency.',
    },
    {
      name: 'featuredProductHandle',
      title: 'Featured product handle',
      type: 'string',
      description:
        'Shopify product handle (no /products/ prefix). Swap this whenever a video points at a new product. Unset falls back to the storefront hero pin, then hides the module.',
      validation: Rule =>
        Rule.custom(value => {
          if (value == null || value === '') return true
          return /^[a-z0-9][a-z0-9-]*$/.test(value)
            ? true
            : 'Must be a bare product handle, lowercase letters, digits, and hyphens only (no slashes or spaces)'
        }),
    },
  ],
  preview: {
    select: { heading: 'heading', handle: 'featuredProductHandle' },
    prepare: ({ heading, handle }) => ({
      title: 'Social landing (/social)',
      subtitle: handle ? `featuring: ${handle}` : 'no product pinned (hero-pin fallback)',
    }),
  },
}
