import { anchorIdField } from './anchorId'

// One subcategory shelf: an intro, why it is sorted the way it is, and four
// products. Repeatable, once per subcategory.
//
// Products resolve from the Shopify collection handle, so a shelf stays current
// without an agent touching it. `pinnedHandles` is the merchandiser's override
// for the four cards; anything short of four fills from the collection.
export default {
  name: 'shelfSection',
  title: 'Shelf',
  type: 'object',
  fields: [
    anchorIdField(),
    {
      name: 'title',
      title: 'Shelf title',
      type: 'string',
      validation: (Rule) => Rule.required().max(48),
    },
    {
      name: 'collectionHandle',
      title: 'Shopify collection handle',
      type: 'string',
      description: 'Bare handle, e.g. "vibrators". Products and count come from here.',
      validation: (Rule) =>
        Rule.required().custom((value) =>
          !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Lowercase letters, numbers and hyphens only (no slashes, no URL)',
        ),
    },
    {
      name: 'intro',
      title: 'Intro',
      type: 'text',
      rows: 2,
      description: 'One or two Emma-voice sentences on who this shelf is for.',
      validation: (Rule) => Rule.max(240),
    },
    {
      name: 'sortRationale',
      title: 'Sort rationale',
      type: 'string',
      description:
        'Why these four, in reader terms ("gentlest first"). Never surface internal scoring: no margin, no deal score, no stock depth.',
      validation: (Rule) => Rule.max(120),
    },
    {
      name: 'pinnedHandles',
      title: 'Pinned products',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Up to four product handles. Blank slots fill from the collection.',
      validation: (Rule) => Rule.max(4),
    },
    {
      name: 'seeAllLabel',
      title: 'See-all label',
      type: 'string',
      initialValue: 'See all →',
      validation: (Rule) => Rule.max(24),
    },
  ],
  preview: {
    select: { title: 'title', subtitle: 'collectionHandle' },
    prepare: ({ title, subtitle }) => ({
      title: title || 'Shelf',
      subtitle: subtitle ? `/collections/${subtitle}` : 'No collection set',
    }),
  },
}
