/**
 * mfgProductSpecs — Manufacturer product specifications.
 *
 * NEW doc type (Phase 6d). Additive only — does not modify any existing schema.
 *
 * Primary join key: productHandle (matches Shopify product.handle).
 * Secondary key:    productGid (Shopify GID for belt-and-suspenders lookups).
 *
 * All spec fields are optional — extractor leaves fields null rather than guess.
 * The sourceVersion field tracks which extraction path populated the doc.
 */

export default {
  name: 'mfgProductSpecs',
  title: 'Manufacturer Specs',
  type: 'document',

  fields: [
    // ── Identity ─────────────────────────────────────────────────────────────
    {
      name: 'productHandle',
      title: 'Product Handle',
      type: 'string',
      description: 'Shopify product.handle — primary join key to productPage and Shopify.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'productGid',
      title: 'Product GID',
      type: 'string',
      description: 'Shopify GID (gid://shopify/Product/…) — belt-and-suspenders fallback lookup.',
    },
    {
      name: 'lastSyncedAt',
      title: 'Last Synced At',
      type: 'datetime',
      description: 'ISO timestamp of the most recent extractor run for this product.',
    },
    {
      name: 'sourceVersion',
      title: 'Source Version',
      type: 'string',
      description: 'Which extraction path populated this doc: nalpac-csv-v1 | description-parse-v1 | manual.',
      options: {
        list: [
          { title: 'Nalpac CSV v1',         value: 'nalpac-csv-v1'          },
          { title: 'Description parse v1',  value: 'description-parse-v1'   },
          { title: 'Manual',                value: 'manual'                  },
        ],
      },
    },

    // ── Structured spec fields (all optional) ─────────────────────────────────
    {
      name: 'dimensions',
      title: 'Dimensions',
      type: 'string',
      description: 'e.g. 7.5" L x 1.5" W — insertable length and girth or overall footprint.',
    },
    {
      name: 'weightG',
      title: 'Weight (grams)',
      type: 'number',
      description: 'Net weight in grams (without packaging).',
      validation: Rule => Rule.min(0),
    },
    {
      name: 'material',
      title: 'Material',
      type: 'string',
      description: 'Primary body material — e.g. silicone, ABS plastic, TPE, stainless steel.',
    },
    {
      name: 'batteryLifeMinutes',
      title: 'Battery Life (minutes)',
      type: 'number',
      description: 'Claimed run time on a full charge in minutes.',
      validation: Rule => Rule.min(0),
    },
    {
      name: 'chargingPort',
      title: 'Charging Port / Power Source',
      type: 'string',
      description: 'e.g. magnetic, USB-C, micro-USB, replaceable AA.',
    },
    {
      name: 'waterproofRating',
      title: 'Waterproof Rating',
      type: 'string',
      description: 'e.g. IPX7, splashproof, fully submersible, not waterproof.',
    },
    {
      name: 'noiseLevelDb',
      title: 'Noise Level (dB)',
      type: 'number',
      description: 'Measured or manufacturer-stated noise level in decibels.',
      validation: Rule => Rule.min(0).max(120),
    },
    {
      name: 'connectivity',
      title: 'Connectivity / Control',
      type: 'string',
      description: 'e.g. app-controlled (Bluetooth), remote, none.',
    },
    {
      name: 'compatibleLubes',
      title: 'Compatible Lubricants',
      type: 'array',
      description: 'Lube types that are safe with this material — e.g. water-based, silicone.',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
    },
    {
      name: 'careInstructions',
      title: 'Care Instructions',
      type: 'text',
      rows: 3,
      description: 'Verbatim or cleaned manufacturer care guidance.',
    },
    {
      name: 'manufacturerNotes',
      title: 'Manufacturer Notes',
      type: 'text',
      rows: 4,
      description: 'Free-form catch-all for spec details that do not fit the structured fields above.',
    },
  ],

  preview: {
    select: {
      title:    'productHandle',
      subtitle: 'sourceVersion',
    },
    prepare: ({ title, subtitle }) => ({
      title:    title    || 'Unknown product',
      subtitle: subtitle || 'no source',
    }),
  },

  orderings: [
    { title: 'Handle A-Z',       name: 'handleAsc',       by: [{ field: 'productHandle', direction: 'asc'  }] },
    { title: 'Last synced (new)', name: 'lastSyncedDesc',  by: [{ field: 'lastSyncedAt',  direction: 'desc' }] },
  ],
}
