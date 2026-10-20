import { describe, expect, it } from 'vitest'
import { computeBreakEven } from '~/lib/ad-metrics-core'
import {
  allKeys, buildTree, filterNodes, matchesStatus, parseOpen, parseStatusFilter, serializeOpen, studioHrefFor,
  type TreeEntityRow, type TreeFilters, type TreeInput, type TreeInsightRow, type TreeNode,
} from './tree-core'

const TODAY = '2026-10-19'
const BE = computeBreakEven(3000, 50) // break-even ROAS 2.0

function ent(over: Partial<TreeEntityRow> & Pick<TreeEntityRow, 'level' | 'externalId'>): TreeEntityRow {
  return {
    platform: 'meta', accountId: 'act_1', parentExternalId: null, name: over.externalId,
    status: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: null,
    dailyBudgetCents: null, lifetimeBudgetCents: null, creativeId: null,
    ...over,
  }
}

function ins(level: string, externalId: string, day: string, spendCents: number, extra: Partial<TreeInsightRow> = {}): TreeInsightRow {
  return { level, externalId, day, spendCents, impressions: 1000, clicks: 10, leads: 0, ...extra }
}

const ALL: TreeFilters = { platform: null, status: 'all', campaignId: null }

function input(over: Partial<TreeInput> = {}): TreeInput {
  return {
    entities: [
      ent({ level: 'campaign', externalId: 'c1', name: 'Leads', dailyBudgetCents: 2000 }),
      ent({ level: 'adset', externalId: 's1', parentExternalId: 'c1', name: 'Broad' }),
      ent({ level: 'adset', externalId: 's2', parentExternalId: 'c1', name: 'Retarget', effectiveStatus: 'PAUSED' }),
      ent({ level: 'ad', externalId: 'a1', parentExternalId: 's1', name: 'img01', creativeId: 11 }),
      ent({ level: 'ad', externalId: 'a2', parentExternalId: 's1', name: 'img02', creativeId: 12, effectiveStatus: 'DISAPPROVED' }),
      ent({ level: 'ad', externalId: 'a3', parentExternalId: 's2', name: 'img03', effectiveStatus: 'ADSET_PAUSED' }),
      ent({ level: 'campaign', externalId: 'c2', name: 'Sales', status: 'PAUSED', effectiveStatus: 'PAUSED' }),
      ent({ level: 'adset', externalId: 's3', parentExternalId: 'c2', name: 'ABO', lifetimeBudgetCents: 50000 }),
      ent({ level: 'ad', externalId: 'a4', parentExternalId: 's3', name: 'vid01', creativeId: 13 }),
    ],
    insights: [
      ins('ad', 'a1', TODAY, 300, { leads: 1 }),
      ins('ad', 'a1', '2026-10-15', 500, { leads: 1 }),
      ins('ad', 'a2', '2026-10-14', 400, { leads: 2 }),
      ins('ad', 'a3', '2026-10-01', 900, { leads: 0 }), // inside 30d, outside 7d
      ins('ad', 'a4', TODAY, 1000, { leads: null }),
    ],
    creativeDays: [
      { creativeId: 11, day: '2026-10-16', orders: 1, netRevenueCents: 3000 },
      { creativeId: 12, day: '2026-10-02', orders: 2, netRevenueCents: 5000 }, // 30d only
      { creativeId: 13, day: TODAY, orders: 1, netRevenueCents: 1500 },
    ],
    creatives: [{ id: 11, ideaId: 7 }, { id: 12, ideaId: null }],
    leadCplCeilingCents: 300,
    breakEven: BE,
    linkFor: r => `https://ads.example/${r.level}/${r.externalId}`,
    ...over,
  }
}

function find(nodes: TreeNode[], key: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n
    const hit = find(n.children, key)
    if (hit) return hit
  }
  return undefined
}

describe('buildTree: parent linking', () => {
  it('nests campaign > ad set > ad by parent_external_id, campaigns first by name', () => {
    const t = buildTree(input(), ALL, TODAY)
    expect(t.roots.map(r => r.key)).toEqual(['campaign:c1', 'campaign:c2'])
    const c1 = t.roots[0]!
    expect(c1.children.map(c => c.key)).toEqual(['adset:s1', 'adset:s2'])
    expect(c1.children[0]!.children.map(a => a.key)).toEqual(['ad:a1', 'ad:a2'])
    expect(c1.descendantCount).toBe(5)
    expect(t.totals).toEqual({ campaigns: 2, adsets: 3, ads: 4, removedHidden: 0 })
    expect(t.shown).toBe(9)
    expect(t.campaigns).toEqual([{ externalId: 'c1', name: 'Leads' }, { externalId: 'c2', name: 'Sales' }])
  })

  it('keeps an ad set whose campaign is not mirrored as an orphan root', () => {
    const t = buildTree(input({ entities: [ent({ level: 'adset', externalId: 's9', parentExternalId: 'gone' })] }), ALL, TODAY)
    expect(t.roots).toHaveLength(1)
    expect(t.roots[0]!.orphan).toBe(true)
  })

  it('hides rows the platform stopped returning and counts them', () => {
    const base = input()
    const t = buildTree(input({ entities: [...base.entities, ent({ level: 'ad', externalId: 'a9', parentExternalId: 's1', status: 'MISSING' })] }), ALL, TODAY)
    expect(find(t.roots, 'ad:a9')).toBeUndefined()
    expect(t.totals.removedHidden).toBe(1)
  })

  it('ignores creative-level mirror rows', () => {
    const base = input()
    const t = buildTree(input({ entities: [...base.entities, ent({ level: 'creative', externalId: 'cr1' })] }), ALL, TODAY)
    expect(t.totals.ads).toBe(4)
  })

  it('carries the Ads Manager link and the Ad Studio link', () => {
    const t = buildTree(input(), ALL, TODAY)
    expect(find(t.roots, 'campaign:c1')!.adsManagerHref).toBe('https://ads.example/campaign/c1')
    expect(find(t.roots, 'ad:a1')!.studioHref).toBe('/admin/ad-studio/creatives?idea=7&view=all')
    expect(find(t.roots, 'ad:a2')!.studioHref).toBe('/admin/ad-studio/creatives?view=all')
    expect(find(t.roots, 'ad:a3')!.studioHref).toBeNull()
  })
})

describe('buildTree: roll-ups', () => {
  it('sums children when the parent has no insight rows of its own', () => {
    const t = buildTree(input(), ALL, TODAY)
    const s1 = find(t.roots, 'adset:s1')!
    expect(s1.d7.spendCents).toBe(1200)
    expect(s1.d1.spendCents).toBe(300)
    expect(s1.source7).toBe('children')
    const c1 = find(t.roots, 'campaign:c1')!
    expect(c1.d7.spendCents).toBe(1200)
    expect(c1.d30.spendCents).toBe(2100)
    expect(c1.d7.impressions).toBe(3000)
    expect(c1.d7.leads).toBe(4)
  })

  it('uses the parent row when the pull has one, instead of summing children', () => {
    const base = input()
    const t = buildTree(input({ insights: [...base.insights, ins('campaign', 'c1', TODAY, 999, { leads: 3 })] }), ALL, TODAY)
    const c1 = find(t.roots, 'campaign:c1')!
    expect(c1.d1.spendCents).toBe(999)
    expect(c1.d7.spendCents).toBe(999)
    expect(c1.source7).toBe('own')
  })

  it('reports none when nothing below spent', () => {
    const t = buildTree(input({ insights: [] }), ALL, TODAY)
    expect(find(t.roots, 'campaign:c1')!.source7).toBe('none')
    expect(find(t.roots, 'campaign:c1')!.d7.spendCents).toBe(0)
  })

  it('takes the budget from the entity that owns it', () => {
    const t = buildTree(input(), ALL, TODAY)
    expect(find(t.roots, 'campaign:c1')!.budget).toEqual({ kind: 'daily', cents: 2000, owner: 'self' })
    expect(find(t.roots, 'adset:s1')!.budget).toEqual({ kind: 'daily', cents: 2000, owner: 'campaign' })
    expect(find(t.roots, 'ad:a1')!.budget).toEqual({ kind: 'daily', cents: 2000, owner: 'campaign' })
    expect(find(t.roots, 'campaign:c2')!.budget).toBeNull()
    expect(find(t.roots, 'adset:s3')!.budget).toEqual({ kind: 'lifetime', cents: 50000, owner: 'self' })
    expect(find(t.roots, 'ad:a4')!.budget).toEqual({ kind: 'lifetime', cents: 50000, owner: 'adset' })
  })
})

describe('buildTree: CPL and ROAS math', () => {
  it('computes CTR and CPL and flags CPL above the ceiling', () => {
    const t = buildTree(input(), ALL, TODAY)
    const a1 = find(t.roots, 'ad:a1')!
    expect(a1.d7.leads).toBe(2)
    expect(a1.d7.cplCents).toBe(400)
    expect(a1.d7.cplOver).toBe(true) // ceiling 300
    expect(a1.d7.ctrPct).toBeCloseTo(1, 5)
    const a2 = find(t.roots, 'ad:a2')!
    expect(a2.d7.cplCents).toBe(200)
    expect(a2.d7.cplOver).toBe(false)
    const a4 = find(t.roots, 'ad:a4')!
    expect(a4.d7.leads).toBe(0) // null leads count as none
    expect(a4.d7.cplCents).toBeNull()
  })

  it('attributes orders, CPA and net ROAS per creative, 7d and 30d', () => {
    const t = buildTree(input(), ALL, TODAY)
    const a1 = find(t.roots, 'ad:a1')!
    expect(a1.orders7).toMatchObject({ orders: 1, netRevenueCents: 3000, cpaCents: 800 })
    expect(a1.orders7!.netRoas).toBeCloseTo(3000 / 800, 5)
    expect(a1.orders7!.roasOk).toBe(true)
    const a2 = find(t.roots, 'ad:a2')!
    expect(a2.orders7).toMatchObject({ orders: 0, cpaCents: null, roasOk: null })
    expect(a2.orders30).toMatchObject({ orders: 2, netRevenueCents: 5000 })
    expect(find(t.roots, 'ad:a3')!.orders7).toBeNull()
    const a4 = find(t.roots, 'ad:a4')!
    expect(a4.orders7!.netRoas).toBeCloseTo(1.5, 5)
    expect(a4.orders7!.roasOk).toBe(false)
  })

  it('rolls orders up per distinct creative, against the parent spend', () => {
    const t = buildTree(input(), ALL, TODAY)
    const c1 = find(t.roots, 'campaign:c1')!
    expect(c1.orders7).toMatchObject({ orders: 1, netRevenueCents: 3000, cpaCents: 1200 })
    expect(c1.orders30).toMatchObject({ orders: 3, netRevenueCents: 8000 })
    expect(c1.orders30!.netRoas).toBeCloseTo(8000 / 2100, 5)
  })

  it('counts a shared creative once under a parent and splits ROAS over every ad carrying it', () => {
    const base = input()
    const entities = base.entities.map(e => (e.externalId === 'a2' ? { ...e, creativeId: 11 } : e))
    const t = buildTree(input({ entities }), ALL, TODAY)
    const s1 = find(t.roots, 'adset:s1')!
    expect(s1.orders7!.orders).toBe(1)
    const a1 = find(t.roots, 'ad:a1')!
    const a2 = find(t.roots, 'ad:a2')!
    expect(a1.sharedCreative).toBe(true)
    expect(a2.sharedCreative).toBe(true)
    // 3000 revenue over a1 800 + a2 400 spend
    expect(a1.orders7!.netRoas).toBeCloseTo(3000 / 1200, 5)
    expect(a2.orders7!.netRoas).toBeCloseTo(3000 / 1200, 5)
  })
})

describe('filters', () => {
  it('parses status filters, falling back to all', () => {
    expect(parseStatusFilter('paused')).toBe('paused')
    expect(parseStatusFilter('nope')).toBe('all')
    expect(parseStatusFilter(null)).toBe('all')
  })

  it('matches effective statuses', () => {
    expect(matchesStatus('ACTIVE', 'active')).toBe(true)
    expect(matchesStatus('CAMPAIGN_PAUSED', 'paused')).toBe(true)
    expect(matchesStatus('ADSET_PAUSED', 'paused')).toBe(true)
    expect(matchesStatus('DISAPPROVED', 'disapproved')).toBe(true)
    expect(matchesStatus('WITH_ISSUES', 'disapproved')).toBe(false)
    expect(matchesStatus(null, 'all')).toBe(true)
  })

  it('keeps ancestors of a match and drops non-matching siblings', () => {
    const t = buildTree(input(), { ...ALL, status: 'disapproved' }, TODAY)
    expect(t.roots.map(r => r.key)).toEqual(['campaign:c1'])
    expect(t.roots[0]!.children.map(c => c.key)).toEqual(['adset:s1'])
    expect(t.roots[0]!.children[0]!.children.map(a => a.key)).toEqual(['ad:a2'])
    expect(t.shown).toBe(3)
    // figures are not re-summed after filtering
    expect(t.roots[0]!.d7.spendCents).toBe(1200)
  })

  it('paused keeps a paused campaign and paused rows under an active one', () => {
    const t = buildTree(input(), { ...ALL, status: 'paused' }, TODAY)
    expect(t.roots.map(r => r.key)).toEqual(['campaign:c1', 'campaign:c2'])
    expect(t.roots[0]!.children.map(c => c.key)).toEqual(['adset:s2'])
    expect(t.roots[1]!.children).toEqual([])
  })

  it('scopes to one campaign', () => {
    const t = buildTree(input(), { ...ALL, campaignId: 'c2' }, TODAY)
    expect(t.roots.map(r => r.key)).toEqual(['campaign:c2'])
    expect(t.campaigns).toHaveLength(2) // the picker still lists every campaign
  })

  it('filters by platform', () => {
    const base = input()
    const entities = [...base.entities, ent({ platform: 'microsoft', level: 'campaign', externalId: 'm1' })]
    expect(buildTree(input({ entities }), { ...ALL, platform: 'meta' }, TODAY).totals.campaigns).toBe(2)
    expect(buildTree(input({ entities }), ALL, TODAY).totals.campaigns).toBe(3)
  })

  it('filterNodes with all returns the same forest', () => {
    const t = buildTree(input(), ALL, TODAY)
    expect(filterNodes(t.roots, 'all')).toBe(t.roots)
  })
})

describe('expansion helpers', () => {
  it('lists every key that has children', () => {
    const t = buildTree(input(), ALL, TODAY)
    expect(allKeys(t.roots).sort()).toEqual(['adset:s1', 'adset:s2', 'adset:s3', 'campaign:c1', 'campaign:c2'])
  })

  it('round-trips the open param', () => {
    expect(parseOpen('all').all).toBe(true)
    expect([...parseOpen('campaign:c1, adset:s1,').keys]).toEqual(['campaign:c1', 'adset:s1'])
    expect(parseOpen(null).keys.size).toBe(0)
    expect(serializeOpen(['b', 'a', 'a'])).toBe('a,b')
  })

  it('studio link falls back without an idea', () => {
    expect(studioHrefFor(undefined)).toBeNull()
    expect(studioHrefFor({ id: 1, ideaId: 3 })).toContain('idea=3')
  })
})
