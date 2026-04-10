export default {
  name: 'blogCategory',
  title: 'Blog Category',
  type: 'document',

  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 96 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
    },
    {
      name: 'color',
      title: 'Badge Color',
      type: 'string',
      description: 'Color used for category badges on the blog.',
      options: {
        list: [
          { title: 'Coral',    value: 'coral' },
          { title: 'Orange',   value: 'orange' },
          { title: 'Purple',   value: 'purple' },
          { title: 'Charcoal', value: 'charcoal' },
        ],
        layout: 'radio',
      },
      initialValue: 'purple',
    },
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      description: 'Overrides the category name in search results (max 70 chars)',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      rows: 3,
      description: 'Meta description shown in search results (max 160 chars)',
      validation: Rule => Rule.max(160),
    },
  ],

  preview: {
    select: { title: 'name', subtitle: 'slug.current' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Untitled category',
      subtitle: subtitle ? `/blog/category/${subtitle}` : 'No slug set',
    }),
  },

  orderings: [
    { title: 'Name A-Z', name: 'nameAsc', by: [{ field: 'name', direction: 'asc' }] },
  ],
}
