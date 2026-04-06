import { withImageGenerator } from '../lib/withImageGenerator'

export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'logo',
      title: 'Site Logo',
      type: 'image',
      description: 'Navbar + footer logo. PNG or SVG with transparent background recommended. Ideal size: 200×60px.',
      options: { hotspot: false },
      fields: [
        {
          name: 'alt',
          title: 'Alt text',
          type: 'string',
          description: 'Describe the logo for screen readers (e.g. "xdipx logo")',
        },
      ],
    },
    {
      name: 'megaMenuBanners',
      title: 'Mega Menu Promo Banners',
      description: 'Promotional graphics displayed alongside menu columns. Configure separate banners for the left and right sides of each top-level menu.',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          {
            name: 'menuLabel',
            title: 'Menu Label',
            type: 'string',
            description: 'Exact top-level menu label this banner appears under (e.g. "Pleasure", "Play", "Body")',
            validation: (Rule) => Rule.required(),
          },
          {
            name: 'position',
            title: 'Position',
            type: 'string',
            options: { list: ['left', 'right'], layout: 'radio' },
            initialValue: 'right',
            validation: (Rule) => Rule.required(),
          },
          {
            name: 'link',
            title: 'Link',
            type: 'string',
            description: 'URL to navigate to when clicked (e.g. /collections/vibrators)',
          },
          ...withImageGenerator('image'),
        ],
        preview: {
          select: { title: 'menuLabel', subtitle: 'position', media: 'image' },
          prepare({ title, subtitle, media }) {
            return {
              title: title ?? '(no label)',
              subtitle: subtitle ? subtitle.charAt(0).toUpperCase() + subtitle.slice(1) : 'Right',
              media,
            }
          },
        },
      }],
    },
    {
      name: 'socialLinks',
      title: 'Social Media Links',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          {
            name: 'platform',
            title: 'Platform',
            type: 'string',
            options: {
              list: [
                { title: 'X (Twitter)', value: 'x' },
                { title: 'Instagram',   value: 'instagram' },
                { title: 'TikTok',      value: 'tiktok' },
                { title: 'Facebook',    value: 'facebook' },
                { title: 'YouTube',     value: 'youtube' },
                { title: 'Pinterest',   value: 'pinterest' },
              ],
            },
          },
          { name: 'handle', title: 'Handle (e.g. hello_xdipx)', type: 'string' },
          { name: 'url',    title: 'Full URL',                   type: 'url'    },
        ],
        preview: {
          select: { title: 'platform', subtitle: 'handle' },
          prepare: ({ title, subtitle }) => ({ title: title?.toUpperCase(), subtitle: `@${subtitle}` }),
        },
      }],
    },
  ],
  preview: { prepare: () => ({ title: 'Site Settings' }) },
}
