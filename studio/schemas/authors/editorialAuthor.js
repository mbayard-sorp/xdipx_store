// Voice profile for AI-generated content.
// Each author composes a system-prompt suffix on top of the base xdipx voice.
// Emma is the primary author; future authors (e.g. expert reviewer, science writer)
// reuse the bank but shift tone. Read by app/lib/claude.server.ts at gen-time.
// Additive — does not modify the existing `editor` singleton.
export default {
  name: 'editorialAuthor',
  title: 'Editorial Author',
  type: 'document',
  fields: [
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 64 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'personaSummary',
      title: 'Persona summary',
      type: 'text',
      rows: 2,
      description: 'One-paragraph who-they-are. Shown to the model as voice context.',
    },
    {
      name: 'voiceRules',
      title: 'Voice rules',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Bullet rules appended to the base brand-voice system prompt at gen-time. One rule per line.',
    },
    {
      name: 'keywordContentTypes',
      title: 'Content types this author writes',
      type: 'array',
      of: [
        {
          type: 'string',
          options: {
            list: [
              { title: 'Product PDP copy', value: 'pdp' },
              { title: 'Blog article', value: 'blog' },
              { title: 'FAQ', value: 'faq' },
              { title: 'Collection page', value: 'collection' },
              { title: 'Email', value: 'email' },
            ],
          },
        },
      ],
    },
    {
      name: 'seoMode',
      title: 'SEO targeting mode',
      type: 'string',
      options: {
        list: [
          { title: 'Aggressive — primary in title + first 100 words, all secondaries woven', value: 'aggressive' },
          { title: 'Natural — only weave when genuinely fitting (default)', value: 'natural' },
          { title: 'Off — ignore the keyword bank', value: 'off' },
        ],
        layout: 'radio',
      },
      initialValue: 'natural',
    },
    {
      name: 'avatarUrl',
      title: 'Avatar URL',
      type: 'string',
      description: 'Optional override; otherwise uses the editor singleton avatar for byline rendering.',
    },
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
    },
  ],
  preview: {
    select: { name: 'name', mode: 'seoMode', active: 'active' },
    prepare: ({ name, mode, active }) => ({
      title: name,
      subtitle: `${mode ?? 'natural'}${active === false ? ' · INACTIVE' : ''}`,
    }),
  },
}
