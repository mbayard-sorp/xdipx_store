import { withImageGenerator } from '../lib/withImageGenerator'

export default {
  name: 'blogAuthor',
  title: 'Blog Author',
  type: 'document',

  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 96 },
      validation: Rule => Rule.required(),
    },
    {
      name: 'role',
      title: 'Role',
      type: 'string',
      description: 'e.g. "Wellness Editor", "Guest Contributor"',
    },
    {
      name: 'bio',
      title: 'Bio',
      type: 'text',
      rows: 3,
    },
    ...withImageGenerator('avatar'),
    {
      name: 'socialLinks',
      title: 'Social Links',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'platform',
              title: 'Platform',
              type: 'string',
              options: {
                list: [
                  { title: 'X / Twitter', value: 'x' },
                  { title: 'Instagram',   value: 'instagram' },
                  { title: 'TikTok',      value: 'tiktok' },
                  { title: 'LinkedIn',     value: 'linkedin' },
                  { title: 'Website',      value: 'website' },
                ],
              },
            },
            {
              name: 'url',
              title: 'URL',
              type: 'url',
            },
          ],
          preview: {
            select: { title: 'platform', subtitle: 'url' },
          },
        },
      ],
    },
  ],

  preview: {
    select: { title: 'name', subtitle: 'role', media: 'avatar' },
  },
}
