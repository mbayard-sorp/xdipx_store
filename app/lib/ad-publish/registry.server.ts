import type { AdPusher } from './types'
import { metaAdPusher } from './meta.server'
import { tiktokAdPusher } from './tiktok.server'
import { googleAdPusher } from './google.server'

const PUSHERS: Record<string, AdPusher> = {
  meta: metaAdPusher,
  tiktok: tiktokAdPusher,
  google: googleAdPusher,
}

export function getAdPusher(platform: string): AdPusher | null {
  return PUSHERS[platform] ?? null
}
