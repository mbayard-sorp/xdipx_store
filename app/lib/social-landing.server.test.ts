/**
 * getRecentSocialProductHandles (ticket #3348).
 *
 * The grid used to see only video-backed posts (inner join to video_jobs).
 * The current live Instagram feed is manually-drafted product posts with no
 * video_job_id, so the grid went empty of them. The fix reads a second
 * source for the same handle: the pre-publish gate's stamp, which the gate
 * already writes into `social_posts.feedback` (see
 * social-publish-approve.server.ts's `formatGateStamp` /
 * `parseGateStamp`) precisely because `social_posts` has no product-handle
 * column and adding one is a protected-path migration. No schema change
 * needed: the handle already survives on a row that never touched a video
 * job.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { rows: [] as unknown[] }

vi.mock('~/lib/db.server', () => {
  const chain: Record<string, unknown> = {}
  chain['from'] = () => chain
  chain['innerJoin'] = () => chain
  chain['leftJoin'] = () => chain
  chain['where'] = () => chain
  chain['orderBy'] = () => Promise.resolve(state.rows)
  return { db: { select: () => chain } }
})

import { getRecentSocialProductHandles } from './social-landing.server'

beforeEach(() => {
  state.rows = []
})

describe('getRecentSocialProductHandles', () => {
  it('surfaces a non-video-backed posted Instagram row via its gate stamp', async () => {
    // No video_jobs row at all: this is a manually-drafted image/carousel
    // post that went through the pre-publish gate, exactly like the live
    // #17 Dame Aloe / #24 Pom / #25 p-spot carousel posts the ticket names.
    state.rows = [
      {
        handle: null,
        videoHandle: null,
        feedback: '[publish-gate PASS by social-publish-gate on 2026-08-14, product: dame-aloe-lube]\nLooked at caption and media.',
        postedAt: new Date('2026-08-14'),
      },
    ]
    const handles = await getRecentSocialProductHandles(5)
    expect(handles).toEqual(['dame-aloe-lube'])
  })

  it('still surfaces a video-backed post (unchanged behavior)', async () => {
    state.rows = [
      { handle: 'satin-wand', videoHandle: 'satin-wand', feedback: null, postedAt: new Date('2026-08-13') },
    ]
    const handles = await getRecentSocialProductHandles(5)
    expect(handles).toEqual(['satin-wand'])
  })

  it('dedupes and orders most-recent-first across both sources', async () => {
    state.rows = [
      { handle: null, videoHandle: null, feedback: '[publish-gate PASS by g on 2026-08-15, product: pom]\nok this looked fine here.', postedAt: new Date('2026-08-15') },
      { handle: 'satin-wand', videoHandle: 'satin-wand', feedback: null, postedAt: new Date('2026-08-14') },
      { handle: null, videoHandle: null, feedback: '[publish-gate PASS by g on 2026-08-13, product: pom]\nok this looked fine here too.', postedAt: new Date('2026-08-13') },
    ]
    const handles = await getRecentSocialProductHandles(5)
    expect(handles).toEqual(['pom', 'satin-wand'])
  })

  it('ignores a row with no video handle and no gate stamp', async () => {
    state.rows = [
      { handle: null, videoHandle: null, feedback: 'just a note, no stamp', postedAt: new Date('2026-08-14') },
    ]
    const handles = await getRecentSocialProductHandles(5)
    expect(handles).toEqual([])
  })

  it('ignores a gate stamp that asserts no product', async () => {
    state.rows = [
      { handle: null, videoHandle: null, feedback: '[publish-gate PASS by g on 2026-08-14, product: none]\nno product here, just brand voice.', postedAt: new Date('2026-08-14') },
    ]
    const handles = await getRecentSocialProductHandles(5)
    expect(handles).toEqual([])
  })
})
