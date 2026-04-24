/**
 * Shared background-style field for content blocks.
 *
 * Every homepage/page section supports the same 5-value palette so editors get
 * a consistent dropdown in Studio and renderers can share one mapping.
 *
 * Usage:
 *   import { bgStyleField } from '../../lib/bgStyleField'
 *   fields: [..., bgStyleField({ initialValue: 'cream' })]
 */

/**
 * @param {{ initialValue?: 'white'|'cream'|'mist'|'charcoal'|'purple', title?: string }} [opts]
 */
export function bgStyleField(opts = {}) {
  return {
    name: 'bgStyle',
    title: opts.title ?? 'Background',
    type: 'string',
    options: {
      list: [
        { title: 'White',    value: 'white' },
        { title: 'Cream',    value: 'cream' },
        { title: 'Mist',     value: 'mist' },
        { title: 'Charcoal', value: 'charcoal' },
        { title: 'Purple',   value: 'purple' },
      ],
    },
    initialValue: opts.initialValue ?? 'white',
  }
}
