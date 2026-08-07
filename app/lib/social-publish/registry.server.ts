/**
 * Platform -> publisher adapter lookup. X is intentionally absent: X posting
 * has its own established seam (twitter.server.ts postApprovedDraft) and is
 * text-first; these adapters are the video platforms.
 */

import type { SocialPublisher } from './types'
import { instagramPublisher } from './instagram.server'
import { tiktokPublisher } from './tiktok.server'
import { youtubePublisher } from './youtube.server'

const PUBLISHERS: Record<string, SocialPublisher> = {
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
}

export function getPublisher(platform: string): SocialPublisher | null {
  return PUBLISHERS[platform] ?? null
}
