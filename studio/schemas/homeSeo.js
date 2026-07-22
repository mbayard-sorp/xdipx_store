// Home SEO singleton — the homepage's search-result title + description.
// Additive; does not touch homeConfig or any existing schema file.
//
// Singleton _id: singleton.homeSeo
// This is the "update strategy" surface: the strategy / merchandising team
// rotates the Google/Bing SERP snippet here (e.g. tie the title to the active
// marketing-calendar theme) without a code deploy. Leave a field blank to fall
// back to the hardcoded brand defaults in app/lib/brand.ts.
//
// Voice guardrails (docs/emma-voice.md): no em-dashes, no countdowns or urgency
// theater, billing descriptor reads XDIPX, "sex toy" is a normal noun. Keep the
// title <=60 chars and the description <=155 chars so search engines never clip.

export default {
  name: 'homeSeo',
  title: 'Home SEO (search snippet)',
  type: 'document',
  // Singleton — prevent editors creating extra docs via the Studio list view.
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'seoTitle',
      title: 'Homepage title tag',
      type: 'string',
      description:
        'The full <title> shown in Google/Bing results and the browser tab. Replaces the brand default entirely, so include the brand if you want it (e.g. "xdipx — Summer Edit, Up To 40% Off"). Keep under 60 characters or it gets truncated. No em-dashes, no countdowns.',
      validation: (Rule) =>
        Rule.max(60).warning('Titles over 60 characters get truncated in search results.'),
    },
    {
      name: 'seoDescription',
      title: 'Homepage meta description',
      type: 'text',
      rows: 3,
      description:
        'The snippet under the title in search results. Lead with commercial + trust signals (curation, discreet shipping, XDIPX billing, 30-day returns). Keep under 155 characters. Blank falls back to the brand default.',
      validation: (Rule) =>
        Rule.max(155).warning('Descriptions over 155 characters get truncated in search results.'),
    },
    {
      name: 'ogImageUrl',
      title: 'Social share image URL (optional)',
      type: 'url',
      description:
        'Overrides the default Open Graph / Twitter card image for the homepage when shared. Leave blank to use the site default (or the featured hero image on the storefront variant).',
    },
    {
      name: 'note',
      title: 'Editor note (internal)',
      type: 'string',
      description:
        'Optional context for the team — e.g. which calendar theme this snippet is tied to and when to rotate it out. Never rendered anywhere.',
    },
  ],
  preview: {
    select: { title: 'seoTitle', subtitle: 'seoDescription' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Home SEO (using brand default)',
      subtitle: subtitle || 'No description override — using brand default',
    }),
  },
}
