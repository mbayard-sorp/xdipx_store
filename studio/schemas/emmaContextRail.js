export default {
  name: 'emmaContextRail',
  title: 'Emma Context Rail',
  type: 'document',
  description: 'An AI-curated product rail that renders under the hero deal. Edit the brief — the generation layer fills in picks. Studio is the admin UI.',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      description: 'Shown above the rail, e.g. "Pairs with today\'s deal".',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 80 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Pairing (goes with)',       value: 'pairing' },
          { title: 'Alternative (not for you)', value: 'alternative' },
          { title: 'Adjacent (same vibe)',      value: 'adjacent' },
        ],
        layout: 'radio',
      },
      initialValue: 'pairing',
    },
    {
      name: 'emmaBrief',
      title: 'Emma brief',
      type: 'text',
      rows: 4,
      description: 'The instruction Emma reads to pick products. Emma voice applies; no "Buy now", no countdowns.',
      validation: (Rule) => Rule.required().min(10),
    },

    // ─── Candidate Source ───────────────────────────────────────────────
    {
      name: 'source',
      title: 'Candidate source',
      type: 'string',
      options: {
        list: [
          { title: 'Shopify Tag',        value: 'tag' },
          { title: 'Shopify Collection', value: 'collection' },
          { title: 'Manual (product GIDs)', value: 'manual' },
        ],
        layout: 'radio',
      },
      initialValue: 'tag',
    },
    {
      name: 'shopifyTag',
      title: 'Shopify Tag',
      type: 'string',
      description: 'Tag to query (e.g. "lubricants", "wellness").',
      hidden: ({ parent }) => parent?.source !== 'tag',
    },
    {
      name: 'collectionHandle',
      title: 'Collection Handle',
      type: 'string',
      description: 'Shopify collection handle (e.g. "best-sellers").',
      hidden: ({ parent }) => parent?.source !== 'collection',
    },
    {
      name: 'productGids',
      title: 'Product GIDs',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Shopify product GIDs (gid://shopify/Product/...). Max 40.',
      hidden: ({ parent }) => parent?.source !== 'manual',
    },

    // ─── Pool sizing ────────────────────────────────────────────────────
    {
      name: 'maxPicks',
      title: 'Max picks (generation pool)',
      type: 'number',
      description: 'How many picks Emma writes. 8–12 is typical; larger = more variety across visitors.',
      initialValue: 10,
      validation: (Rule) => Rule.min(3).max(12),
    },
    {
      name: 'displayCount',
      title: 'Display count',
      type: 'number',
      description: 'How many cards each visitor sees. Subset is chosen deterministically from the pool.',
      initialValue: 4,
      validation: (Rule) => Rule.min(1).max(12),
    },

    // ─── Display settings ───────────────────────────────────────────────
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      description: 'If off, the rail is hidden on the homepage regardless of picks.',
      initialValue: true,
    },
    {
      name: 'sortOrder',
      title: 'Sort order',
      type: 'number',
      description: 'Lower = higher on the page.',
      initialValue: 0,
    },

    // ─── AI-written: current generation ─────────────────────────────────
    {
      name: 'current',
      title: 'Current picks (AI-written)',
      type: 'object',
      description: 'Written by the generation layer. Edit pairingWhy inline; everything else regenerates on brief change or midnight rotation.',
      fields: [
        { name: 'dealHandle',   title: 'For deal handle', type: 'string',   readOnly: true },
        { name: 'generatedAt',  title: 'Generated at',    type: 'datetime', readOnly: true },
        { name: 'briefHash',    title: 'Brief hash',      type: 'string',   readOnly: true,
          description: 'sha256 of the editable parts of the brief — changes invalidate picks.' },
        { name: 'trigger',      title: 'Last trigger',    type: 'string',   readOnly: true,
          description: "midnight | admin | brief_change | lazy | agent" },
        { name: 'model',        title: 'Model',           type: 'string',   readOnly: true },
        { name: 'inputTokens',  title: 'Input tokens',    type: 'number',   readOnly: true },
        { name: 'outputTokens', title: 'Output tokens',   type: 'number',   readOnly: true },
        {
          name: 'picks',
          title: 'Picks',
          type: 'array',
          of: [{
            type: 'object',
            name: 'emmaRailPick',
            fields: [
              { name: 'productGid', title: 'Product GID', type: 'string', readOnly: true },
              { name: 'handle',     title: 'Shopify handle', type: 'string', readOnly: true },
              {
                name: 'pairingWhy',
                title: "Emma's aside",
                type: 'text',
                rows: 2,
                description: 'First-person Emma aside shown on the card. Editable.',
              },
              { name: 'rank',   title: 'Rank',   type: 'number',  readOnly: true },
              { name: 'edited', title: 'Edited', type: 'boolean', initialValue: false },
            ],
            preview: {
              select: { title: 'handle', subtitle: 'pairingWhy' },
              prepare: ({ title, subtitle }) => ({
                title: title || '(no handle)',
                subtitle: subtitle ? subtitle.slice(0, 80) : '',
              }),
            },
          }],
        },
      ],
    },

    // ─── AI-written: last failure ───────────────────────────────────────
    {
      name: 'lastError',
      title: 'Last generation error',
      type: 'object',
      description: 'Populated when generation fails so editors/agents can see why. Cleared on next success.',
      fields: [
        { name: 'reason',  title: 'Reason code', type: 'string',   readOnly: true },
        { name: 'message', title: 'Message',     type: 'text',     rows: 2, readOnly: true },
        { name: 'at',      title: 'At',          type: 'datetime', readOnly: true },
      ],
    },
  ],
  orderings: [
    { title: 'Sort order',   name: 'sortOrderAsc', by: [{ field: 'sortOrder', direction: 'asc' }] },
    { title: 'Recently generated', name: 'generatedDesc', by: [{ field: 'current.generatedAt', direction: 'desc' }] },
  ],
  preview: {
    select: {
      title: 'name',
      source: 'source',
      tag: 'shopifyTag',
      collection: 'collectionHandle',
      active: 'active',
      sortOrder: 'sortOrder',
      generatedAt: 'current.generatedAt',
      errorReason: 'lastError.reason',
    },
    prepare({ title, source, tag, collection, active, sortOrder, generatedAt, errorReason }) {
      const sourceLabel =
        source === 'collection' ? `Collection: ${collection ?? '?'}`
        : source === 'manual'   ? 'Manual'
        : `Tag: ${tag ?? '?'}`
      const status = errorReason
        ? `⚠ ${errorReason}`
        : generatedAt
          ? `✓ generated ${new Date(generatedAt).toLocaleDateString()}`
          : '— no picks yet'
      return {
        title: title ?? '(no name)',
        subtitle: `${sourceLabel} · Order ${sortOrder ?? 0} · ${active ? 'Active' : 'Hidden'} · ${status}`,
      }
    },
  },
}
