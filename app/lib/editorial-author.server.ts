/**
 * Editorial author lookup — voice profile for AI-generated content.
 * Reads the `editorialAuthor` Sanity doc by slug. Returned shape feeds
 * claude.server.ts: voiceRules append to SYSTEM_PROMPT, seoMode controls
 * keyword targeting strength.
 *
 * Self-graceful: returns null when Sanity isn't configured or the author
 * doesn't exist, so callers can fall back to the base brand voice cleanly.
 */
import { createClient } from '@sanity/client'
import { cached } from '~/lib/kv.server'

export interface EditorialAuthor {
  slug:        string
  name:        string
  personaSummary?: string | undefined
  voiceRules:  string[]
  keywordContentTypes: string[]
  seoMode:     'aggressive' | 'natural' | 'off'
  active:      boolean
}

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getReadClient() {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: true,
    token: process.env['SANITY_API_TOKEN'],
    perspective: 'published',
  } as any)
}

export async function getEditorialAuthor(slug: string): Promise<EditorialAuthor | null> {
  if (!slug) return null
  return cached(`editorial-author:${slug}`, 300, async () => {
    const client = getReadClient()
    if (!client) return null
    try {
      const doc = await client.fetch<{
        slug?:        { current?: string }
        name?:        string
        personaSummary?: string
        voiceRules?:  string[]
        keywordContentTypes?: string[]
        seoMode?:     EditorialAuthor['seoMode']
        active?:      boolean
      } | null>(
        `*[_type == "editorialAuthor" && slug.current == $slug][0]{
          slug, name, personaSummary, voiceRules, keywordContentTypes, seoMode, active
        }`,
        { slug },
      )
      if (!doc?.name) return null
      const isActive = doc.active !== false
      if (!isActive) return null
      return {
        slug,
        name:           doc.name,
        personaSummary: doc.personaSummary,
        voiceRules:     doc.voiceRules ?? [],
        keywordContentTypes: doc.keywordContentTypes ?? [],
        seoMode:        doc.seoMode ?? 'natural',
        active:         isActive,
      }
    } catch (err) {
      console.error('[editorial-author] fetch error:', err)
      return null
    }
  })
}
