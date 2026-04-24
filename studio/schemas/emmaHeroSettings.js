export default {
  name: 'emmaHeroSettings',
  title: "Emma's hero (homepage)",
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'heroVariant',
      title: 'Hero variant',
      type: 'string',
      description:
        'Which editorial hero treatment to render on the homepage. Falls back to "loving" if unset.',
      options: {
        list: [
          { title: 'Currently loving (single product)', value: 'loving' },
          { title: 'Recommends a pair (bundle)',       value: 'bundle' },
          { title: 'Emma says (pull quote)',           value: 'quote'  },
        ],
        layout: 'radio',
      },
      initialValue: 'loving',
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow (optional)',
      type: 'string',
      description: 'Small label above the headline — e.g. "Currently loving" or "Emma recommends · a pair". Leave blank for variant default.',
    },
    {
      name: 'headline',
      title: 'Headline (optional)',
      type: 'string',
      description: 'Display headline. Falls back to product title if empty.',
    },
    {
      name: 'body',
      title: 'Body copy (optional)',
      type: 'text',
      rows: 3,
      description: "Short editorial paragraph. Keep it Emma-voice — first-person, warm, no sales language.",
    },
    {
      name: 'aside',
      title: 'Emma aside (optional)',
      type: 'text',
      rows: 2,
      description: 'First-person one-liner ("been living on my desk," etc). Shown on loving/bundle variants.',
    },
    {
      name: 'pullQuote',
      title: 'Pull quote (quote variant only)',
      type: 'text',
      rows: 3,
      description: 'Featured quote when heroVariant = "quote". Shown large on cream card.',
    },
    {
      name: 'pairProductHandle',
      title: 'Pair product handle (bundle variant only)',
      type: 'string',
      description: 'Shopify handle of the second product shown alongside the live pick when heroVariant = "bundle".',
    },
  ],
  preview: {
    select: { variant: 'heroVariant', headline: 'headline' },
    prepare: ({ variant, headline }) => ({
      title: "Emma's hero",
      subtitle: headline
        ? `${variant ?? 'loving'} · ${headline}`
        : (variant ?? 'loving'),
    }),
  },
}
