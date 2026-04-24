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
