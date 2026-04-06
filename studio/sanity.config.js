import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {presentationTool} from 'sanity/presentation'
import {schemaTypes} from './schemaTypes'

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
              .title('Site Settings')
              .id('siteSettings')
              .icon(() => '⚙️')
              .child(S.document().schemaType('siteSettings').documentId('singleton.siteSettings')),
            S.divider(),
            S.documentTypeListItem('productPage').title('Products').icon(() => '🛍️'),
            S.documentTypeListItem('page').title('Pages').icon(() => '📄'),
          ]),
    }),
    presentationTool({
      previewUrl: {
        origin: process.env.SANITY_STUDIO_PREVIEW_URL ?? 'http://localhost:3000',
        previewMode: {
          enable: '/api/sanity-preview',
        },
      },
    }),
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
  },
})
