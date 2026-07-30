// Home SEO singleton: the homepage's search-result title + description.
// Additive; does not touch homeConfig or any existing schema file.
//
// Singleton _id: singleton.homeSeo
// The team-editable Google/Bing SERP snippet, changeable without a code deploy.
// Leave a field blank to fall back to the brand defaults in app/lib/brand.ts.
//
// OWNER: homepage-orchestrator is the sole writer (see its agent definition and
// docs/homepage-team/routine-daily-merchandise.md Step 2e). store-strategist
// authorises a rotation via a HOMESEO: line in the weekly brief. Do NOT rotate
// the title to match a weekly marketing-calendar theme: Google caches SERP
// titles for days to weeks, so theme-rate churn destroys the signal. Theme copy
// belongs in the hero and rails. Hard floor of 28 days between title changes.
//
// Saving here is not publishing. An unpublished draft is invisible to the site,
// which reads the published perspective. That is exactly how this document sat
// blank and unnoticed from 2026-07-24 to 2026-07-30.
//
// Voice guardrails (docs/emma-voice.md): no em-dashes, no countdowns or urgency
// theater, billing descriptor reads XDIPX, "sex toy" is a normal noun. Keep the
// title <=60 chars and the description <=155 chars so search engines never clip.

export default {
  name: 'homeSeo',
  title: 'Home SEO (search snippet)',
  type: 'document',
  // Singleton. Prevents editors creating extra docs via the Studio list view.
  // Note this also omits 'create', so the FIRST published version has to come
  // from scripts/sanity-content-cli.ts (create-or-replace, then publish); a
  // human cannot mint the document in Studio.
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'seoTitle',
      title: 'Homepage title tag',
      type: 'string',
      description:
        'The full <title> shown in Google/Bing results and the browser tab. Replaces the brand default entirely, so include the brand if you want it (e.g. "xdipx | Summer Edit"). Keep under 60 characters or it gets truncated. No em-dashes, no countdowns.',
      // Warning, not error, and note that Studio validation does not run at all
      // for scripts/sanity-content-cli.ts writes at ANY severity. Any agent
      // writing this field must enforce the cap in its own code first.
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
        'Optional context for the team, e.g. which trigger caused the last rotation and on what date. Never rendered anywhere. Patch it in the SAME transaction as the copy fields: a note-only patch still moves _updatedAt, which is the 28-day rotation floor clock.',
    },
  ],
  preview: {
    select: { title: 'seoTitle', subtitle: 'seoDescription' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Home SEO (using brand default)',
      subtitle: subtitle || 'No description override, using brand default',
    }),
  },
}
