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
  parseReworkInput,
  reworkSocialPost,
  markFeedbackAddressed,
  preserveGateStamp,
  splitGateStamp,
  effectiveGateStatus,
  hasGatePass,
  isTickEligible,
  gateStatusForVerdict,
  normaliseAgentFindings,
  type ApprovePatch,
  type ApproveRepo,
  type PostRow,
  type ReworkRepo,
  type ReworkPatch,
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
  const writes: ApprovePatch[] = []
  const captionScopes: string[] = []
  const repo: ApproveRepo = {
    load: async () => post,
    recentCaptions: async (_limit, platform) => { captionScopes.push(platform); return recent },
    write: async (_id, patch) => { writes.push(patch) },
  }
  return { repo, writes, captionScopes }
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

  // ── Phase 5 (#4913): the verdict lands in the columns, the stamp is dual-written ──

  it('writes gate_status, gate_checked_at and gate_findings on a PASS, alongside the stamp', async () => {
    const { repo, writes } = fakeRepo(row())
    const now = new Date('2026-08-23T10:00:00Z')
    const r = await applyPublishGateVerdict(7, verdict(), { repo, now: () => now, ...inStock })
    expect(r.ok).toBe(true)
    const w = writes[0]!
    expect(w.gateStatus).toBe('pass')
    expect(w.gateCheckedAt).toEqual(now)
    expect(w.updatedAt).toEqual(now)
    expect(Array.isArray(w.gateFindings)).toBe(true)
    // Dual write: the stamp is still there for the burn-in readers.
    expect(parseGateStamp(w.feedback)?.verdict).toBe('PASS')
  })

  it('maps REVISE, BLOCK and HOLD onto the column', async () => {
    for (const [v, col, status] of [
      ['REVISE', 'revise', 'needs_changes'],
      ['BLOCK', 'block', 'rejected'],
      ['HOLD-FOR-OWNER', 'hold', 'pending_review'],
    ] as const) {
      const { repo, writes } = fakeRepo(row())
      await applyPublishGateVerdict(7, verdict({ verdict: v, notes: 'something to fix' }), { repo, ...inStock })
      expect(writes[0]?.gateStatus).toBe(col)
      expect(writes[0]?.reviewStatus).toBe(status)
      expect(writes[0]?.gateCheckedAt).toBeInstanceOf(Date)
    }
  })

  it('stores the findings the agent itemised, in the stored shape', async () => {
    const { repo, writes } = fakeRepo(row())
    const v = verdict({
      findings: [
        { check: 'register', verdict: 'pass', note: 'intensity 4, within the Instagram band' },
        { check: 'imagery-ceiling', severity: 'warn', detail: 'close, but under' },
        { nonsense: true },
      ],
    })
    await applyPublishGateVerdict(7, v, { repo, ...inStock })
    expect(writes[0]?.gateFindings).toEqual(expect.arrayContaining([
      { check: 'register', verdict: 'pass', note: 'intensity 4, within the Instagram band' },
      { check: 'imagery-ceiling', verdict: 'revise', note: 'close, but under' },
    ]))
    expect(writes[0]?.gateFindings.some(f => f.check === 'nonsense')).toBe(false)
  })

  it('records the deterministic findings as revise on the column when they refuse a PASS', async () => {
    const { repo, writes } = fakeRepo(row({ mediaUrls: [`${CDN}/packshot.jpg`] }))
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r.ok).toBe(false)
    expect(writes[0]?.gateStatus).toBe('revise')
    expect(writes[0]?.gateFindings.length).toBeGreaterThan(0)
    expect(writes[0]?.gateFindings.every(f => typeof f.check === 'string' && typeof f.verdict === 'string')).toBe(true)
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
    ]) {
      const { repo, writes } = fakeRepo(row(over))
      const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.status).toBe(409)
      expect(writes).toHaveLength(0)
    }
  })

  // ── Platform scope ────────────────────────────────────────────────────────
  //
  // X ticks hourly and its valve is on, but until this gate would verdict an X
  // row, nothing in the fleet could write `approved` for it: every X draft sat
  // at pending_review and zero X posts ever published.

  it('approves a clean PASS on an X draft', async () => {
    const { repo, writes, captionScopes } = fakeRepo(row({ platform: 'x' }))
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r).toEqual({ ok: true, reviewStatus: 'approved' })
    expect(writes[0]?.reviewStatus).toBe('approved')
    // Repetition is judged against X's own feed, not Instagram's. The
    // crossplatform companion-post pattern says related things on both by
    // design, so a shared pool would block it.
    expect(captionScopes).toEqual(['x'])
  })

  it('applies X-only deterministic checks to an X draft', async () => {
    // Over-length is the check that exists on X and not on Instagram. It has to
    // run here rather than at publish time, because X bills for the media
    // upload before it rejects the post.
    const { repo, writes } = fakeRepo(row({ platform: 'x', tweetText: 'a'.repeat(400) }))
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r.ok).toBe(false)
    if (!r.ok && r.status === 422) {
      expect(r.findings.map(f => f.check)).toContain('caption-too-long')
    } else {
      throw new Error(`expected a 422 from the deterministic checks, got ${JSON.stringify(r)}`)
    }
    expect(writes[0]?.reviewStatus).toBe('needs_changes')
  })

  it('does not apply an Instagram-only check to an X draft', async () => {
    // A PDP link is a Restricted Goods signal on Instagram and the entire point
    // of the post on X. Gate-eligibility must not quietly export IG's rules.
    const { repo, writes } = fakeRepo(
      row({ platform: 'x', tweetText: 'What a wand actually does https://xdipx.com/products/dame-aer' }),
    )
    const r = await applyPublishGateVerdict(7, verdict(), { repo, ...inStock })
    expect(r).toEqual({ ok: true, reviewStatus: 'approved' })
    expect(writes[0]?.reviewStatus).toBe('approved')
  })

  it('refuses a platform nothing publishes unattended', async () => {
    // Approving one of these writes a row that either sits forever or ships
    // stale copy the day a publisher lands. Both already happened once.
    for (const platform of ['linkedin', 'tiktok', 'facebook', 'youtube'] as const) {
      const { repo, writes } = fakeRepo(row({ platform }))
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

// A gate REVISE strands a row at needs_changes; the {op:'draft'} idempotency
// guard (#4069) dedupes on caption so an imagery-only rework cannot land through
// draft, and applyPublishGateVerdict refuses anything not draft/pending_review
// so the gate cannot re-judge it. reworkSocialPost is the missing primitive that
// unsticks it via the team API — without weakening #4069's duplicate protection.
describe('parseReworkInput (#4351)', () => {
  it('accepts an imagery-only rework (mediaUrls, no caption change)', () => {
    const r = parseReworkInput({ mediaUrls: [`${CDN}/reworked-lead.jpg`] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.mediaUrls).toEqual([`${CDN}/reworked-lead.jpg`])
      expect(r.input.tweetText).toBeUndefined()
    }
  })

  it('accepts a copy-only rework (tweetText, no media change)', () => {
    const r = parseReworkInput({ tweetText: 'a cleaner line' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.tweetText).toBe('a cleaner line')
      expect(r.input.mediaUrls).toBeUndefined()
    }
  })

  it('rejects a bare re-gate that changes nothing (would loop)', () => {
    const r = parseReworkInput({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('rejects an empty mediaUrls array', () => {
    const r = parseReworkInput({ mediaUrls: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('rejects an empty tweetText', () => {
    const r = parseReworkInput({ tweetText: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  it('drops non-string mediaUrls entries and keeps the real ones', () => {
    const r = parseReworkInput({ mediaUrls: [`${CDN}/a.jpg`, 3, '', null, `${CDN}/b.jpg`] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.input.mediaUrls).toEqual([`${CDN}/a.jpg`, `${CDN}/b.jpg`])
  })
})

function fakeReworkRepo(post: PostRow | null) {
  const writes: Array<{ id: number; patch: ReworkPatch }> = []
  const repo: ReworkRepo = {
    load: async () => post,
    write: async (id, patch) => { writes.push({ id, patch }) },
  }
  return { repo, writes }
}

describe('reworkSocialPost (#4351)', () => {
  it('returns a needs_changes row to draft/pending_review with the new imagery', async () => {
    const { repo, writes } = fakeReworkRepo(
      row({ reviewStatus: 'needs_changes', feedback: '[publish-gate REVISE ...] set-dressing mug', reviewedBy: 'social-publish-gate', reviewedAt: new Date('2026-08-19') }),
    )
    const r = await reworkSocialPost(7, { mediaUrls: [`${CDN}/reworked-lead.jpg`] }, { repo })
    expect(r).toEqual({ ok: true, reviewStatus: 'pending_review' })
    expect(writes).toHaveLength(1)
    const patch = writes[0]!.patch
    expect(patch.status).toBe('draft')
    expect(patch.reviewStatus).toBe('pending_review')
    expect(patch.mediaUrls).toEqual([`${CDN}/reworked-lead.jpg`])
    // Ticket #5415: the instruction is preserved as addressed history, not
    // nulled, and the machine stamp header cannot resurrect as a live verdict.
    expect(patch.feedback).not.toBeNull()
    expect(patch.feedback).toContain('set-dressing mug')
    expect(patch.feedback).toMatch(/^\[addressed by rework on \d{4}-\d{2}-\d{2}\]/)
    expect(patch.feedback).not.toMatch(/^\[publish-gate/m)
    expect(patch.reviewedBy).toBeNull()
    expect(patch.reviewedAt).toBeNull()
    // And so are the gate columns (#4913): a reworked row has no verdict until
    // the gate looks again, so a later hand approval cannot ride a stale pass.
    expect(patch.gateStatus).toBeNull()
    expect(patch.gateCheckedAt).toBeNull()
    expect(patch.gateFindings).toBeNull()
    expect(patch.updatedAt).toBeInstanceOf(Date)
    // An imagery-only rework must NOT touch the caption (that is the #4069 trap).
    expect(patch.tweetText).toBeUndefined()
  })

  it('updates the caption on a copy rework', async () => {
    const { repo, writes } = fakeReworkRepo(row({ reviewStatus: 'needs_changes' }))
    const r = await reworkSocialPost(7, { tweetText: 'a cleaner line' }, { repo })
    expect(r.ok).toBe(true)
    expect(writes[0]!.patch.tweetText).toBe('a cleaner line')
  })

  it('404s on a post that does not exist', async () => {
    const { repo, writes } = fakeReworkRepo(null)
    const r = await reworkSocialPost(7, { mediaUrls: [`${CDN}/x.jpg`] }, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('refuses to resurrect a rejected (BLOCK) row', async () => {
    // BLOCK means drop the post; rework must never bring one back — the same
    // anti-capability applyPublishGateVerdict refuses.
    const { repo, writes } = fakeReworkRepo(row({ reviewStatus: 'rejected' }))
    const r = await reworkSocialPost(7, { mediaUrls: [`${CDN}/x.jpg`] }, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('refuses an already-approved row, keeping #4069 protection intact', async () => {
    const { repo, writes } = fakeReworkRepo(row({ reviewStatus: 'approved' }))
    const r = await reworkSocialPost(7, { tweetText: 'nope' }, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('refuses a still-pending row (nothing to rework yet)', async () => {
    const { repo, writes } = fakeReworkRepo(row({ reviewStatus: 'pending_review' }))
    const r = await reworkSocialPost(7, { mediaUrls: [`${CDN}/x.jpg`] }, { repo })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    expect(writes).toHaveLength(0)
  })
})

describe('markFeedbackAddressed (#5415)', () => {
  const NOW = new Date('2026-08-25T12:00:00Z')

  it('returns null for empty or absent feedback', () => {
    expect(markFeedbackAddressed(null, NOW)).toBeNull()
    expect(markFeedbackAddressed('', NOW)).toBeNull()
    expect(markFeedbackAddressed('   ', NOW)).toBeNull()
  })

  it('strips a real gate-stamp header but keeps its notes, prefixed as addressed', () => {
    const stamped = formatGateStamp(
      { verdict: 'REVISE', reviewer: 'social-publish-gate', notes: 'Drop the toy, add the cleaner.', productHandle: 'lace-set' },
      new Date('2026-08-20T00:00:00Z'),
    )
    const out = markFeedbackAddressed(stamped, NOW)
    expect(out).not.toBeNull()
    expect(out).toContain('Drop the toy, add the cleaner.')
    expect(out).toMatch(/^\[addressed by rework on 2026-08-25\]/)
    // The machine header must not survive: a later fallback reader (STAMP_RE
    // matches at any line start) must never re-parse this as a live verdict.
    expect(out).not.toMatch(/^\[publish-gate/m)
  })

  it('carries an owner note that rode behind the stamp forward untouched', () => {
    const stamped = formatGateStamp(
      { verdict: 'REVISE', reviewer: 'social-publish-gate', notes: 'Too tame for the register.', productHandle: null },
      new Date('2026-08-20T00:00:00Z'),
    )
    const withOwnerNote = `${stamped}\n\nOwner: also swap the backdrop.`
    const out = markFeedbackAddressed(withOwnerNote, NOW)
    expect(out).toContain('Owner: also swap the backdrop.')
    expect(out).toContain('Too tame for the register.')
  })

  it('preserves free-text feedback that carries no recognizable stamp shape at all', () => {
    const out = markFeedbackAddressed('Re-run with a cast member and a vibrator in their hand', NOW)
    expect(out).toBe('[addressed by rework on 2026-08-25] Re-run with a cast member and a vibrator in their hand')
  })
})

// ── Phase 5 burn-in helpers (#4913) ──────────────────────────────────────────

const PASS = formatGateStamp(
  { verdict: 'PASS', reviewer: 'social-publish-gate', notes: 'Looked at the frame and the feed.', productHandle: 'dame-aer' },
  new Date('2026-08-20T00:00:00Z'),
)

describe('preserveGateStamp / splitGateStamp', () => {
  it('carries the stamp block behind a replacing note, and the stamp still parses', () => {
    const out = preserveGateStamp(PASS, '[stock-guard] Linked product is out of stock.')
    expect(out?.startsWith('[stock-guard]')).toBe(true)
    expect(parseGateStamp(out)?.verdict).toBe('PASS')
    expect(parseGateStamp(out)?.productHandle).toBe('dame-aer')
  })

  it('is a plain overwrite when there was no stamp', () => {
    expect(preserveGateStamp('owner note', 'new note')).toBe('new note')
    expect(preserveGateStamp(null, null)).toBeNull()
    expect(preserveGateStamp(PASS, null)).toBe(PASS)
  })

  it('does not duplicate a stamp the new text already carries', () => {
    expect(preserveGateStamp(PASS, PASS)).toBe(PASS)
  })

  it('splits a stamp that sits behind an expiry prefix, keeping the rest', () => {
    const field = `[expired] Slot passed.\n${PASS}\n\nowner said: hold for Friday`
    const { stamp, rest } = splitGateStamp(field)
    expect(stamp).toBe(PASS)
    expect(rest).toBe('[expired] Slot passed.\n\nowner said: hold for Friday')
  })
})

describe('effectiveGateStatus / hasGatePass (column wins, stamp is fallback)', () => {
  it('reads the column when it is set', () => {
    expect(effectiveGateStatus({ gateStatus: 'pass', feedback: null })).toBe('pass')
    expect(hasGatePass({ gateStatus: 'pass', feedback: null })).toBe(true)
  })
  it('falls back to the stamp only when the column is null', () => {
    expect(effectiveGateStatus({ gateStatus: null, feedback: PASS })).toBe('pass')
    expect(hasGatePass({ gateStatus: null, feedback: PASS })).toBe(true)
  })
  it('a block column beats a stale PASS stamp', () => {
    expect(effectiveGateStatus({ gateStatus: 'block', feedback: PASS })).toBe('block')
    expect(hasGatePass({ gateStatus: 'block', feedback: PASS })).toBe(false)
  })
  it('is null with neither', () => {
    expect(effectiveGateStatus({ gateStatus: null, feedback: 'just a note' })).toBeNull()
  })
  it('maps every verdict', () => {
    expect(gateStatusForVerdict('PASS')).toBe('pass')
    expect(gateStatusForVerdict('REVISE')).toBe('revise')
    expect(gateStatusForVerdict('BLOCK')).toBe('block')
    expect(gateStatusForVerdict('HOLD')).toBe('hold')
  })

  // ── Ticket #5425: gate_status = 'owner' (an owner Studio approve) ──

  it('reads owner as a column-wins literal, same as pass/revise/block/hold', () => {
    expect(effectiveGateStatus({ gateStatus: 'owner', feedback: null })).toBe('owner')
  })

  it('an owner column beats a stale PASS or BLOCK stamp (column always wins)', () => {
    expect(effectiveGateStatus({ gateStatus: 'owner', feedback: PASS })).toBe('owner')
    const staleBlock = formatGateStamp({ verdict: 'BLOCK', reviewer: 'social-publish-gate', notes: 'old' }, new Date('2026-08-10'))
    expect(effectiveGateStatus({ gateStatus: 'owner', feedback: staleBlock })).toBe('owner')
  })

  it('hasGatePass never returns true for owner: it means "an agent verdicted PASS", nothing else', () => {
    expect(hasGatePass({ gateStatus: 'owner', feedback: null })).toBe(false)
    expect(hasGatePass({ gateStatus: 'owner', feedback: PASS })).toBe(false)
  })
})

describe('isTickEligible (the hourly publisher\'s predicate: pass or owner, ticket #5425)', () => {
  it.each([
    ['pass',   true],
    ['owner',  true],
    ['revise', false],
    ['block',  false],
    ['hold',   false],
    [null,     false],
  ] as const)('gate_status=%s -> %s', (gateStatus, expected) => {
    expect(isTickEligible({ gateStatus, feedback: null })).toBe(expected)
  })

  it('a null column with a legacy PASS stamp is still eligible (burn-in fallback)', () => {
    expect(isTickEligible({ gateStatus: null, feedback: PASS })).toBe(true)
  })

  it('an owner column beats a stale BLOCK stamp underneath it', () => {
    const staleBlock = formatGateStamp({ verdict: 'BLOCK', reviewer: 'social-publish-gate', notes: 'old' }, new Date('2026-08-10'))
    expect(isTickEligible({ gateStatus: 'owner', feedback: staleBlock })).toBe(true)
  })
})

describe('normaliseAgentFindings', () => {
  it('accepts both the stored and the deterministic shapes and drops junk', () => {
    expect(normaliseAgentFindings([
      { check: 'a', verdict: 'BLOCK', note: 'x' },
      { check: 'b', severity: 'hold', detail: 'y' },
      { check: 'c' },
      { verdict: 'pass' },
      'nope',
    ])).toEqual([
      { check: 'a', verdict: 'block', note: 'x' },
      { check: 'b', verdict: 'hold', note: 'y' },
      { check: 'c', verdict: 'pass' },
    ])
  })
  it('400s a non-array findings field', () => {
    expect(parsePublishGateVerdict(pass({ findings: 'x' })).ok).toBe(false)
  })
})
