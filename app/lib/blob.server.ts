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

/* -------------------------------------------------------------------------
 * Private objects.
 *
 * Everything above this line is `access: 'public'`, which is correct for the
 * video and ad pipelines: those bytes end up on Instagram. Database dumps are
 * the opposite case. A dump of the critical tier contains consent records,
 * voicemail rows, SMS transcripts and every order line — publishing that to a
 * public URL would be a data breach whether or not the URL is guessable, and
 * `addRandomSuffix` is obscurity, not access control.
 *
 * So these four keep `access: 'private'`, which the store enforces server-side:
 * reads require the read-write token, which lives only in the Vercel
 * environment. They are deliberately separate functions rather than an `access`
 * parameter on the public ones, so that no future caller makes a dump public by
 * forgetting an argument.
 * ------------------------------------------------------------------------- */

/** Upload a private object at an exact pathname, overwriting any prior copy. */
export async function blobPutPrivate(
  pathname: string,
  data: Buffer,
  opts: { contentType: string },
): Promise<{ url: string; pathname: string }> {
  const token = requireToken()
  const { put } = await import('@vercel/blob')
  const result = await put(pathname, data, {
    access: 'private',
    contentType: opts.contentType,
    token,
    // Deterministic paths, so a restore probe can address yesterday's dump by
    // name rather than by listing and guessing, and so a re-run of the same
    // night's dump replaces it instead of accumulating near-duplicates.
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  return { url: result.url, pathname: result.pathname }
}

/** Read a private object back into a Buffer, bypassing the CDN cache. */
export async function blobGetPrivate(pathname: string): Promise<Buffer> {
  const token = requireToken()
  const { get } = await import('@vercel/blob')
  const res = await get(pathname, {
    access: 'private',
    token,
    // The restore probe exists to prove the bytes in origin storage are
    // readable. A CDN hit would prove the CDN is readable, which is not the
    // question being asked.
    useCache: false,
  })
  // `get` resolves to null when the object does not exist. A missing dump is
  // the single most important thing this whole stage detects, so it throws
  // rather than returning an empty buffer that would read as a valid dump of
  // nothing.
  if (!res) throw new Error(`blob not found: ${pathname}`)
  if (res.statusCode !== 200 || !res.stream) {
    throw new Error(`blob get returned ${res.statusCode} for ${pathname}`)
  }
  const chunks: Uint8Array[] = []
  for await (const chunk of res.stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** List objects under a prefix. Returns pathnames and sizes, newest first. */
export async function blobListPrivate(
  prefix: string,
): Promise<Array<{ pathname: string; size: number; uploadedAt: Date }>> {
  const token = requireToken()
  const { list } = await import('@vercel/blob')
  const out: Array<{ pathname: string; size: number; uploadedAt: Date }> = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, token, ...(cursor === undefined ? {} : { cursor }) })
    for (const b of page.blobs) {
      out.push({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
}

/** Delete private objects by pathname. Best-effort, same as blobDel. */
export async function blobDelPrivate(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return
  try {
    const { del } = await import('@vercel/blob')
    await del(pathnames, { token: requireToken() })
  } catch (err) {
    console.error('[blob] best-effort private delete failed (ignored):', err)
  }
}
