// The pill row under the headliner. Previously five hardcoded collection links
// in StorefrontHome; now editable, because these are merchandising decisions
// that changed on a code deploy for no good reason.
//
// A pill pointing at a dead collection ships a sitewide 404, so handles are
// validated here and checked against the live collection list at render.
export default {
  name: 'homeMoodPills',
  title: 'Mood pills',
  type: 'object',
  fields: [
    {
      name: 'enabled',
      title: 'Visible',
      type: 'boolean',
      initialValue: true,
    },
    {
      name: 'prompt',
      title: 'Prompt',
      type: 'string',
      description: 'Line above the pills.',
      validation: (Rule) => Rule.max(60),
    },
    {
      name: 'pills',
      title: 'Pills',
      type: 'array',
      validation: (Rule) => Rule.min(2).max(6),
      of: [
        {
          type: 'object',
          name: 'moodPill',
          title: 'Pill',
          fields: [
            {
              name: 'label',
              title: 'Label',
              type: 'string',
              validation: (Rule) => Rule.required().max(20),
            },
            {
              name: 'collectionHandle',
              title: 'Collection handle',
              type: 'string',
              description: 'Bare handle, e.g. "first-time". Not a URL.',
              validation: (Rule) =>
                Rule.required().custom((value) =>
                  !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
                    ? true
                    : 'Lowercase letters, numbers and hyphens only',
                ),
            },
          ],
          preview: { select: { title: 'label', subtitle: 'collectionHandle' } },
        },
      ],
    },
  ],
  preview: {
    select: { enabled: 'enabled', pills: 'pills' },
    prepare: ({ enabled, pills }) => {
      const n = Array.isArray(pills) ? pills.length : 0
      return {
        title: 'Mood pills',
        subtitle: `${n} pill${n === 1 ? '' : 's'} · ${enabled === false ? 'Hidden' : 'Visible'}`,
      }
    },
  },
}
