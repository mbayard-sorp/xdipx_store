/**
 * Live post URL resolution (Social Studio v2 Phase 4, ADR-013 decision 10).
 *
 * X permalinks are knowable without a call. Instagram's are not: the publish
 * response carries only a media id, and the URL comes from a second
 * `GET /{media-id}?fields=permalink`. That GET is best-effort by contract: a
 * permalink is a convenience for the Studio, never a condition of a publish,
 * so this function returns null on any failure and never throws. The metrics
 * sweep backfills whatever was missed.
 */
import { igRequest } from './social-publish/instagram.server'
import { xPermalink } from './social-publish/x-limits'

export interface PermalinkDeps {
  /** Defaults to the real Graph API call. Injected so tests never fetch. */
  igGet?: (path: string, params: Record<string, string>) => ReturnType<typeof igRequest>
  /** Defaults to IG_GRAPH_ACCESS_TOKEN. Pass null to force "not configured". */
  igToken?: string | null
}

export async function permalinkFor(
  platform: string,
  externalPostId: string | null | undefined,
  deps: PermalinkDeps = {},
): Promise<string | null> {
  if (!externalPostId) return null
  if (platform === 'x') return xPermalink(externalPostId)
  if (platform !== 'instagram') return null

  const token = deps.igToken === undefined
    ? process.env['IG_GRAPH_ACCESS_TOKEN']?.trim()
    : deps.igToken
  if (!token) return null
  const igGet = deps.igGet ?? ((path, params) => igRequest(path, { method: 'GET', params, token }))

  try {
    const res = await igGet(`/${externalPostId}`, { fields: 'permalink' })
    if (!res.ok) return null
    const link = res.data['permalink']
    return typeof link === 'string' && link.startsWith('http') ? link : null
  } catch {
    return null
  }
}
