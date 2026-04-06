/**
 * Google Gemini image generation via @google/genai SDK.
 * Model: gemini-2.5-flash-image (replaces deprecated imagegeneration@006 / imagen-3.0-*)
 *
 * Auth: uses googleAuthOptions for explicit service account (prod) or falls back to
 *       Application Default Credentials (local: gcloud auth application-default login).
 */

import { GoogleGenAI } from '@google/genai'

const MOOD_MAP: Record<string, string> = {
  'Water-Based':             'silky smooth liquid over smooth stones, clean and natural',
  'Silicone-Based':          'gleaming geometric shapes, premium and sleek',
  'Wands':                   'sleek modern sculpture in warm light, powerful and elegant',
  'Dual Action and Rabbits': 'two flowers blooming simultaneously, movement and softness',
  'Plugs and Probes':        'smooth geometric form, subtle curves in purple shadow',
  'Restraints':              'soft ribbons loosely draped, playful not threatening',
  'Toy Cleaners':            'fresh botanical ingredients, clean spa aesthetic',
  'Bullets and Eggs':        'small smooth river pebbles, delicate and curious',
  'Vagina Strokers':         'soft fabric texture, modern minimal studio',
  'Couples and Wearable':    'two intertwined abstract forms, warm connection',
  'Air Pulse and Suction':   'gentle wind through tall grass, soft and airy',
  'Remote':                  'wireless signal ripples in water, playful and techy',
  'Finger and Clit':         'rose petal curves in warm light, soft and inviting',
}

function getMoodDescription(categories: string[]): string {
  for (const cat of categories) {
    const mood = MOOD_MAP[cat]
    if (mood) return mood
  }
  return 'warm abstract lifestyle, soft lighting, premium wellness aesthetic'
}

function buildClient(): GoogleGenAI {
  const project  = process.env['GOOGLE_CLOUD_PROJECT_ID'] ?? ''
  const location = process.env['GOOGLE_CLOUD_LOCATION'] ?? 'us-central1'

  const raw = process.env['GOOGLE_SERVICE_ACCOUNT_JSON']
  if (raw) {
    // Production: service account key stored as base64-encoded JSON
    const key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      client_email: string
      private_key: string
    }
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: key.client_email,
          private_key:  key.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      },
    })
  }

  // Local dev: Application Default Credentials (gcloud auth application-default login)
  return new GoogleGenAI({ vertexai: true, project, location })
}

const MODEL = process.env['GEMINI_IMAGE_MODEL'] ?? 'gemini-2.5-flash-image'

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Generate one image and return it as a Buffer. Throws on failure. */
async function generateOne(ai: GoogleGenAI, parts: Part[]): Promise<Buffer> {
  const response = await ai.models.generateContent({
    model:    MODEL,
    contents: [{ role: 'user', parts }],
    config:   { responseModalities: ['IMAGE'] },
  })

  const candidate = response.candidates?.[0]
  if (!candidate) throw new Error('No candidates returned from Gemini image API')

  // Check for safety blocks
  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Image blocked by safety filters')
  }

  for (const part of candidate.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return Buffer.from(part.inlineData.data, 'base64')
    }
  }

  throw new Error(
    `Gemini returned no image data (finishReason: ${candidate.finishReason ?? 'unknown'}). Prompt may have been filtered.`,
  )
}

// ─── Main export ──────────────────────────────────────────────────────────

export async function generateMoodImage(opts: {
  categories: string[]
  prompt?: string
  /** @deprecated aspectRatio not supported by gemini-2.5-flash-image; ignored */
  aspectRatio?: string
  /** @deprecated personGeneration not supported by gemini-2.5-flash-image; ignored */
  personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all'
  /** How many images to generate (default 2, max 4). Each is a parallel API call. */
  count?: number
  /**
   * Optional reference image buffers fetched server-side from CDN.
   * Used to reproduce the exact same physical product in the new scene.
   */
  referenceImageBuffers?: Buffer[]
  /** Product title for logging/context. */
  referenceProductTitle?: string
  /**
   * For improvement calls: the original image buffer to use as the base.
   * The prompt should describe only what to change.
   */
  originalImageBuffer?: Buffer
}): Promise<Buffer[]> {
  const project = process.env['GOOGLE_CLOUD_PROJECT_ID']
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set')

  const ai    = buildClient()
  const mood  = getMoodDescription(opts.categories)
  const count = Math.min(Math.max(1, opts.count ?? 2), 4)

  const basePrompt = opts.prompt ?? `Abstract lifestyle photography for a premium wellness product.
Mood: warm, curious, inviting. Soft golden-hour lighting.
Colors: coral red, warm orange, purple accents, cream background.
No faces. No people. No product shown directly.
Suggest the feeling of: ${mood}.
Style: editorial, tasteful, evocative but not explicit.`

  // ── Build parts array ────────────────────────────────────────────────────

  const parts: Part[] = []

  if (opts.originalImageBuffer) {
    // Improvement mode: send original image + "keep product identical" instruction
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: opts.originalImageBuffer.toString('base64') } })
    parts.push({ text: `${basePrompt} Keep the product identical. Only change the environment, lighting, or background as described.` })
  } else {
    const refs = opts.referenceImageBuffers
    if (refs && refs.length > 0) {
      // Reference mode: reproduce the exact physical product in a new scene
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: refs[0]!.toString('base64') } })
      parts.push({
        text: `${basePrompt} Reproduce the exact same physical product shown in the reference image — same shape, color, finish, and details. Place it faithfully in the new scene without altering the product itself.`,
      })
    } else {
      parts.push({ text: basePrompt })
    }
  }

  // ── Generate `count` images in parallel ─────────────────────────────────
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => generateOne(ai, parts)),
  )

  const buffers: Buffer[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      buffers.push(result.value)
    } else {
      console.warn('[imagen] One generation failed:', result.reason instanceof Error ? result.reason.message : result.reason)
    }
  }

  if (buffers.length === 0) {
    // Surface the actual failure reason from the first rejection
    const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    const reason = firstError?.reason instanceof Error ? firstError.reason.message : String(firstError?.reason)
    throw new Error(`All image generations failed: ${reason}`)
  }

  return buffers
}
