// Brand identity for a brand collection: the official logo shown above the
// H1 on /collections/{handle} and on the brand cards of the /collections hub.
//
// Additive (CLAUDE.md "Sanity schema: additive only"): a new document keyed
// by the Shopify collection handle rather than a field on collectionPage.
//
// Logos are a real company's trademark, so they are SOURCED, never generated
// or redrawn (collections audit 2026-10-23). The provenance fields record
// where each file came from so a brand can be asked again if needed.
export default {
  name: 'brandIdentity',
  title: 'Brand identity (logo)',
  type: 'document',
  fields: [
    {
      name: 'collectionHandle',
      title: 'Brand collection handle',
      type: 'string',
      description: 'The Shopify collection handle, e.g. "lelo". One document per brand collection.',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9-]+$/, { name: 'handle' }),
    },
    {
      name: 'brandName',
      title: 'Brand name',
      type: 'string',
      description: 'As the brand writes it. Used as the logo alt text.',
      validation: (Rule) => Rule.required().max(80),
    },
    {
      name: 'logo',
      title: 'Logo (for light backgrounds)',
      type: 'image',
      description: 'The official mark. SVG preferred; otherwise a transparent PNG at least 600px wide. Never a redrawn or AI-made version.',
      options: { accept: 'image/svg+xml,image/png' },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'logoReversed',
      title: 'Logo (reversed, for dark backgrounds)',
      type: 'image',
      description: 'Optional. The brand-supplied light-on-dark version.',
      options: { accept: 'image/svg+xml,image/png' },
    },
    {
      name: 'sourceUrl',
      title: 'Where the file came from',
      type: 'url',
      description: 'Press kit, dealer portal or Nalpac brand page URL.',
    },
    {
      name: 'suppliedBy',
      title: 'Supplied by',
      type: 'string',
      description: 'Who sourced it, e.g. "Mike, Nalpac brands page".',
    },
    {
      name: 'sourcedAt',
      title: 'Sourced on',
      type: 'date',
    },
    {
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 2,
    },
  ],
  preview: {
    select: { title: 'brandName', subtitle: 'collectionHandle', media: 'logo' },
  },
}
