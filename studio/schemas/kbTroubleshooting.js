/**
 * kbTroubleshooting — many. Troubleshooting guides surfaced by the
 * kbLookup tool for SMS / IVR / chat. Additive — does not touch existing schema.
 */
export default {
  name: 'kbTroubleshooting',
  title: 'KB: Troubleshooting Guide',
  type: 'document',
  description: 'A troubleshooting guide surfaced by the kbLookup tool. Matched by product category and keyword overlap with symptoms.',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'Short descriptive title, e.g. "Device won\'t charge".',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'productCategory',
      title: 'Product category',
      type: 'string',
      description: 'Matches against the productTypeDial on productPage. e.g. "air-pulsation", "vibrator", "wand". Leave blank to apply to all categories.',
    },
    {
      name: 'symptoms',
      title: 'Symptom keywords',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Keywords the kbLookup tool matches against the user\'s query. e.g. ["won\'t charge", "not charging", "dead battery"]. Lowercase.',
      options: {
        layout: 'tags',
      },
      validation: (Rule) => Rule.required().min(1),
    },
    {
      name: 'quickAnswer',
      title: 'Quick answer (SMS / IVR)',
      type: 'string',
      description: 'Max 280 chars. Used verbatim in SMS replies and IVR slots. Plain text only.',
      validation: (Rule) => Rule.required().max(280),
    },
    {
      name: 'body',
      title: 'Full guide (rich text)',
      type: 'array',
      of: [
        {
          type: 'block',
          styles: [
            { title: 'Normal', value: 'normal' },
            { title: 'Heading 3', value: 'h3' },
          ],
          lists: [
            { title: 'Bullet', value: 'bullet' },
            { title: 'Numbered', value: 'number' },
          ],
          marks: {
            decorators: [
              { title: 'Bold', value: 'strong' },
              { title: 'Italic', value: 'em' },
            ],
          },
        },
      ],
      description: 'Full troubleshooting steps — rendered in web-chat richer surface and admin preview.',
    },
  ],
  preview: {
    select: { title: 'title', productCategory: 'productCategory', symptoms: 'symptoms' },
    prepare: ({ title, productCategory, symptoms }) => ({
      title: title || 'Untitled guide',
      subtitle: [productCategory || 'all categories', Array.isArray(symptoms) ? symptoms.slice(0, 3).join(', ') : ''].filter(Boolean).join(' — '),
    }),
  },
  orderings: [
    { title: 'Title (A-Z)', name: 'titleAsc', by: [{ field: 'title', direction: 'asc' }] },
    { title: 'Category (A-Z)', name: 'categoryAsc', by: [{ field: 'productCategory', direction: 'asc' }] },
  ],
}
