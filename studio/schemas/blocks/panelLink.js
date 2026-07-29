// Panel destination. Every panel resolves to a real place or it cannot publish.
//
// Adapted from the Panel Deck Handoff, which referenced `collection` and
// `article` document types. This project has neither: Shopify owns the
// collection taxonomy (read via getMainMenu/getCollectionList) and the Notebook
// uses `blogPost`. So a collection destination is a validated handle string that
// the loader checks against the live Shopify collection list, and a dead handle
// is dropped at build time rather than shipping a broken door.
export default {
  name: 'panelLink',
  title: 'Destination',
  type: 'object',
  fields: [
    {
      name: 'kind',
      title: 'Kind',
      type: 'string',
      initialValue: 'collection',
      options: {
        list: [
          { title: 'Shopify collection', value: 'collection' },
          { title: 'Notebook article', value: 'article' },
          { title: 'Route', value: 'route' },
        ],
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'collectionHandle',
      title: 'Collection handle',
      type: 'string',
      description: 'Bare Shopify handle, e.g. "pleasure". Not a URL.',
      hidden: ({ parent }) => parent?.kind !== 'collection',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          if (context.parent?.kind !== 'collection') return true
          if (!value) return 'Pick a collection handle'
          return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
            ? true
            : 'Lowercase letters, numbers and hyphens only (no slashes, no URL)'
        }),
    },
    {
      name: 'article',
      title: 'Notebook post',
      type: 'reference',
      to: [{ type: 'blogPost' }],
      hidden: ({ parent }) => parent?.kind !== 'article',
      validation: (Rule) =>
        Rule.custom((value, context) =>
          context.parent?.kind === 'article' && !value ? 'Pick a post' : true,
        ),
    },
    {
      name: 'route',
      title: 'Route',
      type: 'string',
      description: 'Site-relative path, e.g. /notebook or /new.',
      hidden: ({ parent }) => parent?.kind !== 'route',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          if (context.parent?.kind !== 'route') return true
          if (!value) return 'Enter a route'
          return /^\/[\w\-/]*$/.test(value) ? true : 'Must start with / and be a site path'
        }),
    },
  ],
  preview: {
    select: { kind: 'kind', handle: 'collectionHandle', route: 'route' },
    prepare: ({ kind, handle, route }) => ({
      title: handle || route || kind || 'Destination',
    }),
  },
}
