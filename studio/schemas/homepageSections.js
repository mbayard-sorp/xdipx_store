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
        { type: 'reference', name: 'emmaCuratedRailRef', title: 'Emma Curated Rail',
          to: [{ type: 'emmaCuratedRail' }] },
        { type: 'playTogetherBanner' },
        { type: 'brandLogoWall'      },
        { type: 'testimonials'       },
        { type: 'bonusDeal'          },
        { type: 'trustBar'           },
        { type: 'richText'           },
        { type: 'editorBio'          },
      ],
    },
  ],
  preview: { prepare: () => ({ title: 'Homepage Sections' }) },
}
