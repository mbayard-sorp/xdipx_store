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
        { type: 'wayfinderMosaic'    },
        // Merch components v1 — additive block registrations (see
        // docs/merch-build-plan.md + merch-spec.md). Existing entries above
        // are untouched.
        { type: 'headlinerSpotlight' },
        { type: 'curiosityRail'      },
        { type: 'curiosityChooser'   },
        { type: 'orFork'             },
        { type: 'quickNavGrid'       },
        { type: 'honestProof'        },
        { type: 'emailCaptureBand'   },
        { type: 'plpMerchHeader'     },
      ],
    },
  ],
  preview: { prepare: () => ({ title: 'Homepage Sections' }) },
}
