import { createElement } from 'react'

const RICH_TEXT_BLOCK = {
  type: 'block',
  styles: [
    { title: 'Normal',    value: 'normal' },
    { title: 'Heading 2', value: 'h2'     },
    { title: 'Heading 3', value: 'h3'     },
  ],
  lists: [
    { title: 'Bullet',   value: 'bullet'  },
    { title: 'Numbered', value: 'number'  },
  ],
  marks: {
    decorators: [
      { title: 'Bold',      value: 'strong' },
      { title: 'Italic',    value: 'em'     },
      { title: 'Underline', value: 'underline' },
    ],
    annotations: [
      {
        name: 'link', title: 'Link', type: 'object',
        fields: [{ name: 'href', title: 'URL', type: 'url' }],
      },
    ],
  },
}

export default {
  name: 'productPage',
  title: 'Product Page',
  type: 'document',

  groups: [
    { name: 'product',  title: 'Product',        default: true },
    { name: 'copy',     title: 'Copy & Story'                  },
    { name: 'deal',     title: 'Deal Settings'                 },
    { name: 'ivr',      title: 'IVR / Voice'                   },
    { name: 'bundle',   title: 'Bundle'                        },
    { name: 'content',  title: 'Content Blocks'                },
  ],

  fields: [
    // ── Preview image (auto-filled by sync, not shown in form) ───────────────
    {
      name: 'previewImageUrl',
      title: 'Preview Image URL',
      type: 'url',
      hidden: true,
    },

    // ── Internal IDs ────────────────────────────────────────────────────────
    {
      name: 'shopifyHandle',
      title: 'Shopify Handle',
      type: 'string',
      group: 'product',
      description: 'URL slug — auto-filled by the sync script. Changing this breaks the PDP link.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'shopifyProductId',
      title: 'Shopify Product ID',
      type: 'string',
      group: 'product',
      description: 'Numeric Shopify ID — auto-filled. Used to push changes back to Shopify.',
      readOnly: true,
    },

    // ── Product Details ──────────────────────────────────────────────────────
    {
      name: 'title',
      title: 'Product Title',
      type: 'string',
      group: 'product',
    },
    {
      name: 'vendor',
      title: 'Brand / Vendor',
      type: 'string',
      group: 'product',
    },
    {
      name: 'tags',
      title: 'Tags',
      type: 'array',
      group: 'product',
      description: 'Shopify tags (e.g. for-him, deal-status-live). One per item.',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
    },
    {
      name: 'description',
      title: 'Product Description',
      type: 'array',
      group: 'product',
      description: 'Shown as the product body in Shopify.',
      of: [RICH_TEXT_BLOCK],
    },
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
      group: 'product',
      description: 'Overrides the page <title> in Google. Leave blank to use product title.',
      validation: Rule => Rule.max(70),
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      group: 'product',
      rows: 3,
      validation: Rule => Rule.max(160),
    },

    // ── Copy & Story ─────────────────────────────────────────────────────────
    {
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      group: 'copy',
      description: 'Short punchy line shown under the product title on the PDP.',
    },
    {
      name: 'fullStory',
      title: 'Full Story',
      type: 'array',
      group: 'copy',
      description: 'Shown in the "The Full Story" tab on the PDP.',
      of: [RICH_TEXT_BLOCK],
    },
    {
      name: 'worksForHim',
      title: 'Works For Him',
      type: 'array',
      group: 'copy',
      description: 'Shown in the "Both Ways ♥" tab under "For Him".',
      of: [RICH_TEXT_BLOCK],
    },
    {
      name: 'worksForHer',
      title: 'Works For Her',
      type: 'array',
      group: 'copy',
      description: 'Shown in the "Both Ways ♥" tab under "For Her".',
      of: [RICH_TEXT_BLOCK],
    },
    {
      name: 'featureBullets',
      title: 'Feature Bullets',
      type: 'array',
      group: 'copy',
      description: 'Shown in "What\'s In The Box" tab and inline on the PDP hero.',
      of: [{ type: 'string' }],
    },
    {
      name: 'moodImageUrl',
      title: 'Mood / Lifestyle Image URL',
      type: 'url',
      group: 'copy',
      description: 'Full URL to a lifestyle image. Renders as PDP hero background.',
    },

    // ── Deal Settings ────────────────────────────────────────────────────────
    {
      name: 'category',
      title: 'Category',
      type: 'string',
      group: 'deal',
      options: {
        list: [
          { title: 'Both',     value: 'both'    },
          { title: 'For Him',  value: 'for-him' },
          { title: 'For Her',  value: 'for-her' },
          { title: 'Couples',  value: 'couples' },
        ],
        layout: 'radio',
      },
      initialValue: 'both',
    },
    {
      name: 'dealStatus',
      title: 'Deal Status',
      type: 'string',
      group: 'deal',
      options: {
        list: [
          { title: 'Pending Approval', value: 'pending_approval' },
          { title: 'Approved',         value: 'approved'         },
          { title: 'Live',             value: 'live'             },
          { title: 'Archived',         value: 'archived'         },
        ],
        layout: 'radio',
      },
    },
    {
      name: 'dealDate',
      title: 'Deal Date',
      type: 'date',
      group: 'deal',
      options: { dateFormat: 'YYYY-MM-DD' },
    },
    {
      name: 'originalPrice',
      title: 'MSRP / Original Price ($)',
      type: 'number',
      group: 'deal',
    },
    {
      name: 'wholesaleCost',
      title: 'Wholesale Cost ($)',
      type: 'number',
      group: 'deal',
    },
    {
      name: 'mapPrice',
      title: 'MAP Price ($)',
      type: 'number',
      group: 'deal',
      description: 'Minimum Advertised Price. 0 = no MAP.',
    },
    {
      name: 'dealScore',
      title: 'Deal Score',
      type: 'number',
      group: 'deal',
      description: 'Algorithm score 0–100. Higher = better candidate for daily deal.',
      readOnly: true,
    },
    {
      name: 'nalpacSku',
      title: 'Nalpac SKU',
      type: 'string',
      group: 'deal',
    },
    {
      name: 'archived',
      title: 'Archived',
      type: 'boolean',
      group: 'product',
      description: 'Set automatically when the linked Shopify product is no longer active. Archived docs are excluded from search.',
    },

    // ── IVR / Voice Discovery ─────────────────────────────────────────────────
    {
      name: 'ivrMood',
      title: 'Mood Tags',
      type: 'array',
      group: 'ivr',
      description: 'Mood/vibe for voice discovery queries like "something romantic" or "playful".',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'Playful',      value: 'playful'     },
          { title: 'Romantic',     value: 'romantic'     },
          { title: 'Luxurious',    value: 'luxurious'    },
          { title: 'Adventurous',  value: 'adventurous'  },
          { title: 'Relaxing',     value: 'relaxing'     },
        ],
      },
    },
    {
      name: 'ivrExperience',
      title: 'Experience Level',
      type: 'string',
      group: 'ivr',
      description: 'Used when callers say "beginner-friendly" or "something advanced".',
      options: {
        list: [
          { title: 'Beginner',      value: 'beginner'     },
          { title: 'Intermediate',  value: 'intermediate' },
          { title: 'Advanced',      value: 'advanced'     },
        ],
        layout: 'radio',
      },
    },
    {
      name: 'ivrUseCase',
      title: 'Use Case Tags',
      type: 'array',
      group: 'ivr',
      description: 'Scenarios like "date night", "gift", "travel-friendly".',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'Solo',        value: 'solo'       },
          { title: 'Couples',     value: 'couples'    },
          { title: 'Date Night',  value: 'date-night' },
          { title: 'Gift',        value: 'gift'       },
          { title: 'Travel',      value: 'travel'     },
        ],
      },
    },
    {
      name: 'ivrFeatures',
      title: 'Feature Tags',
      type: 'array',
      group: 'ivr',
      description: 'Physical features callers ask about: "is it waterproof?", "is it quiet?".',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'Waterproof',      value: 'waterproof'      },
          { title: 'Quiet',           value: 'quiet'           },
          { title: 'Rechargeable',    value: 'rechargeable'    },
          { title: 'App-controlled',  value: 'app-controlled'  },
          { title: 'Body-safe',       value: 'body-safe'       },
        ],
      },
    },
    {
      name: 'ivrVoiceSummary',
      title: 'Voice Summary',
      type: 'string',
      group: 'ivr',
      description: 'One TTS-safe sentence for the phone agent. No markdown, no URLs. Under 120 chars.',
      validation: Rule => Rule.max(120),
    },

    // ── Bundle ───────────────────────────────────────────────────────────────
    {
      name: 'isBundle',
      title: 'This product is a bundle',
      type: 'boolean',
      group: 'bundle',
      description: 'When checked, the PDP renders a multi-product bundle hero instead of a single-product layout. Shopify product still needs to exist for the handle/URL.',
      initialValue: false,
    },
    {
      name: 'bundleComponents',
      title: 'Bundle Components',
      type: 'array',
      group: 'bundle',
      description: 'Products included in this bundle. "Dip In ♥" adds each component as its own cart line.',
      hidden: ({ parent }) => !parent?.isBundle,
      of: [
        {
          type: 'object',
          name: 'bundleComponent',
          title: 'Component',
          fields: [
            {
              name: 'product',
              title: 'Product',
              type: 'reference',
              to: [{ type: 'productPage' }],
              validation: Rule => Rule.required(),
            },
            {
              name: 'quantity',
              title: 'Quantity',
              type: 'number',
              initialValue: 1,
              validation: Rule => Rule.required().integer().min(1).max(10),
            },
          ],
          preview: {
            select: { title: 'product.title', subtitle: 'product.shopifyHandle', qty: 'quantity', imageUrl: 'product.previewImageUrl' },
            prepare: ({ title, subtitle, qty, imageUrl }) => ({
              title: title || subtitle || 'Component',
              subtitle: `Qty ${qty ?? 1}${subtitle ? ` · /${subtitle}` : ''}`,
              media: imageUrl
                ? createElement('img', { src: imageUrl, style: { width: '100%', height: '100%', objectFit: 'cover' } })
                : undefined,
            }),
          },
        },
      ],
    },
    {
      name: 'bundleDiscountPct',
      title: 'Bundle Discount (%)',
      type: 'number',
      group: 'bundle',
      description: 'Percent off the combined MSRP of all components. E.g. 20 = 20% off. Applied in Shopify via an automatic discount tied to the bundle tag.',
      hidden: ({ parent }) => !parent?.isBundle,
      validation: Rule => Rule.min(0).max(90),
      initialValue: 0,
    },
    {
      name: 'bundleCompanionFor',
      title: 'Offer On These Product PDPs',
      type: 'array',
      group: 'bundle',
      description: 'Products whose PDP should show a "Bundle & Save" card pointing at this bundle. Leave empty to only surface the bundle on its own URL / homepage.',
      hidden: ({ parent }) => !parent?.isBundle,
      of: [{ type: 'reference', to: [{ type: 'productPage' }] }],
    },

    // ── Content Blocks ────────────────────────────────────────────────────────
    {
      name: 'contentBlocks',
      title: 'Content Blocks',
      type: 'array',
      group: 'content',
      description: 'Blocks that appear below the product details on the PDP.',
      of: [
        { type: 'promoBanner'        },
        { type: 'editorialTiles'     },
        { type: 'categoryGrid'       },
        { type: 'productCarousel'    },
        { type: 'playTogetherBanner' },
        { type: 'brandLogoWall'      },
        { type: 'testimonials'       },
        { type: 'trustBar'           },
      ],
    },
  ],

  preview: {
    select: { title: 'title', subtitle: 'shopifyHandle', imageUrl: 'previewImageUrl' },
    prepare: ({ title, subtitle, imageUrl }) => ({
      title:    title    || subtitle || 'Untitled product',
      subtitle: subtitle ? `/${subtitle}` : '',
      media: imageUrl
        ? createElement('img', {
            src: imageUrl,
            style: { width: '100%', height: '100%', objectFit: 'cover' },
          })
        : undefined,
    }),
  },

  orderings: [
    { title: 'Title A–Z',  name: 'titleAsc',  by: [{ field: 'title',         direction: 'asc'  }] },
    { title: 'Deal Date ↓', name: 'dealDesc', by: [{ field: 'dealDate',      direction: 'desc' }] },
    { title: 'Score ↓',     name: 'scoreDesc', by: [{ field: 'dealScore',    direction: 'desc' }] },
  ],
}
