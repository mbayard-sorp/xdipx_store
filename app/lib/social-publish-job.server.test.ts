// The Instagram scheduled-publish tick (ticket #2740).
//
// This is the code that puts a post on a public account with nobody watching,
// so the cases below are the ones where getting it wrong is expensive: double
// publishing, publishing past a cap, publishing something the gate blocked, and
// retrying forever against a live API.
import { describe, it, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  runSocialPublishTick,
  eligibleWhere,
  MAX_PER_TICK,
  type PublishRepo,
  type PostRow,
} from './social-publish-job.server'

const CDN = 'https://cdn.shopify.com/s/files/1/0761/6872/4651/files'

/**
 * A gate stamp on a product-free post. The default, because every publishable
 * row now carries one: `approved` alone no longer means anything reviewed it.
 */
const PASS_STAMP =
  '[publish-gate PASS by social-publish-gate on 2026-08-12, product: none]\nLooked at the frame and the last two weeks of the feed.'

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 1, platform: 'instagram', postType: 'campaign', externalPostId: null,
    parentPostId: null, dealHistoryId: null,
    tweetText: 'a detail about silicone grades nobody mentions out loud',
    mediaUrls: [`${CDN}/social-rosales-cast-maya-20260812-1.jpg`],
    mediaIds: null, status: 'draft', errorMessage: null, postedAt: null,
    createdAt: new Date('2026-08-01'), createdBy: 'agent',
    reviewStatus: 'approved', feedback: PASS_STAMP, editedText: null,
    reviewedBy: null, reviewedAt: null, scheduledFor: '2026-08-12',
    reworkedFrom: null, videoJobId: null, posterUrl: null,
    metricsJson: null, shopifyProductId: null,
    ...over,
  } as PostRow
}

/** An in-memory repo that records what the tick did. */
function fakeRepo(rows: PostRow[], over: Partial<PublishRepo> = {}) {
  const calls = {
    posted: [] as number[],
    needsChanges: [] as { id: number; feedback: string }[],
    failed: [] as { id: number; terminal: boolean }[],
    swept: 0,
  }
  const repo: PublishRepo = {
    sweepAbandoned: async () => { calls.swept++; return 0 },
    countPublishedToday: async () => 0,
    listEligible: async (limit) => rows.slice(0, limit),
    recentCaptions: async () => [],
    claim: async (id) => rows.find(r => r.id === id) ?? null,
    markPosted: async (id) => { calls.posted.push(id) },
    markNeedsChanges: async (id, feedback) => { calls.needsChanges.push({ id, feedback }) },
    markFailed: async (id, _d, terminal) => { calls.failed.push({ id, terminal }) },
    ...over,
  }
  return { repo, calls }
}

/**
 * The tick with the removal watch stubbed out.
 *
 * The watch reaches Instagram to check what is already live (ticket #2741) and
 * has its own tests; a publish case that also made eight Graph calls would be
 * testing two things and hanging on one of them.
 */
const tick = (opts: Parameters<typeof runSocialPublishTick>[0]) =>
  runSocialPublishTick({ removalWatch: async () => null, ...opts })

const enabled = async () => true
const cap = (n: number) => async () => n
const publishOk = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_1' }))

describe('the valve', () => {
  it('does nothing at all when off, which is how it ships', async () => {
    const { repo, calls } = fakeRepo([post()])
    const publish = vi.fn()
    const r = await tick({
      isEnabled: async () => false, maxPerDay: cap(3), publish, repo,
    })
    expect(r.skipped).toBe('valve_off')
    expect(publish).not.toHaveBeenCalled()
    // Not even the sweep runs: off means off.
    expect(calls.swept).toBe(0)
  })
})

describe('caps', () => {
  it('stops at the daily cap', async () => {
    const { repo } = fakeRepo([post()], { countPublishedToday: async () => 3 })
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.skipped).toBe('daily_cap')
    expect(publish).not.toHaveBeenCalled()
  })

  it('never asks for more rows than the day has room for', async () => {
    // Two already out, cap of 3: one slot left even though the tick allows more.
    const seen: number[] = []
    const { repo } = fakeRepo([], {
      countPublishedToday: async () => 2,
      listEligible: async (limit) => { seen.push(limit); return [] },
    })
    await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(seen).toEqual([1])
  })

  it('never exceeds the per-tick ceiling even with a large backlog', async () => {
    const seen: number[] = []
    const { repo } = fakeRepo([], {
      listEligible: async (limit) => { seen.push(limit); return [] },
    })
    await tick({ isEnabled: enabled, maxPerDay: cap(50), publish: publishOk, repo })
    expect(seen).toEqual([MAX_PER_TICK])
  })
})

describe('claiming', () => {
  it('skips a row another tick already took, instead of publishing it twice', async () => {
    const { repo } = fakeRepo([post()], { claim: async () => null })
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'claim_lost' }])
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── Durable stock guard (ticket #2212) ───────────────────────────────────────
//
// shopify_product_id is set once at draft time and read fresh on every
// publish attempt, independent of the gate stamp's own caller-supplied
// productHandle. These cases are the ones the gate-stamp check alone cannot
// cover: a row whose product went OOS with no gate re-check available, and the
// requirement that an ineligible row does not stop the rest of the tick.
describe('the durable stock guard (shopify_product_id)', () => {
  it('does not publish a linked product that is out of stock, and does not touch the network', async () => {
    const { repo, calls } = fakeRepo([post({ shopifyProductId: 'gid://shopify/Product/999' })])
    const publish = vi.fn()
    const checkStockByProductId = vi.fn(async () => false)
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo, checkStockByProductId,
    })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts).toEqual([{
      postId: 1, outcome: 'out_of_stock',
      detail: 'Linked product gid://shopify/Product/999 is out of stock.',
    }])
    expect(calls.needsChanges[0]?.feedback).toContain('stock-guard')
    expect(calls.needsChanges[0]?.feedback).toContain('out of stock')
    expect(checkStockByProductId).toHaveBeenCalledWith('gid://shopify/Product/999')
  })

  it('fails closed when the linked product cannot be verified at all', async () => {
    const { repo, calls } = fakeRepo([post({ shopifyProductId: 'gid://shopify/Product/404' })])
    const publish = vi.fn()
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      checkStockByProductId: async () => null,
    })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.outcome).toBe('out_of_stock')
    expect(calls.needsChanges[0]?.feedback).toContain('could not be verified')
  })

  it('publishes a linked product that is in stock', async () => {
    const { repo, calls } = fakeRepo([post({ shopifyProductId: 'gid://shopify/Product/1' })])
    const checkStockByProductId = vi.fn(async () => true)
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo, checkStockByProductId,
    })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
    expect(checkStockByProductId).toHaveBeenCalledWith('gid://shopify/Product/1')
  })

  it('skips the check entirely for a row with no product linkage, unaffected by the guard', async () => {
    const { repo, calls } = fakeRepo([post({ shopifyProductId: null })])
    const checkStockByProductId = vi.fn(async () => false)
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo, checkStockByProductId,
    })
    expect(checkStockByProductId).not.toHaveBeenCalled()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('does not stop the tick: an OOS row is skipped and the next eligible candidate still publishes', async () => {
    const oos = post({ id: 1, shopifyProductId: 'gid://shopify/Product/999' })
    const clean = post({ id: 2, shopifyProductId: null })
    const { repo, calls } = fakeRepo([oos, clean])
    const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_2' }))
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      checkStockByProductId: async (id) => id !== 'gid://shopify/Product/999',
    })
    expect(r.attempts.map(a => ({ postId: a.postId, outcome: a.outcome }))).toEqual([
      { postId: 1, outcome: 'out_of_stock' },
      { postId: 2, outcome: 'published' },
    ])
    expect(calls.posted).toEqual([2])
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('defaults to no stock check when checkStockByProductId is not supplied and the row has no linkage', async () => {
    // Production callers omit checkStockByProductId; must not throw or hang
    // on an unlinked row (the real lookup only runs when shopify_product_id
    // is actually set).
    const { repo, calls } = fakeRepo([post({ shopifyProductId: null })])
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })
})

describe('the gate runs at publish time', () => {
  it('does not publish a post carrying a retired packshot', async () => {
    const { repo, calls } = fakeRepo([post({ mediaUrls: [`${CDN}/77292A.jpg`] })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.outcome).toBe('blocked_by_gate')
    // Returned to the queue with a reason, not silently dropped.
    expect(calls.needsChanges[0]?.feedback).toContain('image-provenance')
  })

  it('does not publish a product that went out of stock after approval', async () => {
    // The 2026-08-09 incident: approved when in stock, published when not.
    const { repo, calls } = fakeRepo([post()])
    const publish = vi.fn()
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      productHandleFor: async () => 'gone-oos',
      gateDeps: { getAvailability: async () => false },
    })
    expect(publish).not.toHaveBeenCalled()
    expect(calls.needsChanges[0]?.feedback).toContain('stock-out')
  })

  it('refuses a row approved without a publish-gate PASS', async () => {
    // `approved` has two possible authors and only one of them is adversarial.
    // A row with no stamp is a row nothing independent has read, which under
    // autopublish is precisely the thing that must not go out.
    const { repo, calls } = fakeRepo([post({ feedback: null })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'no_gate_verdict' }])
    expect(calls.needsChanges[0]?.feedback).toContain('social-publish-gate')
  })

  it('does not tell the operator to re-gate the row it just bounced to needs_changes', async () => {
    // Ticket #4057: the row lands at needs_changes here, and applyPublishGateVerdict
    // only accepts draft/pending_review, so an instruction to run op:'gate' on this
    // exact row always 409s. The remedy has to point at the rework path instead
    // (a new draft carrying reworkedFrom:<id>, which lands at pending_review and
    // gets gated there).
    //
    // Ticket #5425 changed what the SECOND cause is: an owner approving by
    // hand in Social Studio no longer lands here at all (it stamps
    // gate_status='owner' and IS tick-eligible), so this branch is now the
    // genuinely anomalous case — approved through neither the gate nor a
    // Studio review click.
    const { repo, calls } = fakeRepo([post({ feedback: null })])
    const publish = vi.fn()
    await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    const message = calls.needsChanges[0]?.feedback ?? ''
    expect(message).not.toMatch(/op:\s*['"]gate['"]/)
    expect(message).toContain('reworkedFrom')
    expect(message).toMatch(/pre-gate leftover/i)
    expect(message).toMatch(/Social Studio review click/i)
  })

  it('refuses a row whose gate stamp is not a PASS', async () => {
    const held = '[publish-gate HOLD by social-publish-gate on 2026-08-12, product: none]\nNovel situation.'
    const { repo, calls } = fakeRepo([post({ feedback: held })])
    const publish = vi.fn()
    await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(calls.needsChanges).toHaveLength(1)
  })

  it('never ships a row carrying an unresolved BLOCK verdict, even if it somehow sits at approved (ticket #3895, incident id49)', async () => {
    // reviewStatus:'approved' on a row whose CURRENT feedback stamp reads BLOCK
    // should not exist by construction — reviewSocialPost refuses to write it —
    // but the tick is the last line of defense if that ever slips, and the
    // account-safety requirement is that a BLOCK can never ship, full stop.
    const blocked =
      '[publish-gate BLOCK by social-publish-gate on 2026-08-16, product: none]\n' +
      'Explicit imagery: rendered vulva and anatomical detail past the ads-policy ceiling.'
    const { repo, calls } = fakeRepo([post({ reviewStatus: 'approved', feedback: blocked })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'no_gate_verdict' }])
    expect(calls.needsChanges).toHaveLength(1)
    expect(calls.posted).toHaveLength(0)
  })

  it('takes the product handle from the gate stamp, so the stock check actually runs', async () => {
    // The gap this closes: nothing in production ever supplied productHandleFor,
    // so the publish-time stock re-check silently no-opped on every row.
    const stamped =
      '[publish-gate PASS by social-publish-gate on 2026-08-12, product: femmefunn-ultra-bullet]\nChecked stock and the frame.'
    const { repo, calls } = fakeRepo([post({ feedback: stamped })])
    const publish = vi.fn()
    const seen: string[] = []
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      gateDeps: { getAvailability: async (h) => { seen.push(h); return false } },
    })
    expect(seen).toEqual(['femmefunn-ultra-bullet'])
    expect(publish).not.toHaveBeenCalled()
    expect(calls.needsChanges[0]?.feedback).toContain('stock-out')
  })

  it('publishes a clean post', async () => {
    const { repo, calls } = fakeRepo([post()])
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
    })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  // ── Phase 5 (#4913): gate_status is the verdict of record, the stamp is burn-in fallback ──

  it('publishes on gate_status = pass with no stamp at all', async () => {
    const { repo, calls } = fakeRepo([post({ feedback: null, gateStatus: 'pass', gateCheckedAt: new Date('2026-08-12') })])
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('still publishes a legacy row: column null, stamp says PASS (burn-in)', async () => {
    const { repo, calls } = fakeRepo([post({ feedback: PASS_STAMP, gateStatus: null })])
    await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(calls.posted).toEqual([1])
  })

  it('does NOT publish when the column says block, even under a stale PASS stamp (column wins)', async () => {
    const { repo, calls } = fakeRepo([post({ feedback: PASS_STAMP, gateStatus: 'block' })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'no_gate_verdict' }])
    expect(calls.needsChanges).toHaveLength(1)
  })

  it('refuses revise and hold columns too', async () => {
    for (const gateStatus of ['revise', 'hold'] as const) {
      const { repo } = fakeRepo([post({ feedback: PASS_STAMP, gateStatus })])
      const publish = vi.fn()
      await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
      expect(publish).not.toHaveBeenCalled()
    }
  })

  // ── Ticket #5425: gate_status = 'owner' is tick-eligible like 'pass' ──

  it('publishes on gate_status = owner with no stamp at all (an owner Studio approve)', async () => {
    const { repo, calls } = fakeRepo([post({ feedback: null, gateStatus: 'owner', gateCheckedAt: new Date('2026-08-25') })])
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('publishes on gate_status = owner even under a stale BLOCK stamp in feedback (column wins)', async () => {
    // The exact fallthrough the fix has to close: effectiveGateStatus must
    // recognize 'owner' as a column-wins literal, same as 'pass'/'revise'/
    // 'block'/'hold', or a row like this falls through to the legacy stamp
    // parser and a stale BLOCK reads as a live one, or worse, an owner
    // approval reads as though nothing verdicted it at all.
    const staleBlock =
      '[publish-gate BLOCK by social-publish-gate on 2026-08-10, product: none]\n' +
      'Explicit imagery, past the ads-policy ceiling.'
    const { repo, calls } = fakeRepo([post({ feedback: staleBlock, gateStatus: 'owner' })])
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('an owner verdict does not exempt the row from the deterministic gate re-run at publish time', async () => {
    // 'owner' is a JUDGMENT substitute, not a bypass of the FACT checks: an
    // out-of-stock product still bounces the row even when gate_status='owner'.
    const { repo, calls } = fakeRepo([post({ feedback: null, gateStatus: 'owner' })])
    const publish = vi.fn()
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      productHandleFor: async () => 'gone-oos',
      gateDeps: { getAvailability: async () => false },
    })
    expect(publish).not.toHaveBeenCalled()
    expect(calls.needsChanges[0]?.feedback).toContain('stock-out')
  })

  it('takes the product handle from shopify_product_id ahead of the stamp', async () => {
    const stamped =
      '[publish-gate PASS by social-publish-gate on 2026-08-12, product: stale-handle]\nChecked stock and the frame.'
    const { repo } = fakeRepo([post({ feedback: stamped, gateStatus: 'pass', shopifyProductId: 'gid://shopify/Product/42' })])
    const seen: string[] = []
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
      checkStockByProductId: async () => true,
      productHandleById: async (id) => (id === 'gid://shopify/Product/42' ? 'fresh-handle' : null),
      gateDeps: { getAvailability: async (h) => { seen.push(h); return true } },
    })
    expect(seen).toEqual(['fresh-handle'])
  })

  it('falls back to the stamp handle when the linkage cannot be resolved', async () => {
    const stamped =
      '[publish-gate PASS by social-publish-gate on 2026-08-12, product: stamp-handle]\nChecked stock and the frame.'
    const { repo } = fakeRepo([post({ feedback: stamped, gateStatus: 'pass', shopifyProductId: 'gid://shopify/Product/42' })])
    const seen: string[] = []
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
      checkStockByProductId: async () => true,
      productHandleById: async () => null,
      gateDeps: { getAvailability: async (h) => { seen.push(h); return true } },
    })
    expect(seen).toEqual(['stamp-handle'])
  })

  it('keeps the PASS stamp behind the stock-guard note when it bounces a row (burn-in)', async () => {
    const { repo, calls } = fakeRepo([post({ feedback: PASS_STAMP, gateStatus: 'pass', shopifyProductId: 'gid://shopify/Product/9' })])
    await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
      checkStockByProductId: async () => false,
    })
    const fb = calls.needsChanges[0]?.feedback ?? ''
    expect(fb.startsWith('[stock-guard]')).toBe(true)
    expect(fb).toContain('[publish-gate PASS by social-publish-gate')
  })

  it('carries a publish note into the tick report, so an untagged-with-reason publish is visible in the run event (ticket #3744)', async () => {
    // The exact drop this ticket bounced on: an IG post that published but
    // untagged (product not approved for tagging) returns { ok, note } from the
    // adapter. If the tick discards the note, the run event cannot tell an
    // untagged publish from a normal one, which is half of the DONE WHEN.
    const { repo, calls } = fakeRepo([post()])
    const note = 'published untagged: product femmefunn-ultra-bullet not approved for tagging'
    const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_1', note }))
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published', detail: note }])
    expect(calls.posted).toEqual([1])
  })

  it('leaves the published attempt detail-free when the adapter returns no note', async () => {
    // A normal tagged (or note-less) publish must not sprout an empty detail.
    const { repo } = fakeRepo([post()])
    const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_1' }))
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
  })

  it('publishes a fanned-out video row once the gate has PASSed it (ticket #3733)', async () => {
    // The row exactly as the Video Studio fanout + a gate PASS leave it: a
    // pipeline final on Blob (which must clear image-provenance without a
    // `social-` filename), a videoJobId, a scheduledFor, and a stamp naming the
    // product so the stock re-check runs.
    const stamped =
      '[publish-gate PASS by social-publish-gate on 2026-08-16, product: femmefunn-ultra-bullet]\nWatched the final, checked stock and the last two weeks of the feed.'
    const reel = post({
      postType: 'video_reel',
      mediaUrls: ['https://abc123.public.blob.vercel-storage.com/video/6f9c2f1e-2b7d-4a83-9b1a-000000000000/final-Ab12Cd.mp4'],
      videoJobId: 7,
      feedback: stamped,
    })
    const { repo, calls } = fakeRepo([reel])
    const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'ig_reel_1' }))
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      gateDeps: { getAvailability: async () => true },
    })
    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(calls.posted).toEqual([1])
  })

  it('still refuses a raw pipeline intermediate (clip, not final) as post media', async () => {
    const { repo, calls } = fakeRepo([post({
      mediaUrls: ['https://abc123.public.blob.vercel-storage.com/video/6f9c2f1e-2b7d-4a83-9b1a-000000000000/clip-Xy34Zw.mp4'],
      videoJobId: 7,
    })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.outcome).toBe('blocked_by_gate')
    expect(calls.needsChanges[0]?.feedback).toContain('image-provenance')
  })
})

// ── End-to-end X media path (ticket #4131) ───────────────────────────────────
//
// #4131's second DONE WHEN: "a gated X draft with a generated asset publishes
// live via /cron/social-publish." The write-time guard (ticket #4140,
// api.team.social-post.tsx) stops a media-less X draft from ever being
// created; this proves the other half of the pipeline actually works once a
// draft DOES carry media — that a real (non-stubbed) run of
// `runDeterministicPublishChecks` lets it through and the tick reaches the
// platform's publish call, exactly as `/cron/social-publish` does per
// `social-publish-run.server.ts`'s `xTickDeps` (server/cron.ts registers the
// route and only awaits `runAllSocialPublishTicks`, so this tick-level test is
// the real substance behind that route).
describe('an X draft with a generated asset reaches the publish call (ticket #4131)', () => {
  it('gates PASS and publishes an X row that carries mediaUrls', async () => {
    // platform: 'x', mediaUrls carried from post()'s default (a generated
    // `social-` asset), reviewStatus 'approved', and a real gate-stamp PASS —
    // exactly what the write-time guard now requires before a draft can exist.
    // No gateDeps override: the real runDeterministicPublishChecks runs.
    const { repo, calls } = fakeRepo([post({ platform: 'x' })])
    const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'x_42' }))
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })

    expect(r.attempts).toEqual([{ postId: 1, outcome: 'published' }])
    expect(publish).toHaveBeenCalledTimes(1)
    // The mocked publish call stands in for the X API adapter (no live
    // network); the row reaching it is the thing under test.
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      platform: 'x',
      mediaUrls: expect.arrayContaining([expect.stringContaining('social-')]),
    }))
    expect(calls.posted).toEqual([1])
  })

  it('still blocks an X row that reached this far with no media (belt and suspenders behind the write-time guard)', async () => {
    // The write-time guard makes this row impossible to draft going forward,
    // but the publish-time gate is the independent, non-bypassable backstop —
    // this is what actually protects a row that predates the guard.
    const { repo, calls } = fakeRepo([post({ platform: 'x', mediaUrls: [] })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })

    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.outcome).toBe('blocked_by_gate')
    expect(calls.needsChanges[0]?.feedback).toContain('image-provenance')
  })
})

describe('failure handling', () => {
  it('returns a first failure to the queue rather than giving up', async () => {
    const { repo, calls } = fakeRepo([post({ errorMessage: null })])
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), repo,
      publish: async () => ({ ok: false, detail: 'Meta 500' }),
    })
    expect(calls.failed).toEqual([{ id: 1, terminal: false }])
    expect(r.attempts[0]?.detail).toContain('will retry')
  })

  it('goes terminal on the second failure instead of retrying forever', async () => {
    // A row already carrying an error message is on its second attempt.
    const { repo, calls } = fakeRepo([post({ errorMessage: 'Meta 500' })])
    const r = await tick({
      isEnabled: enabled, maxPerDay: cap(3), repo,
      publish: async () => ({ ok: false, detail: 'Meta 500 again' }),
    })
    expect(calls.failed).toEqual([{ id: 1, terminal: true }])
    expect(r.attempts[0]?.detail).toContain('terminal')
  })
})

describe('the owner edit wins', () => {
  it('gates and publishes the edited caption, not the original draft', async () => {
    // If he rewrote it, the rewrite is what ships and what gets checked.
    const { repo } = fakeRepo([post({
      tweetText: 'original',
      editedText: 'his rewrite, $19.99 today only',
    })])
    const publish = vi.fn()
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(r.attempts[0]?.findings?.map(f => f.check)).toContain('sale-price')
  })
})

describe('the removal watch guards the tick', () => {
  it('does not publish at all when the watch just turned the valve off', async () => {
    // Order matters: the watch runs before listEligible, so a tick that has
    // just stopped the channel does not then add two more posts to it.
    const { repo } = fakeRepo([post()])
    const publish = vi.fn()
    const r = await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), publish, repo,
      removalWatch: async () => ({
        checked: 3, removed: [17], removalsInWindow: 2, unknown: 0, valveTurnedOff: true,
      }),
    })
    expect(r.skipped).toBe('removal_pattern')
    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes normally after a single removal, which only steps volume down', async () => {
    const { repo } = fakeRepo([post()])
    const r = await runSocialPublishTick({
      isEnabled: enabled, maxPerDay: cap(3), publish: publishOk, repo,
      removalWatch: async () => ({
        checked: 3, removed: [17], removalsInWindow: 1, unknown: 0, frequencySteppedTo: 1,
      }),
    })
    expect(r.attempts[0]?.outcome).toBe('published')
    expect(r.watch?.frequencySteppedTo).toBe(1)
  })
})

// ── Spend guard (X, 2026-08-16) ──────────────────────────────────────────────
//
// X bills per post, and a post carrying a link costs more than 13x a plain one.
// These are the cases where getting the guard wrong costs actual money or
// silently kills good posts: overshooting the ceiling, charging for posts that
// never published, and the interaction with the two-strike failure rule.
describe('X spend guard', () => {
  /**
   * A fresh success mock per test.
   *
   * Not the module-level `publishOk`: that one is shared across this file and
   * never reset, and wrapping it carries its accumulated call count into these
   * assertions.
   */
  const freshOk = () => vi.fn(async () => ({ ok: true as const, externalPostId: 'x_1' }))

  const PDP = 'https://xdipx.com/products/rosales-maya'
  /** A linked X post: $0.20 each. */
  const xPost = (id: number) => post({
    id, platform: 'x', tweetText: `a detail worth knowing ${PDP}`,
  })

  const xDeps = (spent: number, max: number) => ({
    platform: 'x' as const,
    isEnabled: async () => true,
    maxPerDay: cap(10),
    monthSpendUsd: async () => spent,
    maxSpendUsd: async () => max,
    removalWatch: async () => null,
  })

  it('skips the whole tick when the month is already spent', async () => {
    const { repo, calls } = fakeRepo([xPost(1)])
    const publish = freshOk()
    const r = await tick({ ...xDeps(15, 15), publish, repo })
    expect(r.skipped).toBe('spend_cap')
    expect(publish).not.toHaveBeenCalled()
    expect(calls.posted).toEqual([])
  })

  it('stops before a post that would cross the ceiling', async () => {
    // $14.90 spent against a $15 ceiling leaves $0.10, and a linked post costs
    // $0.20. Publishing it would overshoot, so it must not publish at all.
    const { repo, calls } = fakeRepo([xPost(1)])
    const publish = freshOk()
    const r = await tick({ ...xDeps(14.9, 15), publish, repo })
    expect(publish).not.toHaveBeenCalled()
    expect(calls.posted).toEqual([])
    expect(r.attempts[0]?.outcome).toBe('spend_cap')
  })

  it('leaves the unaffordable row untouched in the queue', async () => {
    // The row is fine; we simply cannot afford it this month. Marking it failed
    // would write an error message, which makes its NEXT attempt terminal under
    // the two-strike rule, permanently killing a good post over a budget pause.
    const { repo, calls } = fakeRepo([xPost(1)])
    await tick({ ...xDeps(14.9, 15), publish: freshOk(), repo })
    expect(calls.failed).toEqual([])
    expect(calls.needsChanges).toEqual([])
  })

  it('publishes what fits and stops at the first post that does not', async () => {
    // $14.75 leaves $0.25: exactly one $0.20 post fits, the second does not.
    const { repo, calls } = fakeRepo([xPost(1), xPost(2)])
    const publish = freshOk()
    const r = await tick({ ...xDeps(14.75, 15), publish, repo })
    expect(calls.posted).toEqual([1])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(r.attempts.map(a => a.outcome)).toEqual(['published', 'spend_cap'])
  })

  it('does not charge the budget for a post that failed to publish', async () => {
    // A failed publish costs nothing. Charging at claim time would shrink the
    // month's budget for a post that never reached X.
    const { repo } = fakeRepo([xPost(1), xPost(2)])
    const publish = vi.fn(async () => ({ ok: false as const, detail: 'boom' }))
    const r = await tick({ ...xDeps(14.75, 15), publish, repo })
    // Both were attempted: the first failed and so spent nothing, leaving room
    // for the second to be attempted too rather than being cut off.
    expect(publish).toHaveBeenCalledTimes(2)
    expect(r.spendUsd).toBeCloseTo(14.75, 10)
  })

  it('reports month-to-date spend including this tick', async () => {
    const { repo } = fakeRepo([xPost(1)])
    const r = await tick({ ...xDeps(1, 15), publish: freshOk(), repo })
    expect(r.spendUsd).toBeCloseTo(1.2, 10)
    expect(r.platform).toBe('x')
  })

  it('never budget-checks a platform that supplies no spend deps', async () => {
    // Instagram publishing is free. Supplying neither half must leave the tick
    // behaving exactly as it did before the guard existed.
    const { repo, calls } = fakeRepo([post({ id: 1 })])
    const r = await tick({ isEnabled: enabled, maxPerDay: cap(3), publish: freshOk(), repo })
    expect(calls.posted).toEqual([1])
    expect(r.spendUsd).toBeUndefined()
    expect(r.skipped).toBeUndefined()
  })
})

// ── The eligibility predicate ────────────────────────────────────────────────
//
// Rendered to SQL rather than run, because what went wrong here was the shape
// of the predicate and not the tick logic that consumes it: an approved row
// with a NULL scheduled_for satisfied no comparison and so was invisible to the
// only thing that publishes it, forever and silently.

describe('eligibleWhere', () => {
  const render = (platform: 'instagram' | 'x') => {
    const q = new PgDialect().sqlToQuery(eligibleWhere(platform)!)
    return { sql: q.sql, params: q.params }
  }

  it('treats an undated approved row as due', () => {
    const { sql } = render('instagram')
    // Undated means BOTH columns null, not either.
    expect(sql).toMatch(/"scheduled_at" is null and .*"scheduled_for" is null/)
    // Undated OR due, not undated AND due.
    expect(sql.toLowerCase()).toContain(' or ')
  })

  it('reads due-ness as COALESCE(scheduled_at, scheduled_for::timestamptz) <= now() (Phase 4)', () => {
    const { sql } = render('instagram')
    expect(sql).toContain('coalesce("social_posts"."scheduled_at", "social_posts"."scheduled_for"::timestamptz) <= now()')
    // The date-only comparison is gone; a slot at 09:00 PDT is not due at 00:00 UTC.
    expect(sql).not.toContain('current_date')
  })

  it('still requires an approved draft on the tick\'s own platform', () => {
    const { sql, params } = render('x')
    expect(params).toContain('x')
    expect(params).toContain('draft')
    expect(params).toContain('approved')
    // A NULL date must widen the date test only. If it ever widened the review
    // test, an unreviewed draft would publish itself.
    expect(sql.slice(0, sql.indexOf('is null'))).toContain('review_status')
  })
})
