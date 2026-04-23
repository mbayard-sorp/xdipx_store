/**
 * fal.ai client — currently used by scripts/remove-product-bg.ts for BiRefNet v2
 * background removal. Uses the synchronous /fal.run/{model} endpoint via fetch
 * (no SDK dependency). Auth: Authorization: Key ${FAL_KEY}.
 *
 * Docs: https://fal.ai/models/fal-ai/birefnet/v2
 */

const FAL_SYNC_ENDPOINT = 'https://fal.run'

export interface BirefnetResult {
  imageUrl: string
  contentType: string
}

function requireKey(): string {
  const key = process.env['FAL_KEY']
  if (!key) throw new Error('FAL_KEY env var is required for fal.ai calls')
  return key
}

/**
 * Run BiRefNet v2 against a publicly-fetchable image URL. Returns the URL of the
 * transparent PNG hosted by fal.ai (valid for ~24h; download promptly).
 */
export async function removeBackground(imageUrl: string): Promise<BirefnetResult> {
  const key = requireKey()
  const res = await fetch(`${FAL_SYNC_ENDPOINT}/fal-ai/birefnet/v2`, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${key}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      image_url:         imageUrl,
      output_format:     'png',
      refine_foreground: true,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fal.ai BiRefNet error: ${res.status} ${text.slice(0, 400)}`)
  }

  const json = await res.json() as {
    image?: { url?: string; content_type?: string }
  }
  const url = json.image?.url
  if (!url) throw new Error('fal.ai BiRefNet response missing image.url')
  return { imageUrl: url, contentType: json.image?.content_type ?? 'image/png' }
}
