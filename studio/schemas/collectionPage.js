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
    { name: 'taxonomy',  title: 'Taxonomy'                     },
    { name: 'seo',       title: 'SEO Overrides'                },
    { name: 'editorial', title: 'Editorial Copy'               },
    { name: 'faqs',      title: 'FAQs'                         },
    { name: 'related',   title: 'Related Collections'          },
    // Merch components v1 — 1k PLP merch header. Additive group + field.
    { name: 'merch',     title: 'Merch Header'                 },
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
      name: 'collectionType',
      title: 'Collection Type',
      type: 'string',
      group: 'taxonomy',
      description: 'Drives where this collection appears on the /collections hub. Categories group under "Shop by category", brands under "Shop by brand", and themes under "Shop by theme". Anything without a doc here defaults to "category".',
      options: {
        list: [
          { title: 'Category (e.g. wands, vibrators, lubes)', value: 'category' },
          { title: 'Brand (e.g. Lelo, We-Vibe, Fun Factory)',  value: 'brand'    },
          { title: 'Theme (e.g. couples-night, first-timer)',  value: 'theme'    },
        ],
        layout: 'radio',
      },
      initialValue: 'category',
      validation: Rule => Rule.required(),
    },

    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'seo',
      description: 'Overrides the page <title> in Google. Leave blank to fall back to the auto-generated Shopify-derived title. Google truncates ~60 chars in SERPs.',
      // Warn if it's likely to truncate; hard error past 70.
      validation: Rule => Rule.max(70).warning('Aim for ≤60 chars — Google truncates the rest in SERPs.'),
    },
    {
      name: 'seoDescription',
      title: 'SEO Meta Description',
      type: 'text',
      group: 'seo',
      rows: 3,
      description: 'Overrides the meta description in Google. Aim for 120–155 chars.',
      validation: Rule => Rule
        .max(160)
        .custom(v => {
          if (!v) return true
          if (v.length < 120) return 'Aim for at least 120 chars — short descriptions get rewritten by Google.'
          return true
        }),
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
        {
          name: 'alt',
          title: 'Alt text',
          type: 'string',
          description: 'Required when an image is set — needed for accessibility and image-search ranking.',
          // Required only when an image is present.
          validation: Rule => Rule.custom((alt, ctx) => {
            const parent = ctx.parent
            if (parent?.asset && (!alt || !alt.trim())) {
              return 'Alt text is required when a hero image is set.'
            }
            return true
          }),
        },
      ],
    },

    {
      name: 'introCopy',
      title: 'Intro Copy (Emma voice)',
      type: 'array',
      group: 'editorial',
      description: 'Rendered below the H1 — 1 to 3 short paragraphs of editorial framing for the category. This is the single biggest organic-ranking lever; write distinctive copy per category in Emma voice.',
      of: [RICH_TEXT_BLOCK],
      // Warn (not error) when intro copy is missing — collections with no
      // editorial copy fall back to thin Shopify descriptions and rank poorly.
      validation: Rule => Rule.custom(v => {
        if (!v || v.length === 0) {
          return 'Add at least one paragraph of intro copy — this is the single biggest organic-ranking lever for the page.'
        }
        return true
      }).warning(),
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
      validation: Rule => Rule
        .max(12)
        .custom(v => {
          if (!v || v.length < 3) {
            return 'Add at least 3 FAQs — they fuel FAQ rich snippets and People-Also-Ask coverage.'
          }
          return true
        }).warning(),
    },

    {
      name: 'needsKeywordPass',
      title: 'Needs keyword pass',
      type: 'boolean',
      description: 'TRUE means Emma copy was written without approved keyword targeting. A later script will weave keywords in via patch_document_from_json once the SEO bank covers this cluster. Do not edit by hand.',
      initialValue: false,
      readOnly: true,
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

    // Merch components v1 — 1k PLP merch header. Additive optional field:
    // existing collectionPage docs have no value here, so the PLP falls back
    // to its current header rendering when unset. Nothing existing changes.
    {
      name: 'merchHeader',
      title: 'PLP Merch Header',
      type: 'plpMerchHeader',
      group: 'merch',
      description: 'Optional masthead + curated preset pills shown above the product grid on this collection page.',
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
