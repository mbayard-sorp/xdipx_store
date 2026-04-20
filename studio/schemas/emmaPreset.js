export default {
  name: 'emmaPreset',
  title: "Emma's preset",
  type: 'document',
  fields: [
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      description: 'Short label shown in the Ask Emma rail — e.g. "Emma\'s first-timer shelf".',
      validation: (Rule) => Rule.required().max(60),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'URL-safe key — used when applying a preset via query string (?preset=first-timer).',
      options: { source: 'label', maxLength: 60 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'narratorCopy',
      title: 'Emma narrator line (optional)',
      type: 'text',
      rows: 2,
      description: 'Emma\'s one-liner rendered above the grid when this preset is active.',
    },
    {
      name: 'moodTags',
      title: 'Mood tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'Matches products with any of these mood_tags values.',
    },
    {
      name: 'audienceTags',
      title: 'Audience tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'me / us / gift — matches audience_tags metafield.',
    },
    {
      name: 'mattersTags',
      title: 'What matters tags',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'quiet, soft-touch, travel-size, first-time, waterproof, rechargeable, hands-free, etc.',
    },
    {
      name: 'priceMax',
      title: 'Price ceiling (USD, optional)',
      type: 'number',
      description: 'Hide products over this price when the preset is active.',
      validation: (Rule) => Rule.min(0),
    },
    {
      name: 'featured',
      title: 'Featured in rail',
      type: 'boolean',
      description: 'Show this preset in the Ask Emma rail. Unchecked = hidden but still linkable.',
      initialValue: true,
    },
    {
      name: 'order',
      title: 'Sort order',
      type: 'number',
      description: 'Lower numbers render first in the rail.',
      initialValue: 0,
    },
  ],
  preview: {
    select: { label: 'label', priceMax: 'priceMax', featured: 'featured' },
    prepare: ({ label, priceMax, featured }) => ({
      title: label,
      subtitle: [priceMax ? `≤ $${priceMax}` : null, featured === false ? 'hidden' : null]
        .filter(Boolean)
        .join(' · ') || 'featured',
    }),
  },
  orderings: [
    { title: 'Sort order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] },
  ],
}
