// Ad Studio v2, PR-D (additive). One document per paid-lane bridge page served
// at curious.xdipx.com/<slug> by app/routes/bridge.$slug.tsx. A bridge page is
// one screen: a photograph, one headline, one claim, one button to a PDP.
// Hard lines live in docs/ads-policy.md §Meta strategic lane (M1 to M7) and
// docs/store-team/ad-bridge-host.md. Nothing renders until `live` is true AND
// the document is published.
const CTA_LABELS = ['Take a peek', 'Show me', 'Find your fit']

export default {
  name: 'adBridgePage',
  title: 'Ad bridge page',
  type: 'document',
  fields: [
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'The URL path on curious.xdipx.com. Also sent as utm_content. Lowercase letters, digits, hyphens.',
      options: { source: 'headline', maxLength: 60 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      description:
        'One line, register 3 to 4. Wrap exactly one word in asterisks for the plum italic emphasis, for example: A gentler *second* spring. No category words ("sex toy", "vibrator"), no countdowns, no numbers that are not ours.',
      validation: Rule =>
        Rule.required().max(90).custom(value => {
          if (!value) return true
          const marks = (value.match(/\*[^*]+\*/g) ?? []).length
          if (marks > 1) return 'Use at most one *emphasis* word.'
          if (value.includes('\u2014') || value.includes('\u2013')) return 'No em or en dashes. Use a period or a comma.'
          return true
        }),
    },
    {
      name: 'claim',
      title: 'Claim',
      type: 'string',
      description:
        'One sentence: what it is, who it is for, or the offer. Register 3 to 4. No pleasure outcome, no act name, no efficacy claim beyond the label.',
      validation: Rule => Rule.required().max(200),
    },
    {
      name: 'buttonLabel',
      title: 'Button label',
      type: 'string',
      description: 'CTA whitelist only. Never "Buy now".',
      options: { list: CTA_LABELS },
      validation: Rule => Rule.required(),
    },
    {
      name: 'productHandle',
      title: 'Destination product handle',
      type: 'string',
      description:
        'Shopify handle of the PDP the button opens (no /products/ prefix). Must be in the Meta product subset so the PDP carries the health block.',
      validation: Rule =>
        Rule.required().custom(value =>
          /^[a-z0-9][a-z0-9-]*$/.test(value ?? '') ? true : 'Bare handle only: lowercase letters, digits, hyphens',
        ),
    },
    {
      name: 'image',
      title: 'Photograph',
      type: 'image',
      options: { hotspot: true },
      description:
        'One photograph: hands or an object, never a body part, never the product in use, never on skin, no text in pixels. Leave empty to use the product packshot on a coral-soft ground.',
      fields: [{ name: 'alt', title: 'Alt text', type: 'string', description: 'Describe the photograph plainly.' }],
    },
    {
      name: 'utmCampaign',
      title: 'utm_campaign',
      type: 'string',
      description:
        'For example meta-second-spring. The lane fills utm_source, paid fills utm_medium, the slug fills utm_content.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'lane',
      title: 'Lane',
      type: 'string',
      options: { list: ['meta', 'snap', 'google'], layout: 'radio' },
      initialValue: 'meta',
      validation: Rule => Rule.required(),
    },
    {
      name: 'live',
      title: 'Live',
      type: 'boolean',
      initialValue: false,
      description:
        'Off means the page 404s. Flip on only after the M1 to M7 checklist in docs/store-team/ad-bridge-host.md passes.',
    },
    {
      name: 'healthFraming',
      title: 'Health framing',
      type: 'boolean',
      initialValue: false,
      description: 'When on, the claim block adds the line "This is a personal wellness product, not a medical device."',
    },
  ],
  preview: {
    select: { title: 'headline', slug: 'slug.current', lane: 'lane', live: 'live', media: 'image' },
    prepare: ({ title, slug, lane, live, media }) => ({
      title: (title ?? slug ?? 'Untitled').replace(/\*/g, ''),
      subtitle: `${lane ?? 'meta'} / ${slug ?? ''} / ${live ? 'live' : 'off'}`,
      media,
    }),
  },
}
