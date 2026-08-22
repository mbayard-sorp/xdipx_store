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

/**
 * The store was connected to Vercel with the XDIPX env prefix, so the token
 * ships as XDIPX_READ_WRITE_TOKEN; BLOB_READ_WRITE_TOKEN is checked first so a
 * standard-named token wins if one is ever added.
 */
function resolveToken(): string | undefined {
  return process.env['BLOB_READ_WRITE_TOKEN']?.trim() || process.env['XDIPX_READ_WRITE_TOKEN']?.trim()
}

export function blobConfigured(): boolean {
  return !!resolveToken()
}

function requireToken(): string {
  const token = resolveToken()
  if (!token) throw new Error('A Blob read-write token (BLOB_READ_WRITE_TOKEN or XDIPX_READ_WRITE_TOKEN) is required for Blob storage')
  return token
}

/**
 * The same read-write token this file uses, for a caller that hands Blob
 * write access to something outside this process — e.g. the RunPod video
 * worker, which uploads its own mp4 straight to Blob rather than round-
 * tripping bytes through us. Same BLOB_READ_WRITE_TOKEN / XDIPX_READ_WRITE_TOKEN
 * fallback as everywhere else in this file; do not re-read the env vars
 * directly elsewhere, reuse this.
 */
export function requireBlobToken(): string {
  return requireToken()
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
