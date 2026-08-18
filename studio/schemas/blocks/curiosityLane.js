// Curiosity Shelf lane (Nº 07) — one named "appetite" pill + its curated deck +
// the backfill rule that keeps the lane alive on a day nobody curates.
//
// ADDITIVE object type: it is registered in schemaTypes/index.js and referenced
// only by the new `curiosityShelf` singleton. It edits no existing schema.
//
// The `key` is the stable id used for the default-lane rotation and analytics, so
// renaming a `label` daily does not churn analytics. `productHandles` are the
// curated deck (bare Shopify handles, pinned to the front and never rotated);
// `backfill.typeDial` is the category floor that makes an absurd result (jeans
// under a "something that hums" query) impossible.
export default {
  name: 'curiosityLane',
  title: 'Curiosity lane',
  type: 'object',
  fields: [
    {
      name: 'label',
      title: 'Pill label',
      type: 'string',
      description:
        'The pill. An appetite, not a taxonomy word — "Something that hums", never "Vibrator". Voice-gated. Max 16 chars so it wraps two-per-line at 375px.',
      validation: (Rule) => Rule.required().max(16),
    },
    {
      name: 'key',
      title: 'Key',
      type: 'string',
      description:
        'Stable id for rotation + analytics (lowercase, hyphenated). Keep it fixed even when the label changes, e.g. "hands-free".',
      validation: (Rule) =>
        Rule.required().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
          name: 'kebab-case',
          invert: false,
        }),
    },
    {
      name: 'emmaLine',
      title: "Emma's line",
      type: 'string',
      description:
        'One line, shown under the pills when this lane is selected. Emma voice, no em-dashes, no lived experience. Max 90 chars.',
      validation: (Rule) => Rule.max(90),
    },
    {
      name: 'productHandles',
      title: 'Curated products',
      type: 'array',
      of: [{ type: 'string' }],
      description:
        'Bare Shopify handles, in order. Pinned to the front of the shelf and never rotated. Leave empty for pure algorithmic backfill.',
      validation: (Rule) => Rule.max(12),
    },
    {
      name: 'backfill',
      title: 'Backfill rule',
      type: 'object',
      description: 'Fills the deck to twelve and keeps the lane alive on a day nobody curates.',
      fields: [
        {
          name: 'typeDial',
          title: 'Type floor',
          type: 'string',
          description:
            'The category floor. Required unless six curated products are set. A backfilled product must match this type — there is no cross-type relaxation.',
          options: {
            list: [
              'vibrator', 'dildo', 'anal', 'bondage', 'cock-ring', 'stroker',
              'couples', 'harness', 'extender', 'pump', 'lube', 'massage',
              'enhancer', 'wear', 'condom', 'wellness', 'novelty', 'book-media',
              'sex-machine',
            ],
          },
        },
        {
          name: 'mood',
          title: 'Mood',
          type: 'string',
          description:
            'Optional. One mood tag from the live vocab (matching casing). Scored, not filtered hard — a value that matches nothing simply does not reorder.',
        },
        {
          name: 'minPrice',
          title: 'Min price ($)',
          type: 'number',
          validation: (Rule) => Rule.min(0).max(500),
        },
        {
          name: 'maxPrice',
          title: 'Max price ($)',
          type: 'number',
          description: 'Overrides the global $150 shelf ceiling when a lane wants to sell up.',
          validation: (Rule) => Rule.min(0).max(500),
        },
      ],
    },
    {
      name: 'seeAllHandle',
      title: 'See-all collection handle',
      type: 'string',
      description:
        'Bare collection handle for "See the full fit →". Validated against the live collection list at build; falls back to best-sellers if unknown.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'enabled',
      title: 'Enabled',
      type: 'boolean',
      description: 'Hide a lane without deleting its curation.',
      initialValue: true,
    },
  ],
  preview: {
    select: { title: 'label', subtitle: 'key', enabled: 'enabled' },
    prepare: ({ title, subtitle, enabled }) => ({
      title: title || 'Untitled lane',
      subtitle: `${subtitle || 'no key'}${enabled === false ? ' · disabled' : ''}`,
    }),
  },
}
