import { ImageGeneratorInput } from '../../components/ImageGeneratorInput'
import { withImageGenerator } from '../../lib/withImageGenerator'

export default {
  name: 'blogImage',
  title: 'Image',
  type: 'object',

  fields: [
    ...withImageGenerator('image'),
    {
      name: 'alt',
      title: 'Alt Text',
      type: 'string',
      description: 'Describe the image for accessibility and SEO.',
      validation: Rule => Rule.required(),
    },
    {
      name: 'caption',
      title: 'Caption',
      type: 'string',
    },
    {
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Full Width',   value: 'full-width' },
          { title: 'Float Left',   value: 'left-float' },
          { title: 'Float Right',  value: 'right-float' },
          { title: 'Side by Side', value: 'side-by-side' },
        ],
        layout: 'radio',
      },
      initialValue: 'full-width',
    },
    {
      name: 'secondImagePrompt',
      title: 'Second image prompt',
      type: 'text',
      rows: 3,
      description: 'Describe the second image to generate (optional).',
      hidden: ({ parent }) => parent?.layout !== 'side-by-side',
    },
    {
      name: 'secondImage',
      title: 'Second Image (Side by Side)',
      type: 'image',
      options: { hotspot: true },
      components: { input: ImageGeneratorInput },
      hidden: ({ parent }) => parent?.layout !== 'side-by-side',
    },
    {
      name: 'secondAlt',
      title: 'Second Image Alt Text',
      type: 'string',
      hidden: ({ parent }) => parent?.layout !== 'side-by-side',
    },
    {
      name: 'secondCaption',
      title: 'Second Image Caption',
      type: 'string',
      hidden: ({ parent }) => parent?.layout !== 'side-by-side',
    },
  ],

  preview: {
    select: { title: 'alt', subtitle: 'layout', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({
      title: title || 'Image',
      subtitle: subtitle || 'full-width',
      media,
    }),
  },
}
