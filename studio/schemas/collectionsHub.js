// Additive Sanity singleton — editorial copy for the /collections hub PLP.
// Created per CLAUDE.md "additive only" rule. Loader merges Sanity values
// over hardcoded defaults so editors can lift the hub from a thin index
// into a depth-rich, ranking-eligible category page without touching code.

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
        fields: [{
          name: 'href', title: 'URL', type: 'url',
          // Allow internal relative links; the default url rule gates publish.
          validation: (Rule) => Rule.uri({ allowRelative: true, scheme: ['http', 'https', 'mailto', 'tel'] }),
        }],
      },
    ],
  },
}

export default {
  name: 'collectionsHub',
  title: 'Collections Hub (SEO)',
  type: 'document',

  // Singleton — managed by id "singleton.collectionsHub". One doc covers
  // the entire /collections hub PLP. Studio structure can pin this.
  groups: [
    { name: 'seo',       title: 'SEO Overrides', default: true },
    { name: 'editorial', title: 'Editorial Copy'                },
    { name: 'featured',  title: 'Featured Collections'          },
    { name: 'faqs',      title: 'FAQs'                          },
  ],

  fields: [
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'seo',
      description: 'Overrides the page <title> in Google. Aim for 50–60 chars.',
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
      description: 'Overrides the visible H1. Leave blank to use the default.',
    },
    {
      name: 'introCopy',
      title: 'Intro Copy (Emma voice)',
      type: 'array',
      group: 'editorial',
      description: 'Rendered above the collection grid. 1–3 short paragraphs of editorial framing for the whole catalog. Single biggest organic-ranking lever for the hub.',
      of: [RICH_TEXT_BLOCK],
    },
    {
      name: 'featuredCollectionHandles',
      title: 'Featured Collection Handles',
      type: 'array',
      group: 'featured',
      description: '0–4 Shopify collection handles to surface in a "Featured this week" rail above the full grid. Each handle must match an existing Shopify collection.',
      of: [
        {
          type: 'object',
          name: 'featuredCollection',
          fields: [
            { name: 'handle', title: 'Shopify Handle', type: 'string', validation: Rule => Rule.required() },
            { name: 'blurb',  title: 'Emma blurb',     type: 'text', rows: 2, description: 'One-line Emma-voice why-this-shelf-matters.' },
          ],
          preview: {
            select: { title: 'handle', subtitle: 'blurb' },
          },
        },
      ],
      validation: Rule => Rule.max(4),
    },
    {
      name: 'faqs',
      title: 'Hub FAQs',
      type: 'array',
      group: 'faqs',
      description: '3 to 8 Q&As covering category-spanning questions ("What\'s the difference between a wand and a vibrator?", "Which lube works with silicone toys?"). Emitted as FAQPage JSON-LD AND rendered visibly.',
      of: [
        {
          type: 'object',
          name: 'hubFaq',
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
  ],

  preview: {
    prepare: () => ({
      title: 'Collections Hub (SEO)',
      subtitle: '/collections',
    }),
  },
}
