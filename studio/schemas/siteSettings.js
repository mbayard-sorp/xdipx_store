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
