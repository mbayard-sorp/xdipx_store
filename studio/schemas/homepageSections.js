export default {
  name: 'homepageSections',
  title: 'Homepage Sections',
  type: 'document',
  __experimental_actions: ['update', 'publish'],   // singleton — no create/delete
  fields: [
    {
      name: 'sections',
      title: 'Content Sections',
      description: 'Add, remove, and reorder homepage content blocks. Set "order" to control position.',
      type: 'array',
      of: [
        { type: 'announcementBar'    },
        { type: 'promoBanner'        },
        { type: 'editorialTiles'     },
        { type: 'categoryGrid'       },
        { type: 'productCarousel'    },
        { type: 'playTogetherBanner' },
        { type: 'brandLogoWall'      },
        { type: 'testimonials'       },
        { type: 'bonusDeal'          },
        { type: 'trustBar'           },
        { type: 'richText'           },
      ],
    },
  ],
  preview: { prepare: () => ({ title: 'Homepage Sections' }) },
}
