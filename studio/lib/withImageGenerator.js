/**
 * Schema helper that adds AI image generation to any image field.
 *
 * Returns two field definitions to spread into a document schema:
 *   1. imagePrompt — a string field the editor fills in to describe the desired image
 *   2. The named image field with ImageGeneratorInput attached as its input component
 *
 * Usage in a schema type:
 *   import { withImageGenerator } from '../lib/withImageGenerator'
 *
 *   fields: [
 *     ...withImageGenerator('heroImage'),
 *     // other fields...
 *   ]
 */
import { ImageGeneratorInput } from '../components/ImageGeneratorInput'

/**
 * @param {string} imageFieldName  The name of the image field (e.g. 'image', 'heroImage')
 * @returns {import('sanity').FieldDefinition[]}  Two field defs to spread into your schema fields array
 */
export function withImageGenerator(imageFieldName) {
  return [
    {
      name:        'imagePrompt',
      title:       'Image prompt',
      type:        'text',
      rows:        4,
      description: 'Describe the image to generate. Be specific about style, lighting, background, and mood.',
    },
    {
      name:    imageFieldName,
      title:   imageFieldName === 'image' ? 'Image' : imageFieldName.replace(/([A-Z])/g, ' $1').trim(),
      type:    'image',
      options: { hotspot: true },
      components: {
        input: ImageGeneratorInput,
      },
    },
  ]
}
