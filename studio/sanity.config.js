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
            S.documentTypeListItem('emmaPreset').title("Emma's presets").icon(() => '🎯'),
            S.documentTypeListItem('emmaCuratedRail').title('Emma curated rails').icon(() => '♥'),
            S.listItem()
              .title('Site Settings')
              .id('siteSettings')
              .icon(() => '⚙️')
              .child(S.document().schemaType('siteSettings').documentId('singleton.siteSettings')),
            S.divider(),
            S.documentTypeListItem('productPage').title('Products').icon(() => '🛍️'),
            S.documentTypeListItem('page').title('Pages').icon(() => '📄'),
            S.documentTypeListItem('trustItem').title('Trust Items').icon(() => '✅'),
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
                    S.divider(),
                    S.documentTypeListItem('blogPost').title('Posts').icon(() => '✍️'),
                    S.documentTypeListItem('blogCategory').title('Categories').icon(() => '🏷️'),
                    S.documentTypeListItem('blogAuthor').title('Authors').icon(() => '👤'),
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
