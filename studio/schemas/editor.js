import { ImageGeneratorInput } from '../components/ImageGeneratorInput'
import { withImageGenerator } from '../lib/withImageGenerator'

export default {
  name: 'editor',
  title: 'Editor (Emma)',
  type: 'document',
  __experimental_actions: ['update', 'publish'],

  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      initialValue: 'Emma',
      validation: Rule => Rule.required(),
    },
    {
      name: 'role',
      title: 'Role',
      type: 'string',
      initialValue: 'Editor',
      description: 'Shown under the name on /about (e.g. "Editor", "Founder & Editor").',
    },
    ...withImageGenerator('photo'),
    {
      // Additive, homepage-only. The Nº 04 "Meet Emma" band prefers this
      // situational portrait (Emma presenting a product) and falls back to
      // `photo` when it is unset. Deliberately NOT read by /about or by the
      // video pipeline's identity anchor (getEditorPhotoUrl), both of which
      // stay pinned to the canonical `photo`, so setting this here never
      // re-portraits /about or swaps the video pipeline's likeness frame.
      // A standalone image field (not withImageGenerator) so it can carry the
      // ImageGeneratorInput without a second `imagePrompt` field colliding
      // with `photo`'s.
      name: 'homepagePhoto',
      title: 'Homepage portrait (Nº 04 Meet Emma)',
      type: 'image',
      description: 'Optional situational portrait for the homepage Meet Emma band only. Falls back to Photo above when empty. Does not affect /about or the video pipeline.',
      options: { hotspot: true },
      components: { input: ImageGeneratorInput },
      fields: [
        {
          name: 'alt',
          title: 'Alt text',
          type: 'string',
          description: 'Describe the portrait for screen readers (e.g. "Emma holding a product beside her face on a soft coral background").',
        },
      ],
    },
    {
      name: 'shortBio',
      title: 'Short bio',
      type: 'text',
      rows: 3,
      description: 'One to two sentences, first-person. Shown on hero byline tooltip and card previews.',
      validation: Rule => Rule.max(280),
    },
    {
      name: 'longBio',
      title: 'Long bio',
      type: 'array',
      of: [{ type: 'block' }],
      description: 'Full bio for /about. Portable text — paragraphs, emphasis, links.',
    },
    {
      name: 'picksSince',
      title: 'Picking since',
      type: 'date',
      description: 'Shown as "editor since {month year}" in the hero byline.',
      options: { dateFormat: 'YYYY-MM-DD' },
    },
    {
      name: 'instagram',
      title: 'Instagram URL',
      type: 'url',
    },
    {
      name: 'email',
      title: 'Contact email',
      type: 'string',
    },
  ],

  preview: {
    select: { title: 'name', subtitle: 'role', media: 'photo' },
  },
}
