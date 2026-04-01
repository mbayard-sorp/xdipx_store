/**
 * Google Imagen via Vertex AI
 * Generates mood/lifestyle images for products with < 3 Nalpac images.
 *
 * Setup: set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS env vars.
 * Cost: ~$2.40/month at 2 images/day (imagegeneration@006 pricing).
 */

const MOOD_MAP: Record<string, string> = {
  'Water-Based':              'silky smooth liquid over smooth stones, clean and natural',
  'Silicone-Based':           'gleaming geometric shapes, premium and sleek',
  'Wands':                    'sleek modern sculpture in warm light, powerful and elegant',
  'Dual Action and Rabbits':  'two flowers blooming simultaneously, movement and softness',
  'Plugs and Probes':         'smooth geometric form, subtle curves in purple shadow',
  'Restraints':               'soft ribbons loosely draped, playful not threatening',
  'Toy Cleaners':             'fresh botanical ingredients, clean spa aesthetic',
  'Bullets and Eggs':         'small smooth river pebbles, delicate and curious',
  'Vagina Strokers':          'soft fabric texture, modern minimal studio',
  'Couples and Wearable':     'two intertwined abstract forms, warm connection',
  'Air Pulse and Suction':    'gentle wind through tall grass, soft and airy',
  'Remote':                   'wireless signal ripples in water, playful and techy',
  'Finger and Clit':          'rose petal curves in warm light, soft and inviting',
}

function getMoodDescription(categories: string[]): string {
  for (const cat of categories) {
    const mood = MOOD_MAP[cat]
    if (mood) return mood
  }
  return 'warm abstract lifestyle, soft lighting, premium wellness aesthetic'
}

interface ImagenResponse {
  predictions: { bytesBase64Encoded: string; mimeType: string }[]
}

export async function generateMoodImage(opts: {
  categories: string[]
  outputGcs?: string
}): Promise<Buffer[]> {
  const project = process.env['GOOGLE_CLOUD_PROJECT_ID']
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set')

  const mood = getMoodDescription(opts.categories)

  const prompt = `Abstract lifestyle photography for a premium wellness product.
Mood: warm, curious, inviting. Soft golden-hour lighting.
Colors: coral red, warm orange, purple accents, cream background.
No faces. No people. No product shown directly.
Suggest the feeling of: ${mood}.
Style: editorial, tasteful, evocative but not explicit.`

  const endpoint = `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/imagegeneration@006:predict`

  // Fetch access token from metadata server (works on GCP/Vercel with Workload Identity)
  const tokenRes = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  )
  if (!tokenRes.ok) throw new Error('Could not fetch Google access token')
  const { access_token } = await tokenRes.json() as { access_token: string }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances:  [{ prompt }],
      parameters: {
        sampleCount:       2,
        aspectRatio:       '4:3',
        safetyFilterLevel: 'block_some',
        personGeneration:  'dont_allow',
      },
    }),
  })

  if (!res.ok) throw new Error(`Imagen API error: ${res.status}`)
  const data = await res.json() as ImagenResponse

  return data.predictions.map(p =>
    Buffer.from(p.bytesBase64Encoded, 'base64'),
  )
}
