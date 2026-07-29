// One band of the storefront homepage shell.
//
// The band's CONTENT already comes from wherever it comes from today (Shopify
// for products, singleton.homepage blocks for merchandised rails, the Notebook
// for posts). What this entry adds is the two things that were previously
// locked in JSX: whether the band renders, and the chrome copy around it, which
// until now was hardcoded in StorefrontHome.
//
// Every override is optional. Leave a field blank and the band keeps its
// shipped default, so an entry that only sets `band` is a no-op.
export const HOME_BANDS = [
  { title: 'Headliner (hero)', value: 'hero' },
  { title: 'Trust strip', value: 'trustStrip' },
  { title: 'Most picked grid', value: 'anchorGrid' },
  { title: 'Team rails', value: 'teamRails' },
  { title: 'Meet Emma', value: 'meetEmma' },
  { title: 'Find your way in (mosaic)', value: 'wayfinder' },
  { title: "Emma's edit rail", value: 'emmasEdit' },
  { title: 'Sensation map', value: 'sensationMap' },
  { title: 'Couples band', value: 'couples' },
  { title: 'Still deciding closer', value: 'stillDeciding' },
  { title: 'From the Notebook', value: 'notebook' },
  { title: 'FAQ', value: 'faq' },
  { title: 'Email capture', value: 'emailCapture' },
]

export default {
  name: 'homeBand',
  title: 'Band',
  type: 'object',
  fields: [
    {
      name: 'band',
      title: 'Band',
      type: 'string',
      options: { list: HOME_BANDS },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'enabled',
      title: 'Visible',
      type: 'boolean',
      initialValue: true,
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow override',
      type: 'string',
      validation: (Rule) => Rule.max(48),
    },
    {
      name: 'heading',
      title: 'Heading override',
      type: 'string',
      validation: (Rule) => Rule.max(120),
    },
    {
      name: 'emphasis',
      title: 'Emphasis word',
      type: 'string',
      description: 'Word in the heading rendered italic plum.',
      validation: (Rule) => Rule.max(24),
    },
    {
      name: 'body',
      title: 'Body override',
      type: 'text',
      rows: 3,
      validation: (Rule) => Rule.max(600),
    },
    {
      name: 'ctaLabel',
      title: 'CTA label override',
      type: 'string',
      description: 'Voice charter CTA whitelist only.',
      options: { list: ['Take a peek →', 'Show me', 'Find your fit →', 'I’ll take it ♥', 'See all →'] },
    },
    {
      name: 'ctaLink',
      title: 'CTA link override',
      type: 'string',
      validation: (Rule) =>
        Rule.custom((value) =>
          !value || /^\/[\w\-/?=&.]*$/.test(value) ? true : 'Must be a site-relative path',
        ),
    },
  ],
  preview: {
    select: { band: 'band', enabled: 'enabled', heading: 'heading' },
    prepare: ({ band, enabled, heading }) => {
      const label = HOME_BANDS.find((b) => b.value === band)?.title || band || 'Band'
      return {
        title: label,
        subtitle: `${enabled === false ? 'Hidden' : 'Visible'}${heading ? ` · "${heading}"` : ''}`,
      }
    },
  },
}
