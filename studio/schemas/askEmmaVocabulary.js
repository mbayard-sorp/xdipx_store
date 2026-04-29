// Bulk-import / Collection Ask Emma — controlled vocabulary singleton.
// Powers the mood / audience / matters tag filters on the Collection page
// and the Ask Emma chat. Emma generates against this list at import time so
// URL params like `?matters=soft-touch` round-trip cleanly.
// Editors revise as preferences shift; the orchestrator reads current values
// at generation time and prefers (but is not constrained to) these labels.
export default {
  name: 'askEmmaVocabulary',
  title: 'Ask Emma vocabulary',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton — no create/delete
  fields: [
    {
      name: 'mood',
      title: 'Mood labels',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugified (kebab-case). Example: slow-and-intimate, playful, adventurous, unhurried-solo.',
    },
    {
      name: 'audience',
      title: 'Audience labels',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugified. Example: me, us, gift.',
    },
    {
      name: 'matters',
      title: 'What-matters labels',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Slugified. Example: quiet, soft-touch, travel-size, first-time, waterproof, rechargeable, hands-free.',
    },
  ],
  preview: {
    prepare: () => ({
      title: 'Ask Emma vocabulary',
      subtitle: 'mood · audience · matters',
    }),
  },
}
