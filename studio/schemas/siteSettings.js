import { ImageGeneratorInput } from '../components/ImageGeneratorInput'
import { withImageGenerator } from '../lib/withImageGenerator'

export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'logoPrompt',
      title: 'Logo prompt',
      type: 'text',
      rows: 3,
      description: 'Describe the logo to generate (optional). Used by the ✦ Generate button on the Site Logo field.',
    },
    {
      name: 'logo',
      title: 'Site Logo',
      type: 'image',
      description: 'Navbar + footer logo. PNG or SVG with transparent background recommended. Ideal size: 200×60px.',
      options: { hotspot: false },
      components: { input: ImageGeneratorInput },
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
      name: 'siteBanner',
      title: 'Site Banner',
      description: 'Wide promotional banner displayed site-wide beneath the trust bar. Toggle off to hide.',
      type: 'object',
      fields: [
        {
          name: 'enabled',
          title: 'Show banner',
          type: 'boolean',
          initialValue: false,
        },
        ...withImageGenerator('image'),
        {
          name: 'alt',
          title: 'Alt text',
          type: 'string',
          description: 'Describe the banner for screen readers.',
        },
        {
          name: 'link',
          title: 'Link URL (optional)',
          type: 'string',
          description: 'Internal path (e.g. /vault) or full URL. Leave blank for a non-clickable banner.',
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
      name: 'buyButtonText',
      title: 'Buy Button Text',
      type: 'string',
      description: 'Label for all add-to-cart buttons across the site (e.g. "I Want It ❤️"). Defaults to "I Want It ❤️" if empty.',
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
    {
      name: 'footerTagline',
      title: 'Footer Tagline',
      type: 'string',
      description: 'Short tagline under the logo (e.g. "One deal. Every day. For everyone. ♥")',
    },
    {
      name: 'footerDiscreetHeading',
      title: 'Discretion Box Heading',
      type: 'string',
      description: 'Bold heading in the discretion box (e.g. "Plain packaging, always.")',
    },
    {
      name: 'footerDiscreetBody',
      title: 'Discretion Box Body',
      type: 'text',
      rows: 2,
      description: 'Body text in the discretion box (e.g. "Orders ship in unmarked boxes. Billing appears as XD Inc.")',
    },
    {
      name: 'footerCopyright',
      title: 'Copyright Text',
      type: 'string',
      description: 'Copyright line (e.g. "XD Inc. All rights reserved."). Year is prepended automatically.',
    },
    {
      name: 'footerDisclaimer',
      title: 'Footer Disclaimer',
      type: 'text',
      rows: 2,
      description: 'Age/adult disclaimer text shown at bottom-right of footer.',
    },
    {
      name: 'footerColumns',
      title: 'Footer Link Columns',
      description: 'Link columns displayed in the footer. Each column has a heading and a list of links.',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          {
            name: 'heading',
            title: 'Column Heading',
            type: 'string',
            validation: (Rule) => Rule.required(),
          },
          {
            name: 'links',
            title: 'Links',
            type: 'array',
            of: [{
              type: 'object',
              fields: [
                { name: 'label', title: 'Label', type: 'string', validation: (Rule) => Rule.required() },
                { name: 'url',   title: 'URL',   type: 'string', description: 'Internal path (e.g. /vault) or external URL (e.g. mailto:hello@xdipx.com)', validation: (Rule) => Rule.required() },
              ],
              preview: {
                select: { title: 'label', subtitle: 'url' },
              },
            }],
          },
        ],
        preview: {
          select: { title: 'heading', links: 'links' },
          prepare({ title, links }) {
            return {
              title: title ?? '(no heading)',
              subtitle: `${links?.length ?? 0} link${(links?.length ?? 0) === 1 ? '' : 's'}`,
            }
          },
        },
      }],
    },
  ],
  preview: { prepare: () => ({ title: 'Site Settings' }) },
}
