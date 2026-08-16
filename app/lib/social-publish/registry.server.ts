/**
 * Platform -> publisher adapter lookup.
 *
 * X was originally absent here on the reasoning that it "has its own
 * established seam (twitter.server.ts postApprovedDraft) and is text-first,
 * these adapters are the video platforms". That held while the only way an X
 * post reached the account was the owner clicking Post now. Once the unattended
 * publish job learned to run for X, the job needs one lookup that works for
 * every platform, so X is registered here and `x.server.ts` wraps the existing
 * twitter.server seam rather than replacing it. The Studio button still calls
 * `postApprovedDraft` directly; both paths end at the same `postTweet`.
 */

import type { SocialPublisher } from './types'
import { instagramPublisher } from './instagram.server'
import { tiktokPublisher } from './tiktok.server'
import { youtubePublisher } from './youtube.server'
import { xPublisher } from './x.server'

const PUBLISHERS: Record<string, SocialPublisher> = {
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
  x: xPublisher,
}

export function getPublisher(platform: string): SocialPublisher | null {
  return PUBLISHERS[platform] ?? null
}
