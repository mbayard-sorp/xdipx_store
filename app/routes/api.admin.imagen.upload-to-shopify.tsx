import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { uploadThumbnailToProduct, associateImageWithVariant, getProductAdminImages } from '~/lib/shopify.server'
import { applyWatermark } from '~/lib/watermark.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let productId: string
  let variantId: string | undefined
  let images: { base64: string; mimeType: string; alt?: string }[]
  try {
    const body = await request.json() as {
      productId?: string
      variantId?: string
      images?: { base64?: string; mimeType?: string; alt?: string }[]
    }
    productId = body.productId ?? ''
    variantId = body.variantId || undefined
    images    = (body.images ?? []).filter(
      img => typeof img.base64 === 'string' && img.base64.length > 0,
    ) as { base64: string; mimeType: string; alt?: string }[]
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!productId) return Response.json({ error: 'productId is required' }, { status: 400 })
  if (images.length === 0) return Response.json({ error: 'No images provided' }, { status: 400 })

  const results: { index: number; mediaId?: string; error?: string }[] = []

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!
    try {
      const rawBuffer = Buffer.from(img.base64, 'base64')
      const buffer    = await applyWatermark(rawBuffer)
      const filename  = `ai-generated-${Date.now()}-${i}.jpg`
      const altText   = img.alt ?? 'Product image'
      const mediaId   = await uploadThumbnailToProduct(productId, buffer, filename, altText)
      results.push({ index: i, mediaId })

      // Associate uploaded image with a specific variant if requested.
      // The media upload creates a product image; we need to find its REST image ID
      // to link it to the variant. This is best-effort — variant association may
      // take a moment after media processing.
      if (variantId && mediaId) {
        try {
          // Wait briefly for Shopify to process the media into an image
          await new Promise(r => setTimeout(r, 2000))
          const allImages = await getProductAdminImages(productId)
          // The most recently added image (highest position or most recent ID)
          const latestImage = allImages.sort((a, b) => b.id - a.id)[0]
          if (latestImage) {
            await associateImageWithVariant(productId, variantId, latestImage.id)
          }
        } catch {
          // Non-fatal — image is uploaded but not variant-linked
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ index: i, error: msg })
    }
  }

  const uploaded = results.filter(r => r.mediaId).length
  const errors   = results.filter(r => r.error).map(r => `Image ${r.index + 1}: ${r.error}`)

  return Response.json({ uploaded, errors, results })
}
