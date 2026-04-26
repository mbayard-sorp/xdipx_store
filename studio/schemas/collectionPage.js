// Additive Sanity doc type — editorial SEO overrides for /collections/$handle.
// Created per CLAUDE.md "additive only" rule. Loader merges Sanity values over
// Shopify-native collection metadata so editors can override per-category SEO
// without touching Shopify Admin.

const RICH_TEXT_BLOCK = {
  type: 'block',
  styles: [
    { title: 'Normal',    value: 'normal' },
    { title: 'Heading 2', value: 'h2'     },
    { title: 'Heading 3', value: 'h3'     },
  ],
  lists: [
    { title: 'Bullet',   value: 'bullet'  },
    { title: 'Numbered', value: 'number'  },
  ],
  marks: {
    decorators: [
      { title: 'Bold',      value: 'strong' },
      { title: 'Italic',    value: 'em'     },
      { title: 'Underline', value: 'underline' },
    ],
    annotations: [
      {
        name: 'link', title: 'Link', type: 'object',
        fields: [{ name: 'href', title: 'URL', type: 'url' }],
      },
    ],
  },
}

export default {
  name: 'collectionPage',
  title: 'Collection Page (SEO)',
  type: 'document',

  groups: [
    { name: 'targeting', title: 'Targeting',     default: true },
    { name: 'seo',       title: 'SEO Overrides'                },
    { name: 'editorial', title: 'Editorial Copy'               },
    { name: 'faqs',      title: 'FAQs'                         },
    { name: 'related',   title: 'Related Collections'          },
  ],

  fields: [
    {
      name: 'shopifyHandle',
      title: 'Shopify Collection Handle',
      type: 'string',
      group: 'targeting',
      description: 'Must match the Shopify collection handle exactly (e.g. "wands"). One Sanity doc per collection.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'title',
      title: 'Internal Title',
      type: 'string',
      group: 'targeting',
      description: 'Editor reference label only — not shown on the site.',
    },

    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'seo',
      description: 'Overrides the page <title> in Google. Leave blank to fall back to Shopify collection title. Aim for 50–60 chars.',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Meta Description',
      type: 'text',
      group: 'seo',
      rows: 3,
      description: 'Overrides the meta description in Google. Aim for 140–155 chars.',
      validation: Rule => Rule.max(160),
    },
    {
      name: 'h1',
      title: 'H1 Headline (visible)',
      type: 'string',
      group: 'seo',
      description: 'Overrides the visible H1 above the product grid. Leave blank to use Shopify title.',
    },
    {
      name: 'heroImageOverride',
      title: 'Hero Image (override)',
      type: 'image',
      group: 'seo',
      description: 'Optional — overrides the Shopify collection image. Drives og:image and the LCP hero on the PLP.',
      options: { hotspot: true },
      fields: [
        { name: 'alt', title: 'Alt text', type: 'string' },
      ],
    },

    {
      name: 'introCopy',
      title: 'Intro Copy (Emma voice)',
      type: 'array',
      group: 'editorial',
      description: 'Rendered below the H1 — 1 to 3 short paragraphs of editorial framing for the category. This is the single biggest organic-ranking lever; write distinctive copy per category in Emma voice.',
      of: [RICH_TEXT_BLOCK],
    },

    {
      name: 'faqs',
      title: 'Collection FAQs',
      type: 'array',
      group: 'faqs',
      description: '3 to 8 Q&As about the category (e.g. "What\'s the quietest wand?"). Emitted as FAQPage JSON-LD AND rendered visibly on the PLP.',
      of: [
        {
          type: 'object',
          name: 'collectionFaq',
          fields: [
            { name: 'question', title: 'Question', type: 'string', validation: Rule => Rule.required() },
            { name: 'answer',   title: 'Answer',   type: 'text',   rows: 3, validation: Rule => Rule.required() },
          ],
          preview: {
            select: { title: 'question', subtitle: 'answer' },
          },
        },
      ],
      validation: Rule => Rule.max(12),
    },

    {
      name: 'relatedCollections',
      title: 'Related Collections',
      type: 'array',
      group: 'related',
      description: 'Sibling collections to surface in the "Browse other categories" rail at the bottom of this PLP. Boosts internal linking and topical authority.',
      of: [
        {
          type: 'object',
          name: 'relatedCollection',
          fields: [
            { name: 'handle', title: 'Shopify Handle', type: 'string', validation: Rule => Rule.required() },
            { name: 'label',  title: 'Display Label',  type: 'string', validation: Rule => Rule.required() },
          ],
          preview: {
            select: { title: 'label', subtitle: 'handle' },
          },
        },
      ],
      validation: Rule => Rule.max(8),
    },
  ],

  preview: {
    select: { title: 'title', subtitle: 'shopifyHandle' },
    prepare: ({ title, subtitle }) => ({
      title:    title    || subtitle || 'Collection page',
      subtitle: subtitle ? `/collections/${subtitle}` : '',
    }),
  },
}
