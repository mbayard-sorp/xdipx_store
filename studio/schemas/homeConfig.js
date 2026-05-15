// Home Config singleton — controls the discovery home page rebuild.
// Additive; does not touch any existing schema files.
//
// Singleton _id: singleton.homeConfig
// Editors flip activeVariant without a redeploy; emmaCopyOverrides let them
// override Emma's AI-generated intro/contextual copy per chip-combination.

const MAX_COPY_LENGTH = 240

function maxLength(max) {
  return {
    name: 'maxLength',
    title: `Max ${max} characters`,
    validate: (Rule) => Rule.max(max).warning(`Keep this under ${max} characters.`),
  }
}

export default {
  name: 'homeConfig',
  title: 'Home Config',
  type: 'document',
  // Singleton — prevent editors creating extra docs via Studio list view.
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'activeVariant',
      title: 'Active variant',
      type: 'string',
      description:
        'Which home page experience to serve. "Off" falls back to the legacy home page. Changes propagate within 5 minutes (CDN/KV TTL).',
      options: {
        list: [
          { title: 'Variant A - The Compass', value: 'a' },
          { title: 'Variant B - Emma Asks', value: 'b' },
          { title: 'Off (use legacy home)', value: 'off' },
        ],
        layout: 'radio',
      },
      initialValue: 'a',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'welcomeBackEnabled',
      title: 'Welcome-back message enabled',
      type: 'boolean',
      description:
        'When on, returning visitors see a personalised intro chip summary ("Back for more? Here is where you left off."). Disable for a cleaner first-time flow.',
      initialValue: true,
    },
    {
      name: 'emmaCopyOverrides',
      title: "Emma copy overrides",
      type: 'object',
      description:
        'Optional Emma-voice overrides for each chip-combination state. Leave blank to use the AI-generated defaults. Max 240 chars each.',
      fields: [
        {
          name: 'intro',
          title: 'Intro (no chips selected)',
          type: 'text',
          rows: 2,
          description: 'Shown before the visitor picks any chips.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'moodOnly',
          title: 'Mood only',
          type: 'text',
          rows: 2,
          description: 'Mood chips selected; no audience or matters.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'audOnly',
          title: 'Audience only',
          type: 'text',
          rows: 2,
          description: 'Audience chips selected; no mood or matters.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'mattersOnly',
          title: 'Matters only',
          type: 'text',
          rows: 2,
          description: 'Matters chips selected; no mood or audience.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'moodAud',
          title: 'Mood + Audience',
          type: 'text',
          rows: 2,
          description: 'Both mood and audience selected; no matters.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'moodMatters',
          title: 'Mood + Matters',
          type: 'text',
          rows: 2,
          description: 'Both mood and matters selected; no audience.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'audMatters',
          title: 'Audience + Matters',
          type: 'text',
          rows: 2,
          description: 'Both audience and matters selected; no mood.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
        {
          name: 'full',
          title: 'Full (all three chip groups)',
          type: 'text',
          rows: 2,
          description: 'Mood, audience, and matters all selected.',
          validation: (Rule) => Rule.max(MAX_COPY_LENGTH),
        },
      ],
    },
    {
      name: 'analyticsLabel',
      title: 'Analytics label (GA4 dimension)',
      type: 'string',
      description:
        'Optional label forwarded as a GA4 custom dimension to slice A/B data in reports. Example: "compass-v1" or "emma-asks-v2". Leave blank if not needed.',
      initialValue: '',
    },
  ],
  preview: {
    select: { variant: 'activeVariant', label: 'analyticsLabel' },
    prepare: ({ variant, label }) => ({
      title: 'Home Config',
      subtitle: label ? `variant: ${variant ?? 'a'} · ${label}` : `variant: ${variant ?? 'a'}`,
    }),
  },
}
