// The pre-publish gate's write path.
//
// This is the code that decides whether a post becomes publishable at all, so
// the cases below are the ones where getting it wrong reaches a public account:
// an agent's PASS surviving a deterministic block, a product handle failing to
// reach publish time, a PASS that says nothing, and a verdict landing on a row
// that was not waiting for one.
import { describe, it, expect } from 'vitest'
import {
  parsePublishGateVerdict,
  applyPublishGateVerdict,
  formatGateStamp,
  parseGateStamp,
  PASS_NOTES_MIN,
  type ApproveRepo,
  type PostRow,
  type ReviewStatus,
} from './social-publish-approve.server'

const REAL_NOTES = 'Opened both frames, checked the bullet against the packshot, read the last 12 captions.'

function pass(over: Record<string, unknown> = {}) {
  return {
    verdict: 'PASS',
    reviewer: 'social-publish-gate',
    notes: REAL_NOTES,
    featuresProduct: false,
    ...over,
  }
}

describe('parsePublishGateVerdict', () => {
  it('accepts a complete PASS on a product-free post', () => {
    const r = parsePublishGateVerdict(pass())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.verdict.verdict).toBe('PASS')
      expect(r.verdict.productHandle).toBeUndefined()
    }
  })

  it('accepts HOLD-FOR-OWNER, which is how the agent definition spells it', () => {
    const r = parsePublishGateVerdict(pass({ verdict: 'HOLD-FOR-OWNER', notes: 'Novel case.' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.verdict.verdict).toBe('HOLD')
  })

  it('refuses a missing verdict rather than defaulting to anything', () => {
    expect(parsePublishGateVerdict(undefined).ok).toBe(false)
    expect(parsePublishGateVerdict({}).ok).toBe(false)
  })

  it('refuses a PASS that says nothing about what was looked at', () => {
    // A PASS is the verdict that ships unattended, so silence is the cheapest
    // wrong answer and the one worth making structurally impossible.
    const r = parsePublishGateVerdict(pass({ notes: 'ok' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(String(PASS_NOTES_MIN))
  })

  it('refuses a non-PASS with no reason for the drafter', () => {
    expect(parsePublishGateVerdict(pass({ verdict: 'REVISE', notes: '' })).ok).toBe(false)
  })

  it('requires featuresProduct to be stated, not omitted', () => {
    const { featuresProduct: _drop, ...withoutIt } = pass()
    const r = parsePublishGateVerdict(withoutIt)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('featuresProduct')
  })

  it('requires a handle when the post features a product', () => {
    expect(parsePublishGateVerdict(pass({ featuresProduct: true })).ok).toBe(false)
    expect(parsePublishGateVerdict(pass({ featuresProduct: true, productHandle: 'Not A Handle' })).ok).toBe(false)
    expect(parsePublishGateVerdict(pass({ featuresProduct: true, productHandle: 'dame-aer' })).ok).toBe(true)
  })

  it('refuses a handle on a post the gate says features no product', () => {
    // Otherwise the two fields can disagree and the stamp records a product the
    // gate never claimed to have checked.
    expect(parsePublishGateVerdict(pass({ productHandle: 'dame-aer' })).ok).toBe(false)
  })

  it('refuses an unknown verdict', () => {
    expect(parsePublishGateVerdict(pass({ verdict: 'APPROVE' })).ok).toBe(false)
  })
})

describe('the gate stamp', () => {
  const now = new Date('2026-08-15T18:00:00Z')

  it('round trips a product handle to publish time', () => {
    const stamp = formatGateStamp(
      { verdict: 'PASS', reviewer: 'social-publish-gate', notes: REAL_NOTES, productHandle: 'dame-aer' },
      now,
    )
    expect(parseGateStamp(stamp)).toEqual({
      verdict: 'PASS',
      reviewer: 'social-publish-gate',
      day: '2026-08-15',
      productHandle: 'dame-aer',
    })
  })

  it('round trips "no product" as an explicit null, not a missing field', () => {
    const stamp = formatGateStamp(
      { verdict: 'PASS', reviewer: 'social-publish-gate', notes: REAL_NOTES, productHandle: null },
      now,
    )
    expect(parseGateStamp(stamp)?.productHandle).toBeNull()
  })

  it('keeps the gate notes readable under the stamp', () => {
    // The owner reads this column in the Social Studio; the stamp is a header
    // on his feedback, not a replacement for it.
    const stamp = formatGateStamp(
      { verdict: 'REVISE', reviewer: 'social-publish-gate', notes: 'Catalog-on-a-table.' }, now,
    )
    expect(stamp).toContain('Catalog-on-a-table.')
    expect(parseGateStamp(stamp)?.verdict).toBe('REVISE')
  })

  it('reads no stamp out of the owner feedback that predates it', () => {
    expect(parseGateStamp(null)).toBeNull()
    expect(parseGateStamp("There's nothing in this image that is interesting.")).toBeNull()
    expect(parseGateStamp('[publish-gate MAYBE by x on 2026-08-15, product: none]')).toBeNull()
  })
})

// ── Applying a verdict ──────────────────────────────────────────────────────

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'

function row(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 7, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'the thing about silicone grades that nobody says out loud',
    mediaUrls: [`${CDN}/social-dame-aer-cast-priya-20260815-1.jpg`],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-15'), createdBy: 'agent',
    reviewStatus: 'pending_review', feedback: null, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-16',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    ...over,
  } as PostRow
}

function fakeRepo(post: PostRow | null, recent: string[] = []) {
  const writes: Array<{ reviewStatus: ReviewStatus; feedback: string }> = []
  const repo: ApproveRepo = {
    load: async () => post,
    recentCaptions: async () => recent,
    write: async (_id, patch) => { writes.push({ reviewStatus: patch.reviewStatus, feedback: patch.feedback }) },
  }
  return { repo, writes }
}

const verdict = (over: Record<string, unknown> = {}) => {
  const p = parsePublishGateVerdict(pass(over))
  if (!p.ok) throw new Error(`fixture is not a valid verdict: ${p.error}`)
  return p.verdict
}

describe('applyPublishGateVerdict', () => {
  const inStock = { gateDeps: { getAvailability: async () => true } }

  it('approves a clean PASS and stamps the verdict onto the row', async () => {
    const { repo, writes } = fakeRepo(row())
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r).toEqual({ ok: true, reviewStatus: 'approved' })
    expect(writes[0]?.reviewStatus).toBe('approved')
    expect(parseGateStamp(writes[0]?.feedback)?.verdict).toBe('PASS')
  })

  it('refuses a PASS the deterministic checks block, and does not approve', async () => {
    // The floor the agent may not lower. A stock-out is the exact case that put
    // a post on the feed on 2026-08-09 and had to be deleted.
    const { repo, writes } = fakeRepo(row())
    const r = await applyPublishGateVerdict(
      7,
      verdict({ featuresProduct: true, productHandle: 'dame-aer' }),
      { repo, gateDeps: { getAvailability: async () => false } },
    )
    expect(r.ok).toBe(false)
    if (!r.ok && r.status === 422) {
      expect(r.findings.map(f => f.check)).toContain('stock-out')
    } else {
      throw new Error('expected a 422 with findings')
    }
    expect(writes[0]?.reviewStatus).toBe('needs_changes')
    expect(writes[0]?.feedback).toContain('stock-out')
    // The stamp has to agree with the status beside it. Stamping BLOCK ("drop
    // it") on a row that says needs_changes ("fix it") tells the drafter two
    // different things about the same post.
    expect(parseGateStamp(writes[0]?.feedback)?.verdict).toBe('REVISE')
  })

  it('carries the product handle into the stamp so publish time can re-check it', async () => {
    const { repo, writes } = fakeRepo(row())
    await applyPublishGateVerdict(
      7, verdict({ featuresProduct: true, productHandle: 'dame-aer' }), { repo, ...inStock },
    )
    expect(parseGateStamp(writes[0]?.feedback)?.productHandle).toBe('dame-aer')
  })

  it('blocks a PASS on a packshot, whatever the gate claimed to see', async () => {
    const { repo, writes } = fakeRepo(row({ mediaUrls: [`${CDN}/nalpac-sku-40917.jpg`] }))
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r.ok).toBe(false)
    expect(writes[0]?.reviewStatus).toBe('needs_changes')
  })

  it('gates the edited caption, not the original draft', async () => {
    const { repo, writes } = fakeRepo(row({ editedText: 'get yours now for $39' }))
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r.ok).toBe(false)
    expect(writes[0]?.feedback).toContain('sale-')
  })

  it('sends REVISE back for a redraft and BLOCK to rejected', async () => {
    const a = fakeRepo(row())
    expect(await applyPublishGateVerdict(7, verdict({ verdict: 'REVISE', notes: 'Catalog-on-a-table.' }), { repo: a.repo }))
      .toEqual({ ok: true, reviewStatus: 'needs_changes' })

    const b = fakeRepo(row())
    expect(await applyPublishGateVerdict(7, verdict({ verdict: 'BLOCK', notes: 'Withholding test answered a body.' }), { repo: b.repo }))
      .toEqual({ ok: true, reviewStatus: 'rejected' })
  })

  it('leaves a HOLD where the owner will see it', async () => {
    const { repo, writes } = fakeRepo(row())
    const r = await applyPublishGateVerdict(7, verdict({ verdict: 'HOLD', notes: 'Novel case, not mine to self-certify.' }), { repo })
    expect(r).toEqual({ ok: true, reviewStatus: 'pending_review' })
    expect(writes[0]?.reviewStatus).toBe('pending_review')
  })

  it('does not skip the deterministic checks on a non-PASS', async () => {
    // A REVISE is not going anywhere, so verifying it would only cost a Shopify
    // round trip. Asserting it here so a future refactor does not quietly make
    // the expensive call on the cheap path.
    const seen: string[] = []
    const { repo } = fakeRepo(row())
    await applyPublishGateVerdict(
      7,
      verdict({ verdict: 'REVISE', notes: 'Too close to the last one.', featuresProduct: true, productHandle: 'dame-aer' }),
      { repo, gateDeps: { getAvailability: async (h) => { seen.push(h); return true } } },
    )
    expect(seen).toEqual([])
  })

  it('refuses to re-verdict anything that is not a draft awaiting review', async () => {
    // Re-verdicting a rejected row would resurrect it; touching a posted row
    // would rewrite history. Neither is a capability this needs.
    for (const over of [
      { reviewStatus: 'rejected' as const },
      { reviewStatus: 'approved' as const },
      { status: 'posted' as const },
      { platform: 'x' as const },
    ]) {
      const { repo, writes } = fakeRepo(row(over))
      const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(409)
      expect(writes).toHaveLength(0)
    }
  })

  it('404s on a post that does not exist', async () => {
    const { repo } = fakeRepo(null)
    const r = await applyPublishGateVerdict(7, verdict(), { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
  })
})
