import { TINT_SURFACES, MARKS } from './panelTokens'
import { withImageGenerator } from '../../lib/withImageGenerator'

// One square door in the panel deck's square row (Pleasure / Play / Body / Wear).
//
// Art direction (owner direction 2026-07-29): the image is a product cutout
// still sitting ON the tinted ground, never a photograph the label is typed
// over. The mark is the empty state, used when no image passes the vision gate.
export default {
  name: 'panelTile',
  title: 'Square panel',
  type: 'object',
  fields: [
    {
      name: 'label',
      title: 'Label',
      type: 'string',
      description: 'One word. Sets at 11-17px, so it must never wrap.',
      validation: (Rule) => Rule.required().max(12),
    },
    {
      name: 'surface',
      title: 'Surface',
      type: 'string',
      initialValue: 'stone',
      description: 'Tints only on squares. A solid ground here blows the coral budget.',
      options: { list: TINT_SURFACES },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'mark',
      title: 'Mark',
      type: 'string',
      description: 'Empty-state glyph, shown when no image is set.',
      options: { list: MARKS },
      validation: (Rule) => Rule.required(),
    },
    // AI image generation — adds imagePrompt sibling + wraps 'image' input
    ...withImageGenerator('image'),
    {
      name: 'link',
      title: 'Destination',
      type: 'panelLink',
      validation: (Rule) => Rule.required(),
    },
  ],
  preview: {
    select: { title: 'label', subtitle: 'surface', media: 'image' },
  },
}
