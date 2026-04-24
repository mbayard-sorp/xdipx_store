// Editor bio card — embeddable block that pulls live data from the
// Editor (Emma) singleton. Drop into any page's sections array to render
// her photo, name, role, bio, and socials in one of three layouts.
export default {
  name: 'editorBio',
  title: 'Editor bio card',
  type: 'object',

  fields: [
    {
      name: 'active',
      title: 'Show this block',
      type: 'boolean',
      initialValue: true,
    },
    {
      name: 'order',
      title: 'Order',
      type: 'number',
      initialValue: 0,
      description: 'Lower numbers render first.',
    },
    {
      name: 'variant',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Hero — large photo + name + full bio', value: 'hero' },
          { title: 'Card — compact photo beside short bio',  value: 'card' },
          { title: 'Quote — short bio only, script font',    value: 'quote' },
        ],
        layout: 'radio',
      },
      initialValue: 'hero',
      validation: Rule => Rule.required(),
    },
    {
      name: 'eyebrow',
      title: 'Eyebrow text (optional)',
      type: 'string',
      description: 'Small uppercase line above the name. Leave blank to use default ("Meet the editor").',
    },
    {
      name: 'headingOverride',
      title: 'Heading override (optional)',
      type: 'string',
      description: 'Overrides the name + role line. Rare — leave blank in most cases.',
    },
    {
      name: 'hideLongBio',
      title: 'Hide long bio',
      type: 'boolean',
      initialValue: false,
      description: 'Only applies to the Hero layout.',
    },
    {
      name: 'hideSocials',
      title: 'Hide Instagram / email links',
      type: 'boolean',
      initialValue: false,
    },
    {
      name: 'bgStyle',
      title: 'Background',
      type: 'string',
      options: {
        list: [
          { title: 'Cream (default)', value: 'cream' },
          { title: 'Paper (white)',   value: 'paper' },
          { title: 'Cream-2 (tint)',  value: 'cream-2' },
        ],
      },
      initialValue: 'cream',
    },
    {
      name: 'showCta',
      title: 'Show "See Emma\'s pick" CTA below',
      type: 'boolean',
      initialValue: false,
    },
  ],

  preview: {
    select: { variant: 'variant', active: 'active' },
    prepare({ variant, active }) {
      return {
        title: '👩 Editor bio card',
        subtitle: `${variant ?? 'hero'} layout · ${active === false ? 'hidden' : 'live'} · pulls from Editor (Emma) singleton`,
      }
    },
  },
}
