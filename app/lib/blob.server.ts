/**
 * Vercel Blob wrapper — the video pipeline's byte store. Mirrors kv.server.ts
 * discipline: this is the ONLY file that imports @vercel/blob, so the Oxygen
 * migration swaps one file (Blob -> R2/S3) without touching callers.
 *
 * Everything the pipeline generates (scene frames, clips, posters, ad
 * creatives) round-trips through Blob between cron ticks — never /tmp, which is
 * instance-local on Vercel and not guaranteed to survive between invocations.
 * Approved product videos graduate to Shopify Files as a deliberate second hop.
 *
 * Path conventions:
 *   video/{jobId}/frame-{n}.jpg     scene-frame candidates
 *   video/{jobId}/clip.mp4          raw model output
 *   video/{jobId}/final.mp4         assembled/watermarked final
 *   video/{jobId}/poster.jpg        extracted poster frame
 *   ads/{campaignId}/{format}-{n}.{ext}
 *   cast/{slug}/portrait-{n}.jpg    casting-call candidates
 */

export function blobConfigured(): boolean {
  return !!process.env['BLOB_READ_WRITE_TOKEN']?.trim()
}

function requireToken(): string {
  const token = process.env['BLOB_READ_WRITE_TOKEN']
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN env var is required for Blob storage')
  return token
}

/** Upload a buffer; returns the public URL. Adds a random suffix to avoid collisions on retry. */
export async function blobPut(pathname: string, data: Buffer, opts: { contentType: string }): Promise<{ url: string }> {
  const token = requireToken()
  const { put } = await import('@vercel/blob')
  const result = await put(pathname, data, {
    access: 'public',
    contentType: opts.contentType,
    token,
    addRandomSuffix: true,
  })
  return { url: result.url }
}

/** Download any public URL (Blob or provider-hosted) into a Buffer. */
export async function blobFetchToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status} ${url.slice(0, 120)}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Best-effort delete; a leaked blob is a cost nit, never worth failing a job over. */
export async function blobDel(url: string): Promise<void> {
  try {
    const { del } = await import('@vercel/blob')
    await del(url, { token: requireToken() })
  } catch (err) {
    console.error('[blob] best-effort delete failed (ignored):', err)
  }
}
