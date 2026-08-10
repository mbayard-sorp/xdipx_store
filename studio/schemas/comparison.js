/**
 * Comparison ("X vs Y") document type.
 *
 * Powers the /compare/{slug} route and its .md twin: a BOFU editorial surface
 * that answers "X vs Y" and "alternative to X" queries with an ItemList + FAQ
 * schema. Additive: a brand-new doc type per the CLAUDE.md additive-only rule;
 * no existing schema is touched. Nothing renders until a comparison is
 * published, so shipping the type is inert until the content team writes docs.
 *
 * Items reference products by Shopify handle (not a Sanity reference) so the
 * route can resolve live images, titles, and canonical PDP links the same way
 * the Notebook resolves blogProductEmbed handles. An item may omit the handle
 * for a non-catalog option (e.g. a category or a competitor archetype); it then
 * links to the comparison page itself.
 */

// Minimal rich-text block for the optional editorial deep-dive. Mirrors the
// blogPost body decorators so the .md serializer's portable-text walker handles
// it without special-casing.
const COMPARISON_RICH_TEXT = {
  type: 'block',
  styles: [
    { title: 'Normal',     value: 'normal' },
    { title: 'Heading 2',  value: 'h2' },
    { title: 'Heading 3',  value: 'h3' },
    { title: 'Blockquote', value: 'blockquote' },
  ],
  lists: [
    { title: 'Bullet',   value: 'bullet' },
    { title: 'Numbered', value: 'number' },
  ],
  marks: {
    decorators: [
      { title: 'Bold',   value: 'strong' },
      { title: 'Italic', value: 'em' },
    ],
    annotations: [
      {
        name: 'link',
        title: 'Link',
        type: 'object',
        fields: [
          {
            name: 'href',
            title: 'URL',
            type: 'url',
            validation: (Rule) =>
              Rule.uri({ allowRelative: true, scheme: ['http', 'https', 'mailto', 'tel'] }),
          },
        ],
      },
    ],
  },
}

export default {
  name: 'comparison',
  title: 'Comparison (X vs Y)',
  type: 'document',

  groups: [
    { name: 'content',  title: 'Content',  default: true },
    { name: 'seo',      title: 'SEO' },
    { name: 'settings', title: 'Settings' },
  ],

  fields: [
    // ── Content ──────────────────────────────────────────────────────────────
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      group: 'content',
      description: 'The comparison headline, e.g. "Air-pulse vs classic vibrator".',
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      group: 'content',
      description: 'URL path segment, e.g. "air-pulse-vs-classic-vibrator". Lives at /compare/{slug}.',
      options: { source: 'title', maxLength: 96 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'excerpt',
      title: 'Intro',
      type: 'text',
      rows: 3,
      group: 'content',
      description: 'Short framing shown under the H1 and used as the fallback meta description.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'items',
      title: 'Items being compared',
      type: 'array',
      group: 'content',
      description: 'Two or more options this page weighs. Each becomes an ItemList entry.',
      validation: Rule => Rule.required().min(2).max(5),
      of: [
        {
          type: 'object',
          name: 'comparisonItem',
          title: 'Item',
          fields: [
            {
              name: 'name',
              title: 'Name',
              type: 'string',
              validation: Rule => Rule.required(),
            },
            {
              name: 'productHandle',
              title: 'Product handle',
              type: 'string',
              description: 'Shopify handle to link to the PDP and pull a live image. Leave blank for a non-catalog option (links to this page instead).',
            },
            {
              name: 'blurb',
              title: 'Blurb',
              type: 'text',
              rows: 3,
              description: 'Emma-voice summary of what this option is and who it suits.',
              validation: Rule => Rule.required(),
            },
            {
              name: 'bestFor',
              title: 'Best for',
              type: 'string',
              description: 'One line: who should pick this one.',
            },
          ],
          preview: {
            select: { title: 'name', subtitle: 'bestFor' },
          },
        },
      ],
    },
    {
      name: 'attributes',
      title: 'Comparison table rows',
      type: 'array',
      group: 'content',
      description: 'Optional at-a-glance table. Each row lists a value per item, in the same order as the items above.',
      of: [
        {
          type: 'object',
          name: 'comparisonAttribute',
          title: 'Row',
          fields: [
            {
              name: 'label',
              title: 'Attribute',
              type: 'string',
              validation: Rule => Rule.required(),
            },
            {
              name: 'values',
              title: 'Values (one per item, in order)',
              type: 'array',
              of: [{ type: 'string' }],
              validation: Rule => Rule.required().min(1),
            },
          ],
          preview: {
            select: { title: 'label' },
          },
        },
      ],
    },
    {
      name: 'verdict',
      title: 'Verdict',
      type: 'text',
      rows: 4,
      group: 'content',
      description: 'The bottom line. Which one, for whom, and why.',
    },
    {
      name: 'body',
      title: 'Deep dive (optional)',
      type: 'array',
      group: 'content',
      description: 'Longer editorial section rendered below the table.',
      of: [COMPARISON_RICH_TEXT],
    },
    {
      name: 'faqs',
      title: 'FAQs',
      type: 'array',
      group: 'content',
      description: 'Question and answer pairs. Emitted as FAQPage JSON-LD.',
      of: [
        {
          type: 'object',
          name: 'comparisonFaq',
          title: 'FAQ',
          fields: [
            {
              name: 'question',
              title: 'Question',
              type: 'string',
              validation: Rule => Rule.required(),
            },
            {
              name: 'answer',
              title: 'Answer',
              type: 'text',
              rows: 3,
              validation: Rule => Rule.required(),
            },
          ],
          preview: {
            select: { title: 'question' },
          },
        },
      ],
    },

    // ── SEO ──────────────────────────────────────────────────────────────────
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'seo',
      description: 'Overrides the page title in search results (max 70 chars).',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      rows: 3,
      group: 'seo',
      description: 'Meta description shown in search results (max 160 chars).',
      validation: Rule => Rule.max(160),
    },
    {
      name: 'noIndex',
      title: 'No Index',
      type: 'boolean',
      group: 'seo',
      description: 'Exclude this comparison from search engine indexing.',
      initialValue: false,
    },

    // ── Settings ─────────────────────────────────────────────────────────────
    {
      name: 'publishedAt',
      title: 'Publish Date',
      type: 'datetime',
      group: 'settings',
      validation: Rule => Rule.required(),
    },
    {
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      group: 'settings',
      description: 'Featured comparisons lead the /compare index.',
      initialValue: false,
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'settings',
      options: {
        list: [
          { title: 'Draft',     value: 'draft' },
          { title: 'Published', value: 'published' },
        ],
        layout: 'radio',
      },
      initialValue: 'draft',
    },
  ],

  preview: {
    select: {
      title: 'title',
      status: 'status',
      itemCount: 'items',
    },
    prepare: ({ title, status, itemCount }) => ({
      title: title || 'Untitled comparison',
      subtitle: [
        status === 'draft' ? 'DRAFT' : '',
        Array.isArray(itemCount) ? `${itemCount.length} items` : '',
      ].filter(Boolean).join(' — '),
    }),
  },

  orderings: [
    { title: 'Publish Date (newest)', name: 'publishDesc', by: [{ field: 'publishedAt', direction: 'desc' }] },
    { title: 'Title A-Z',            name: 'titleAsc',    by: [{ field: 'title',       direction: 'asc' }] },
  ],
}
