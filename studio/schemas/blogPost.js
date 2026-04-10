import { withImageGenerator } from '../lib/withImageGenerator'

const BLOG_RICH_TEXT = {
  type: 'block',
  styles: [
    { title: 'Normal',     value: 'normal' },
    { title: 'Heading 2',  value: 'h2' },
    { title: 'Heading 3',  value: 'h3' },
    { title: 'Heading 4',  value: 'h4' },
    { title: 'Blockquote', value: 'blockquote' },
  ],
  lists: [
    { title: 'Bullet',   value: 'bullet' },
    { title: 'Numbered', value: 'number' },
  ],
  marks: {
    decorators: [
      { title: 'Bold',          value: 'strong' },
      { title: 'Italic',        value: 'em' },
      { title: 'Underline',     value: 'underline' },
      { title: 'Strikethrough', value: 'strikethrough' },
      { title: 'Code',          value: 'code' },
    ],
    annotations: [
      {
        name: 'link',
        title: 'Link',
        type: 'object',
        fields: [
          { name: 'href', title: 'URL', type: 'url' },
          {
            name: 'openInNewTab',
            title: 'Open in new tab',
            type: 'boolean',
            initialValue: false,
          },
        ],
      },
      {
        name: 'internalLink',
        title: 'Internal Link',
        type: 'object',
        fields: [
          {
            name: 'reference',
            title: 'Reference',
            type: 'reference',
            to: [{ type: 'blogPost' }, { type: 'page' }],
          },
        ],
      },
    ],
  },
}

export default {
  name: 'blogPost',
  title: 'Blog Post',
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
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      group: 'content',
      options: { source: 'title', maxLength: 96 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'author',
      title: 'Author',
      type: 'reference',
      to: [{ type: 'blogAuthor' }],
      group: 'content',
    },
    {
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{ type: 'blogCategory' }],
      group: 'content',
    },
    {
      name: 'tags',
      title: 'Tags',
      type: 'array',
      group: 'content',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
    },
    {
      name: 'excerpt',
      title: 'Excerpt',
      type: 'text',
      rows: 3,
      group: 'content',
      description: 'Short summary shown on listing cards and as fallback meta description.',
      validation: Rule => Rule.required(),
    },
    ...withImageGenerator('heroImage').map(f => ({ ...f, group: 'content' })),
    {
      name: 'heroImageAlt',
      title: 'Hero Image Alt Text',
      type: 'string',
      group: 'content',
      description: 'Describe the hero image for accessibility and SEO.',
    },
    {
      name: 'body',
      title: 'Body',
      type: 'array',
      group: 'content',
      of: [
        BLOG_RICH_TEXT,
        { type: 'blogImage' },
        { type: 'blogPullQuote' },
        { type: 'blogProductEmbed' },
        { type: 'blogCta' },
        { type: 'blogVideoEmbed' },
      ],
    },
    {
      name: 'relatedPosts',
      title: 'Related Posts',
      type: 'array',
      group: 'content',
      of: [{ type: 'reference', to: [{ type: 'blogPost' }] }],
      validation: Rule => Rule.max(3),
    },

    // ── SEO ──────────────────────────────────────────────────────────────────
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'seo',
      description: 'Overrides the post title in search results (max 70 chars)',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      rows: 3,
      group: 'seo',
      description: 'Meta description shown in search results (max 160 chars)',
      validation: Rule => Rule.max(160),
    },
    {
      name: 'ogImage',
      title: 'Open Graph Image',
      type: 'image',
      group: 'seo',
      options: { hotspot: true },
      description: 'Custom social sharing image. Falls back to hero image if not set.',
    },
    {
      name: 'noIndex',
      title: 'No Index',
      type: 'boolean',
      group: 'seo',
      description: 'Exclude this post from search engine indexing.',
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
      description: 'Featured posts appear in the hero section on the blog index.',
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
      authorName: 'author.name',
      media: 'heroImage',
      status: 'status',
    },
    prepare: ({ title, authorName, media, status }) => ({
      title: title || 'Untitled post',
      subtitle: [status === 'draft' ? 'DRAFT' : '', authorName].filter(Boolean).join(' — '),
      media,
    }),
  },

  orderings: [
    { title: 'Publish Date (newest)', name: 'publishDesc', by: [{ field: 'publishedAt', direction: 'desc' }] },
    { title: 'Title A-Z',            name: 'titleAsc',    by: [{ field: 'title',       direction: 'asc' }] },
  ],
}
