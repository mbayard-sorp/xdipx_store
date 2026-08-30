import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {presentationTool} from 'sanity/presentation'
import {schemaTypes} from './schemaTypes'
import {resolve} from './lib/resolve'
import {openPreviewAction, copyPreviewLinkAction} from './lib/PreviewAction'

export default defineConfig({
  name: 'default',
  title: 'xdipx.com',

  projectId: '0nlwk8cf',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            S.listItem()
              .title('Homepage Sections')
              .id('homepageSections')
              .icon(() => '🏠')
              .child(S.document().schemaType('homepageSections').documentId('singleton.homepage')),
            S.listItem()
              .title("Emma's hero")
              .id('emmaHeroSettings')
              .icon(() => '✨')
              .child(S.document().schemaType('emmaHeroSettings').documentId('singleton.emmaHero')),
            S.listItem()
              .title('Storefront hero CTA')
              .id('emmaHeroStorefront')
              .icon(() => '🔗')
              .child(S.document().schemaType('emmaHeroStorefront').documentId('singleton.emmaHeroStorefront')),
            S.listItem()
              .title('Storefront home layout')
              .id('storefrontHome')
              .icon(() => '🧱')
              .child(S.document().schemaType('storefrontHome').documentId('singleton.storefrontHome')),
            S.listItem()
              .title('Curiosity shelf')
              .id('curiosityShelf')
              .icon(() => '🔮')
              .child(S.document().schemaType('curiosityShelf').documentId('singleton.curiosityShelf')),
            S.listItem()
              .title('Panel deck')
              .id('panelDeck')
              .icon(() => '🚪')
              .child(S.document().schemaType('panelDeck').documentId('singleton.panelDeck')),
            S.documentTypeListItem('categoryPage').title('Category pages').icon(() => '🗂️'),
            S.documentTypeListItem('dropPage').title('Drop pages').icon(() => '📦'),
            S.listItem()
              .title('Home Config')
              .id('homeConfig')
              .icon(() => '🧭')
              .child(S.document().schemaType('homeConfig').documentId('singleton.homeConfig')),
            S.listItem()
              .title('Home SEO (search snippet)')
              .id('homeSeo')
              .icon(() => '🔍')
              .child(S.document().schemaType('homeSeo').documentId('singleton.homeSeo')),
            S.listItem()
              .title('Sensation dial labels')
              .id('dialRegistry')
              .icon(() => '🎚️')
              .child(S.document().schemaType('dialRegistry').documentId('singleton.dialRegistry')),
            S.listItem()
              .title('Sensation dial taxonomy')
              .id('dialTaxonomy')
              .icon(() => '📐')
              .child(S.document().schemaType('dialTaxonomy').documentId('singleton.dialTaxonomy')),
            S.listItem()
              .title('Ask Emma vocabulary')
              .id('askEmmaVocabulary')
              .icon(() => '💬')
              .child(S.document().schemaType('askEmmaVocabulary').documentId('singleton.askEmmaVocabulary')),
            S.documentTypeListItem('emmaPreset').title("Emma's presets").icon(() => '🎯'),
            S.documentTypeListItem('emmaCuratedRail').title('Emma curated rails').icon(() => '♥'),
            S.documentTypeListItem('emmaContextRail').title('Emma context rails').icon(() => '🧩'),
            S.documentTypeListItem('emmaPick').title("Emma's picks (generated)").icon(() => '💡'),
            S.listItem()
              .title('Editor (Emma)')
              .id('editor')
              .icon(() => '👩')
              .child(S.document().schemaType('editor').documentId('singleton.editor')),
            S.documentTypeListItem('castMember').title('Cast members').icon(() => '🎭'),
            S.listItem()
              .title('Site Settings')
              .id('siteSettings')
              .icon(() => '⚙️')
              .child(S.document().schemaType('siteSettings').documentId('singleton.siteSettings')),
            S.listItem()
              .title('PDP Defaults')
              .id('pdpDefaults')
              .icon(() => '🛒')
              .child(S.document().schemaType('pdpDefaults').documentId('singleton.pdpDefaults')),
            S.listItem()
              .title('Social landing (/social)')
              .id('socialLanding')
              .icon(() => '📱')
              .child(S.document().schemaType('socialLanding').documentId('singleton.socialLanding')),
            S.divider(),
            S.listItem()
              .title('SEO')
              .id('seo')
              .icon(() => '🔎')
              .child(
                S.list()
                  .title('SEO')
                  .items([
                    S.documentTypeListItem('seoKeyword').title('Keywords').icon(() => '🔑'),
                    S.documentTypeListItem('seoCluster').title('Clusters').icon(() => '🧭'),
                  ]),
              ),
            S.documentTypeListItem('editorialAuthor').title('Editorial authors').icon(() => '✒️'),
            S.divider(),
            S.documentTypeListItem('productPage').title('Products').icon(() => '🛍️'),
            S.documentTypeListItem('mfgProductSpecs').title('Manufacturer specs').icon(() => '🔧'),
            S.documentTypeListItem('page').title('Pages').icon(() => '📄'),
            S.documentTypeListItem('trustItem').title('Trust Items').icon(() => '✅'),
            S.listItem()
              .title('Collections (SEO)')
              .id('collectionsSeo')
              .icon(() => '🗂️')
              .child(
                S.list()
                  .title('Collections (SEO)')
                  .items([
                    S.listItem()
                      .title('Collections Hub')
                      .id('collectionsHub')
                      .icon(() => '🏷️')
                      .child(S.document().schemaType('collectionsHub').documentId('singleton.collectionsHub')),
                    S.divider(),
                    S.documentTypeListItem('collectionPage').title('Collection Pages').icon(() => '🗃️'),
                  ]),
              ),
            S.documentTypeListItem('comparison').title('Comparisons (vs pages)').icon(() => '⚖️'),
            S.listItem()
              .title('Knowledge Base')
              .id('knowledgeBase')
              .icon(() => '📚')
              .child(
                S.list()
                  .title('Knowledge Base')
                  .items([
                    S.documentTypeListItem('kbShippingPolicy').title('Shipping Policy').icon(() => '🚚'),
                    S.documentTypeListItem('kbReturnsPolicy').title('Returns Policy').icon(() => '↩️'),
                    S.documentTypeListItem('kbCompatibilityRule').title('Compatibility Rules').icon(() => '🔌'),
                    S.documentTypeListItem('kbTroubleshooting').title('Troubleshooting Guides').icon(() => '🛠️'),
                    S.documentTypeListItem('kbBrandFaq').title('Brand FAQ').icon(() => '❓'),
                  ]),
              ),
            S.divider(),
            S.listItem()
              .title('Blog')
              .id('blog')
              .icon(() => '📝')
              .child(
                S.list()
                  .title('Blog')
                  .items([
                    S.listItem()
                      .title('Blog Homepage')
                      .id('blogHomepage')
                      .icon(() => '🏡')
                      .child(S.document().schemaType('blogHomepage').documentId('singleton.blogHomepage')),
                    S.listItem()
                      .title('Notebook Settings')
                      .id('notebookSettings')
                      .icon(() => '📓')
                      .child(S.document().schemaType('notebookSettings').documentId('singleton.notebookSettings')),
                    S.divider(),
                    S.documentTypeListItem('blogPost').title('Posts').icon(() => '✍️'),
                    S.documentTypeListItem('blogCategory').title('Categories').icon(() => '🏷️'),
                    S.documentTypeListItem('blogAuthor').title('Authors').icon(() => '👤'),
                    S.divider(),
                    S.documentTypeListItem('blogSeries').title('Series').icon(() => '📚'),
                    S.documentTypeListItem('blogGlossaryTerm').title('Glossary').icon(() => '📖'),
                    S.documentTypeListItem('blogPostExtras').title('Post Extras').icon(() => '➕'),
                    S.documentTypeListItem('blogCategoryExtras').title('Category Extras').icon(() => '🎨'),
                  ]),
              ),
          ]),
    }),
    presentationTool({
      previewUrl: {
        origin: process.env.SANITY_STUDIO_PREVIEW_URL ?? 'http://localhost:3000',
        previewMode: {
          enable: '/api/sanity-preview',
        },
      },
      resolve,
    }),
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
  },

  document: {
    actions: (prev, context) => {
      const previewTypes = ['blogPost', 'page', 'productPage', 'homepageSections', 'blogCategory', 'blogHomepage']
      if (previewTypes.includes(context.schemaType)) {
        return [...prev, openPreviewAction, copyPreviewLinkAction]
      }
      return prev
    },
  },
})
