/**
 * Owner image feedback (migration 104, ticket #11551). The db client is
 * mocked with a tiny in-memory table keyed by asset id so the upsert
 * semantics (one live verdict per asset) are observable. Also covers the
 * reason vocabulary gate, list/summary shape, and the team route being read
 * only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: number; assetId: number; verdict: string; reasons: string[]; note: string | null
  ratedBy: string; createdAt: Date; updatedAt: Date | null
}

const state = vi.hoisted(() => ({
  table: new Map<number, Row>(),
  nextId: 1,
  joinRows: [] as unknown[],
  summaryRows: [] as unknown[],
}))

vi.mock('~/lib/db.server', () => ({
  db: {
    insert: () => ({
      values: (v: Omit<Row, 'id' | 'createdAt' | 'updatedAt'>) => ({
        onConflictDoUpdate: (opts: { set: Partial<Row> }) => ({
          returning: async () => {
            const existing = state.table.get(v.assetId)
            const row: Row = existing
              ? { ...existing, ...opts.set }
              : { id: state.nextId++, ...v, createdAt: new Date('2026-09-25T00:00:00Z'), updatedAt: null }
            state.table.set(v.assetId, row)
            return [row]
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({ returning: async () => [] }),
    }),
    select: (fields?: Record<string, unknown>) => ({
      from: () => {
        const isSummary = fields && Object.keys(fields).length === 2
        const whereResult = isSummary ? Promise.resolve(state.summaryRows) : Promise.resolve([...state.table.values()])
        return {
          where: () => whereResult,
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({ limit: async () => state.joinRows }),
            }),
          }),
        }
      },
    }),
  },
}))

vi.mock('~/lib/team.server', () => ({ assertTeamAuth: vi.fn() }))
vi.mock('~/lib/api-error.server', () => ({
  apiError: (_s: string, err: unknown) => Response.json({ error: String(err) }, { status: 500 }),
}))

import {
  FeedbackValidationError, getFeedbackForAssets, handleFeedbackIntent, listAssetFeedback,
  normaliseFeedbackInput, setAssetFeedback, summarizeAssetFeedback,
} from './social-asset-feedback.server'
import * as feedbackServer from './social-asset-feedback.server'
import { DOWN_REASONS, UP_REASONS } from './social-asset-feedback-reasons'
import { action as teamAction } from '~/routes/api.team.social-asset-feedback'

beforeEach(() => {
  state.table.clear()
  state.nextId = 1
  state.joinRows = []
  state.summaryRows = []
})

describe('setAssetFeedback upsert', () => {
  it('a second write for the same asset replaces the first', async () => {
    await setAssetFeedback({ assetId: 7, verdict: 'up', reasons: ['on-message'], ratedBy: 'owner' })
    await setAssetFeedback({ assetId: 7, verdict: 'down', reasons: ['crop-too-tight'], note: 'tighter than §3.2a', ratedBy: 'owner' })
    expect(state.table.size).toBe(1)
    const row = state.table.get(7)!
    expect(row.verdict).toBe('down')
    expect(row.reasons).toEqual(['crop-too-tight'])
    expect(row.note).toBe('tighter than §3.2a')
    expect(row.updatedAt).toBeInstanceOf(Date)
    const map = await getFeedbackForAssets([7])
    expect(map[7]?.verdict).toBe('down')
  })

  it('dedupes reasons and keeps vocabulary order', () => {
    const v = normaliseFeedbackInput({ assetId: 1, verdict: 'up', reasons: ['lighting', 'on-message', 'lighting'], ratedBy: 'o' })
    expect(v.reasons).toEqual(['on-message', 'lighting'])
  })
})

describe('reason vocabulary validation', () => {
  it('rejects an unknown reason', async () => {
    await expect(setAssetFeedback({ assetId: 1, verdict: 'down', reasons: ['vibes'], ratedBy: 'o' }))
      .rejects.toBeInstanceOf(FeedbackValidationError)
    expect(state.table.size).toBe(0)
  })

  it('rejects a reason from the other verdict', () => {
    expect(() => normaliseFeedbackInput({ assetId: 1, verdict: 'up', reasons: ['ai-artifact'], ratedBy: 'o' }))
      .toThrow(FeedbackValidationError)
  })

  it('rejects a bad verdict', () => {
    expect(() => normaliseFeedbackInput({ assetId: 1, verdict: 'meh', ratedBy: 'o' })).toThrow(FeedbackValidationError)
  })

  it('the vocabulary matches the ticket', () => {
    expect(DOWN_REASONS.map(r => r.value)).toEqual([
      'product-drift', 'pose-or-composition', 'crop-too-tight', 'crop-too-loose', 'skin-treatment-off',
      'over-the-ceiling', 'too-tame', 'lighting-or-colour', 'cast-off-model', 'scene-or-location',
      'ai-artifact', 'text-or-watermark', 'other',
    ])
    expect(UP_REASONS.map(r => r.value)).toEqual([
      'on-message', 'more-like-this', 'product-faithful', 'composition', 'skin-treatment', 'lighting', 'cast-on-model',
    ])
  })

  it('handleFeedbackIntent returns ok:false instead of throwing on a bad reason', async () => {
    const fd = new FormData()
    fd.set('verdict', 'down'); fd.set('reasons', 'nope')
    const res = await handleFeedbackIntent(3, fd, 'owner')
    expect(res.ok).toBe(false)
  })
})

describe('list and summary shape', () => {
  it('listAssetFeedback maps the joined row', async () => {
    state.joinRows = [{
      assetId: 9, verdict: 'up', reasons: ['more-like-this'], note: null,
      createdAt: new Date('2026-09-25T01:00:00Z'), updatedAt: null,
      url: 'https://cdn/x.jpg', provider: 'fal', model: 'flux', prompt: 'p', negativePrompt: null,
      castSlugs: null, productHandle: 'h', tags: ['crop:box'], generationBatchId: 'b1', isPicked: false, postId: null,
    }]
    const items = await listAssetFeedback({ limit: 10 })
    expect(items[0]).toEqual({
      assetId: 9, url: 'https://cdn/x.jpg', provider: 'fal', model: 'flux', prompt: 'p', negativePrompt: null,
      castSlugs: [], productHandle: 'h', tags: ['crop:box'], generationBatchId: 'b1', isPicked: false, postId: null,
      verdict: 'up', reasons: ['more-like-this'], note: null, ratedAt: '2026-09-25T01:00:00.000Z',
    })
  })

  it('summarizeAssetFeedback counts by verdict and reason', async () => {
    state.summaryRows = [
      { verdict: 'up', reasons: ['on-message'] },
      { verdict: 'down', reasons: ['ai-artifact', 'too-tame'] },
      { verdict: 'down', reasons: ['ai-artifact'] },
    ]
    const s = await summarizeAssetFeedback(null)
    expect(s.total).toBe(3)
    expect(s.byVerdict).toEqual({ up: 1, down: 2 })
    expect(s.byReason.down['ai-artifact']).toBe(2)
    expect(s.byReason.down['too-tame']).toBe(1)
    expect(s.byReason.up['on-message']).toBe(1)
    expect(s.byReason.up['lighting']).toBe(0)
  })
})

function post(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/team/social-asset-feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return teamAction({ request, params: {}, context: {} } as never) as Promise<Response>
}

describe('team route is read only (owner-write only)', () => {
  it('rejects any write-shaped op and never writes', async () => {
    const spy = vi.spyOn(feedbackServer, 'setAssetFeedback')
    for (const op of ['set', 'upsert', 'create', 'update', 'delete']) {
      const res = await post({ op, assetId: 1, verdict: 'up' })
      expect(res.status).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
    expect(state.table.size).toBe(0)
  })

  it('list returns items and vocabulary', async () => {
    const res = await post({ op: 'list', verdict: 'up' })
    expect(res.status).toBe(200)
    const body = await res.json() as { items: unknown[]; vocabulary: { up: string[] } }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.vocabulary.up).toContain('on-message')
  })

  it('summary returns counts', async () => {
    const res = await post({ op: 'summary', since: '2026-09-01T00:00:00Z' })
    const body = await res.json() as { summary: { byVerdict: Record<string, number> } }
    expect(body.summary.byVerdict).toEqual({ up: 0, down: 0 })
  })

  it('rejects a bad verdict or since', async () => {
    expect((await post({ op: 'list', verdict: 'maybe' })).status).toBe(400)
    expect((await post({ op: 'summary', since: 'yesterday-ish' })).status).toBe(400)
  })
})
