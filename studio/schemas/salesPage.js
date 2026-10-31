// Long-form sales page for adult ad networks (ExoClick first), served at
// curious.xdipx.com/<slug> by app/routes/bridge.$slug.tsx. Additive: a new
// document type, nothing existing changes.
//
// One product per page. Price, compare-at price, images, variants and stock
// come from Shopify at request time; this document holds only the words and
// their order. Every buy button adds the product to a cart and opens checkout.
//
// Policy: docs/ads-policy.md, Adult ad networks row. Copy may run at register
// 10 here and nowhere else. Proof is real reviews only (design doctrine §6).
// Nothing renders until `live` is on AND the document is published.

const CTA_LABELS = ["I'll take it ♥", 'Show me', 'Take a peek →', 'Find your fit →']

const noDashes = value => {
  if (typeof value !== 'string') return true
  if (value.includes('—') || value.includes('–')) return 'No em or en dashes. Use a period or a comma.'
  if (/\bbuy now\b/i.test(value)) return 'Never "Buy now". Use a CTA from the whitelist.'
  return true
}

const oneEmphasis = value => {
  if (!value) return true
  if ((value.match(/\*[^*]+\*/g) ?? []).length > 1) return 'Use at most one *emphasis* word.'
  return noDashes(value)
}

const heading = {
  name: 'heading',
  title: 'Heading',
  type: 'string',
  description: 'Wrap exactly one word in asterisks for the plum italic, for example: Quiet enough to *forget* the walls.',
  validation: Rule => Rule.required().max(120).custom(oneEmphasis),
}

const kicker = {
  name: 'kicker',
  title: 'Kicker',
  type: 'string',
  description: 'Small mono label above the heading. Optional.',
  validation: Rule => Rule.max(40).custom(noDashes),
}

const paragraphs = {
  name: 'paragraphs',
  title: 'Paragraphs',
  type: 'array',
  of: [{ type: 'text', rows: 4, validation: Rule => Rule.custom(noDashes) }],
}

const tone = {
  name: 'tone',
  title: 'Background',
  type: 'string',
  options: { list: ['paper', 'paper-2', 'plum-soft', 'coral-soft', 'ink'], layout: 'radio' },
  initialValue: 'paper',
}

const imageField = {
  name: 'image',
  title: 'Image',
  type: 'image',
  options: { hotspot: true },
  description: 'Optional. No text in the pixels. The charter nudity definition is the ceiling.',
  fields: [{ name: 'alt', title: 'Alt text', type: 'string' }],
}

const preview = (label, field = 'heading') => ({
  select: { title: field },
  prepare: ({ title }) => ({ title: (title ?? '').replace(/\*/g, ''), subtitle: label }),
})

export default {
  name: 'salesPage',
  title: 'Sales page',
  type: 'document',
  groups: [
    { name: 'setup', title: 'Setup', default: true },
    { name: 'hero', title: 'Hero' },
    { name: 'body', title: 'Sections' },
    { name: 'close', title: 'Close' },
  ],
  fields: [
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      group: 'setup',
      description: 'The path on curious.xdipx.com. Lowercase letters, digits, hyphens.',
      options: { source: 'productHandle', maxLength: 60 },
      validation: Rule =>
        Rule.required().custom(v =>
          /^[a-z0-9][a-z0-9-]{0,59}$/.test(v?.current ?? '') ? true : 'Lowercase letters, digits, hyphens. 60 characters max.',
        ),
    },
    {
      name: 'productHandle',
      title: 'Product handle',
      type: 'string',
      group: 'setup',
      description: 'Shopify handle of the product this page sells (no /products/ prefix).',
      validation: Rule =>
        Rule.required().custom(v => (/^[a-z0-9][a-z0-9-]*$/.test(v ?? '') ? true : 'Bare handle only: lowercase letters, digits, hyphens')),
    },
    {
      name: 'live',
      title: 'Live',
      type: 'boolean',
      group: 'setup',
      initialValue: false,
      description: 'Off means the page 404s for visitors. Preview shows it either way.',
    },
    {
      name: 'buttonLabel',
      title: 'Button label',
      type: 'string',
      group: 'setup',
      description: 'Used on every buy button on the page. Whitelist only.',
      options: { list: CTA_LABELS },
      initialValue: CTA_LABELS[0],
      validation: Rule => Rule.required(),
    },
    {
      name: 'announcement',
      title: 'Announcement bar',
      type: 'string',
      group: 'setup',
      description: 'Thin bar at the very top. For example: Free shipping · Plain box, billed XDIPX. No countdowns.',
      validation: Rule => Rule.max(90).custom(noDashes),
    },
    {
      name: 'seoTitle',
      title: 'Browser tab title',
      type: 'string',
      group: 'setup',
      description: 'The page is noindex, so this only shows in the tab and in link previews.',
      validation: Rule => Rule.max(70).custom(noDashes),
    },

    // Hero
    { ...kicker, group: 'hero' },
    { ...heading, name: 'headline', title: 'Headline', group: 'hero' },
    {
      name: 'subhead',
      title: 'Subhead',
      type: 'text',
      rows: 3,
      group: 'hero',
      description: 'Two or three sentences under the headline. What it does and how it feels.',
      validation: Rule => Rule.required().max(400).custom(noDashes),
    },
    {
      name: 'heroPoints',
      title: 'Hero points',
      type: 'array',
      group: 'hero',
      description: 'Three or four short lines with a heart beside each, under the buy button.',
      of: [{ type: 'string', validation: Rule => Rule.max(100).custom(noDashes) }],
      validation: Rule => Rule.max(5),
    },
    {
      ...imageField,
      name: 'heroImage',
      title: 'Hero image',
      group: 'hero',
      description: 'Optional. Leave empty to lead with the Shopify product gallery.',
    },

    // Sections
    {
      name: 'sections',
      title: 'Sections',
      type: 'array',
      group: 'body',
      description: 'The long body of the page, top to bottom. Drag to reorder. Repeat the buy band as often as you like.',
      of: [
        {
          name: 'spStory',
          title: 'Story',
          type: 'object',
          fields: [kicker, heading, paragraphs, imageField, tone],
          preview: preview('Story'),
        },
        {
          name: 'spFeatures',
          title: 'Feature grid',
          type: 'object',
          fields: [
            kicker,
            heading,
            {
              name: 'items',
              title: 'Items',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'label', title: 'Label', type: 'string', validation: Rule => Rule.required().max(40) },
                    { name: 'value', title: 'Value', type: 'string', validation: Rule => Rule.required().max(140).custom(noDashes) },
                  ],
                  preview: { select: { title: 'label', subtitle: 'value' } },
                },
              ],
              validation: Rule => Rule.min(1).max(12),
            },
            tone,
          ],
          preview: preview('Feature grid'),
        },
        {
          name: 'spSteps',
          title: 'Steps',
          type: 'object',
          description: 'A numbered run: how it feels, minute by minute, or how to use it.',
          fields: [
            kicker,
            heading,
            {
              name: 'steps',
              title: 'Steps',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'label', title: 'Label', type: 'string', description: 'For example: First minute', validation: Rule => Rule.max(30) },
                    { name: 'title', title: 'Title', type: 'string', validation: Rule => Rule.required().max(80).custom(noDashes) },
                    { name: 'body', title: 'Body', type: 'text', rows: 3, validation: Rule => Rule.required().max(400).custom(noDashes) },
                  ],
                  preview: { select: { title: 'title', subtitle: 'label' } },
                },
              ],
              validation: Rule => Rule.min(2).max(6),
            },
            tone,
          ],
          preview: preview('Steps'),
        },
        {
          name: 'spComparison',
          title: 'Comparison table',
          type: 'object',
          fields: [
            kicker,
            heading,
            { name: 'usLabel', title: 'Our column', type: 'string', initialValue: 'This one', validation: Rule => Rule.required().max(24) },
            { name: 'themLabel', title: 'Their column', type: 'string', description: 'A category, never a named competitor. For example: A typical bullet', validation: Rule => Rule.required().max(24) },
            {
              name: 'rows',
              title: 'Rows',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'feature', title: 'Feature', type: 'string', validation: Rule => Rule.required().max(60) },
                    { name: 'us', title: 'Ours', type: 'string', validation: Rule => Rule.required().max(60).custom(noDashes) },
                    { name: 'them', title: 'Theirs', type: 'string', validation: Rule => Rule.required().max(60).custom(noDashes) },
                  ],
                  preview: { select: { title: 'feature', subtitle: 'us' } },
                },
              ],
              validation: Rule => Rule.min(2).max(10),
            },
            tone,
          ],
          preview: preview('Comparison'),
        },
        {
          name: 'spProof',
          title: 'Real reviews',
          type: 'object',
          description: 'Real customer reviews only, quoted as written. Never write or edit a review. Skip this block if there are none.',
          fields: [
            kicker,
            heading,
            {
              name: 'reviews',
              title: 'Reviews',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'quote', title: 'Quote', type: 'text', rows: 3, validation: Rule => Rule.required().max(500) },
                    { name: 'name', title: 'Reviewer as shown', type: 'string', description: 'For example: Jess R. Leave empty for anonymous.' },
                    {
                      name: 'source',
                      title: 'Where this review lives',
                      type: 'string',
                      description: 'The review platform and id or URL, so anyone can check it is real. Not shown on the page.',
                      validation: Rule => Rule.required(),
                    },
                  ],
                  preview: { select: { title: 'quote', subtitle: 'name' } },
                },
              ],
              validation: Rule => Rule.min(1).max(9),
            },
            tone,
          ],
          preview: preview('Real reviews'),
        },
        {
          name: 'spFaq',
          title: 'FAQ',
          type: 'object',
          fields: [
            heading,
            {
              name: 'items',
              title: 'Questions',
              type: 'array',
              of: [
                {
                  type: 'object',
                  fields: [
                    { name: 'q', title: 'Question', type: 'string', validation: Rule => Rule.required().max(140).custom(noDashes) },
                    { name: 'a', title: 'Answer', type: 'text', rows: 3, validation: Rule => Rule.required().max(800).custom(noDashes) },
                  ],
                  preview: { select: { title: 'q' } },
                },
              ],
              validation: Rule => Rule.min(1).max(14),
            },
            tone,
          ],
          preview: preview('FAQ'),
        },
        {
          name: 'spBuyBand',
          title: 'Buy band',
          type: 'object',
          description: 'A full-width coral band with a heading, a line and the buy button.',
          fields: [
            heading,
            { name: 'body', title: 'Line', type: 'text', rows: 2, validation: Rule => Rule.max(240).custom(noDashes) },
          ],
          preview: preview('Buy band'),
        },
        {
          name: 'spImage',
          title: 'Full-width image',
          type: 'object',
          fields: [
            { ...imageField, validation: Rule => Rule.required() },
            { name: 'caption', title: 'Caption', type: 'string', validation: Rule => Rule.max(140).custom(noDashes) },
          ],
          preview: { select: { title: 'caption', media: 'image' }, prepare: ({ title, media }) => ({ title: title || 'Image', subtitle: 'Full-width image', media }) },
        },
      ],
    },

    // Close
    { ...heading, name: 'closer', title: 'Closing headline', group: 'close' },
    {
      name: 'closerLine',
      title: 'Closing line',
      type: 'text',
      rows: 2,
      group: 'close',
      description: 'One line under the closing headline. The price is added automatically.',
      validation: Rule => Rule.max(240).custom(noDashes),
    },
  ],
  preview: {
    select: { title: 'headline', slug: 'slug.current', handle: 'productHandle', live: 'live' },
    prepare: ({ title, slug, handle, live }) => ({
      title: (title ?? slug ?? 'Untitled').replace(/\*/g, ''),
      subtitle: `${slug ?? ''} / ${handle ?? ''} / ${live ? 'live' : 'off'}`,
    }),
  },
}
