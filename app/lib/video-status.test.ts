/**
 * Pins the derived status vocabulary (ticket #5716, extended #10485 with
 * `flagged`): twelve states, first match wins, including the half-approved
 * multi-scene park and the failed-job-with-posts case.
 */
import { describe, expect, it } from 'vitest'
import { videoStatusOf, stageIndexOf, nextActionOf, STAGE_STEPS } from './video-status'

const ep = (productionStatus: string, extra: Record<string, unknown> = {}) => ({ productionStatus, ...extra })
const job = (stage: string, status: string, sceneStateJson: { status: string }[] | null = null) => ({ stage, status, sceneStateJson })

describe('videoStatusOf', () => {
  it('covers all thirteen states', () => {
    expect(videoStatusOf(ep('shelved'), null).key).toBe('shelved')
    expect(videoStatusOf(ep('rejected'), null).key).toBe('shelved')
    expect(videoStatusOf(ep('rendering'), job('clip', 'failed')).key).toBe('failed')
    expect(videoStatusOf(ep('rendering'), job('poster', 'awaiting_final_review')).key).toBe('flagged')
    expect(videoStatusOf(ep('rendering'), job('done', 'awaiting_render_approval')).key).toBe('finalcut')
    expect(videoStatusOf(ep('posted'), null).key).toBe('posted')
    expect(videoStatusOf(ep('scheduled'), job('done', 'done')).key).toBe('scheduled')
    expect(videoStatusOf(ep('rendering'), job('done', 'done')).key).toBe('review')
    expect(videoStatusOf(ep('rendering'), job('scene_frame', 'awaiting_frame_approval')).key).toBe('framing')
    expect(videoStatusOf(ep('rendering'), job('clip', 'awaiting_provider')).key).toBe('rendering')
    expect(videoStatusOf(ep('approved'), null).key).toBe('approved')
    expect(videoStatusOf(ep('needs_changes'), null).key).toBe('changes')
    expect(videoStatusOf(ep('pending_approval'), null).key).toBe('scripted')
    expect(videoStatusOf(ep('idea'), null).key).toBe('concept')
  })

  it('a job flagged by the post-render vision gate outranks a calmer episode state', () => {
    expect(videoStatusOf(ep('rendering'), job('poster', 'awaiting_final_review'), [{ status: 'draft' }]).key).toBe('flagged')
  })

  it('a cut parked at the render gate reads as the owner-turn final cut, above calmer states', () => {
    const s = videoStatusOf(ep('rendering'), job('done', 'awaiting_render_approval'))
    expect(s.word).toBe('Awaiting your approval: final cut')
    expect(s.turn).toBe('owner')
    // Never hidden behind scheduled/posted, and never mistaken for a plain review.
    expect(videoStatusOf(ep('scheduled'), job('done', 'awaiting_render_approval'), [{ status: 'draft' }]).key).toBe('finalcut')
    expect(videoStatusOf(null, job('done', 'awaiting_render_approval')).key).toBe('finalcut')
    // Once approved (status done) it is the ordinary review/scheduled path again.
    expect(videoStatusOf(null, job('done', 'done')).key).toBe('review')
  })

  it('half-approved multi-scene job parks as framing even when job.status is queued', () => {
    const j = job('scene_frame', 'queued', [{ status: 'frame' }, { status: 'awaiting_frame_approval' }, { status: 'pending' }])
    expect(videoStatusOf(ep('rendering'), j).key).toBe('framing')
  })

  it('a failed job that already has posts still reads posted (the money shipped)', () => {
    expect(videoStatusOf(ep('rendering'), job('failed', 'failed'), [{ status: 'posted' }]).key).toBe('failed')
    // failure outranks posts by design: a red row must never hide.
  })

  it('scheduled posts outrank review', () => {
    expect(videoStatusOf(ep('rendering'), job('done', 'done'), [{ status: 'draft' }]).key).toBe('scheduled')
  })

  it('job-only rows (no episode) derive cleanly', () => {
    expect(videoStatusOf(null, job('done', 'done')).key).toBe('review')
    expect(videoStatusOf(null, job('clip', 'running')).key).toBe('rendering')
    expect(videoStatusOf(null, null).key).toBe('concept')
  })

  it('owner-turn states are exactly the coral four plus failed and flagged', () => {
    const owners = ['scripted', 'framing', 'finalcut', 'review', 'failed', 'flagged']
    for (const k of owners) {
      const s = videoStatusOf(
        k === 'scripted' ? ep('pending_approval') : ep('rendering'),
        k === 'framing' ? job('scene_frame', 'awaiting_frame_approval')
          : k === 'finalcut' ? job('done', 'awaiting_render_approval')
          : k === 'review' ? job('done', 'done')
          : k === 'failed' ? job('failed', 'failed')
          : k === 'flagged' ? job('poster', 'awaiting_final_review') : null,
      )
      expect(s.turn).toBe('owner')
    }
  })
})

describe('stageIndexOf', () => {
  it('walks the six-dot rail', () => {
    expect(stageIndexOf('concept', ep('idea'))).toBe(0)
    expect(stageIndexOf('scripted', ep('pending_approval'))).toBe(1)
    expect(stageIndexOf('scripted', ep('pending_approval', { storyboardJson: [{}] }))).toBe(2)
    expect(stageIndexOf('scripted', ep('pending_approval', { castSlugs: ['maya'] }))).toBe(3)
    expect(stageIndexOf('rendering', null)).toBe(4)
    expect(stageIndexOf('flagged', null)).toBe(4)
    expect(stageIndexOf('finalcut', null)).toBe(4)
    expect(STAGE_STEPS[stageIndexOf('finalcut', null)]).toBe('Render')
    expect(stageIndexOf('posted', null)).toBe(5)
  })
})

describe('nextActionOf', () => {
  it('offers the one verb only on the owner turns', () => {
    expect(nextActionOf('scripted', 7, null)?.to).toBe('/admin/video-studio/scripts/7')
    expect(nextActionOf('framing', null, 3)?.to).toBe('/admin/video-studio/render')
    expect(nextActionOf('review', null, 3)?.to).toBe('/admin/video-studio/render')
    expect(nextActionOf('finalcut', 7, 3)).toEqual({ label: 'Approve cut', to: '/admin/video-studio/render' })
    expect(nextActionOf('rendering', 7, 3)).toBeNull()
    expect(nextActionOf('approved', 7, null)).toBeNull()
  })
})
