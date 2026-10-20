import { describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

const dbMock = vi.hoisted(() => ({ update: vi.fn(), insert: vi.fn() }))
vi.mock('~/lib/db.server', () => ({ db: dbMock }))

import { EXPORTER_BY_LANE, TEXT_EXPORT_LANES, exporterForLane } from './types'
import { EXPORTERS, getExporter } from './registry.server'
import { ExportRefusal, utmParamsFor, withUtms, type ExportCreative, type ExportIdea } from './common'
import { AD_GROUP_PLANS, ALL_NEGATIVES, COPY_THEMES } from './google-bank'
import { RSA_DESCRIPTION_MAX, RSA_HEADLINE_MAX, googleTextIssues } from './policy'
import { buildSearchExport, decodeExport, validate } from './google-editor-csv.server'
import { buildMetaDraft, metaDailyBudget } from './meta-paused-draft.server'
import { MetaPushError, type MetaDraftPayload } from './meta-payload'
import { pushMetaDraft, type MetaPushDeps } from './meta-push.server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApplyDeps, ApplyStore } from '~/lib/ads/channels/apply.server'
import type { AdActionRow, NewAdAction } from '~/lib/ads/ledger.server'
import { isLegalTransition, type AdActionStatus } from '~/lib/ads/ledger-core'
import { createMetaAdapter } from '~/lib/ads/channels/meta/adapter.server'
import { createMetaCreatePaused } from '~/lib/ads/channels/meta/mutate.server'
import { GraphError, type GraphClient } from '~/lib/ads/channels/meta/graph.server'
import { buildBannerZip, pngName, type BannerManifest } from './banner-zip.server'
import type { GatesJson } from '~/lib/ad-render-rules'

const PASS = { state: 'pass' as const, reason: 'ok' }
const GATES_OK: GatesJson = { vision: PASS, product: PASS, voice: PASS, policy: PASS, text: PASS }

function idea(over: Partial<ExportIdea> = {}): ExportIdea {
  return {
    id: 41, lane: 'google', registerTier: '3-4', conceptSlug: 'say-it-plain', title: 'Plain box, plain label', oneLiner: null,
    products: [{ handle: 'sliquid-h2o' }],
    headlines: ['Plain Box, Plain Label', 'Statement Reads XDIPX', 'Water-Based Lube, Explained'],
    body: ['Plain box, plain label. Not a secret, just nobody\'s business.'],
    audience: { ad_group: 'D' },
    destinationUrl: 'https://xdipx.com/collections/lubricants?utm_source=x&utm_content=old',
    breakEven: { cpa_cents: 1500, roas: 2.2 },
    policyCheck: 'pass: text only, register 3-4',
    status: 'hearted',
    ...over,
  }
}

function creative(over: Partial<ExportCreative> = {}): ExportCreative {
  return {
    id: 900, ideaId: 41, lane: 'meta', registerTier: '3-4', format: '4:5', width: 1080, height: 1350, slogan: 'Billing Reads XDIPX',
    status: 'draft', gates: GATES_OK, assetUrl: 'https://blob.example/ads/900.png', onSkin: false,
    ...over,
  }
}

function metaIdea(over: Partial<ExportIdea> = {}): ExportIdea {
  return idea({
    id: 77, lane: 'meta', title: 'Plain-box guarantee', headlines: ['Discreet Box, Honest Label', 'Billing Reads XDIPX'],
    body: ['A plain box, XDIPX on the statement, and a guarantee.', 'Ships plain.'],
    audience: null, destinationUrl: 'https://curious.xdipx.com/second-spring', breakEven: { cpa_cents: 1800 },
    ...over,
  })
}

describe('registry lane mapping', () => {
  it('maps lanes to exporters', () => {
    expect(EXPORTER_BY_LANE['google']).toBe('google-editor-csv')
    expect(EXPORTER_BY_LANE['microsoft']).toBe('google-editor-csv')
    expect(EXPORTER_BY_LANE['meta']).toBe('meta-paused-draft')
    for (const l of ['snap', 'adult', 'newsletter', 'owned']) expect(EXPORTER_BY_LANE[l]).toBe('banner-zip')
    expect(exporterForLane('tiktok')).toBeNull()
    expect(getExporter('adult')?.id).toBe('banner-zip')
    expect(TEXT_EXPORT_LANES).toEqual(['google', 'microsoft'])
  })

  it('no exporter can push: the Meta draft push lives on the adapter now', () => {
    for (const e of Object.values(EXPORTERS)) expect('push' in e).toBe(false)
  })
})

describe('UTM scheme', () => {
  it('replaces utm_* and sets the four, content = creative id', () => {
    const u = new URL(withUtms('https://xdipx.com/products/a?utm_source=old&x=1', { id: 5, conceptSlug: 'Say It Plain', lane: 'meta' }, 321))
    expect(u.searchParams.get('x')).toBe('1')
    expect(u.searchParams.get('utm_source')).toBe('facebook')
    expect(u.searchParams.get('utm_medium')).toBe('paid')
    expect(u.searchParams.get('utm_campaign')).toBe('ad5-say-it-plain')
    expect(u.searchParams.get('utm_content')).toBe('321')
  })
  it('falls back to idea-<id> when no creative row exists', () => {
    expect(utmParamsFor({ id: 9, conceptSlug: 'x', lane: 'google' }, null)['utm_content']).toBe('idea-9')
  })
})

describe('approved Search copy bank', () => {
  it('every banked line is inside the limits and plain ASCII', () => {
    for (const t of Object.values(COPY_THEMES)) {
      expect(t.headlines).toHaveLength(15)
      expect(t.descriptions).toHaveLength(4)
      const issues = googleTextIssues({ headlines: t.headlines, descriptions: t.descriptions, finalUrl: 'https://xdipx.com/?utm_content=1', paths: t.paths })
      expect(issues).toEqual([])
    }
  })
  it('keeps the launch plan negatives and never plans broad match', () => {
    expect(ALL_NEGATIVES).toContain('teen')
    expect(ALL_NEGATIVES).toContain('lovehoney')
    for (const g of Object.values(AD_GROUP_PLANS)) for (const k of g.keywords) expect(['Exact', 'Phrase']).toContain(k.match)
  })
})

describe('google-editor-csv', () => {
  const now = new Date('2026-10-03T12:00:00Z')

  it('builds a UTF-16LE file with a BOM that re-parses within every limit', () => {
    const b = buildSearchExport({ lane: 'google', ideas: [idea()], creativeIdByIdea: { 41: 900 }, dailyCapCents: 2000, now })
    const bytes = b.bytes!
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xfe)
    expect(decodeExport(bytes).encoding).toBe('utf-16le')
    const v = validate(bytes, 'google')
    expect(v.errors).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.stats.ads).toBe(1)
    expect(v.stats.headlines).toBe(15)
    expect(v.stats.descriptions).toBe(4)
    expect(v.stats.negatives).toBe(ALL_NEGATIVES.length)
    expect(v.stats.keywords).toBe(AD_GROUP_PLANS['D']!.keywords.length)
    const text = decodeExport(bytes).text
    expect(text.split('\r\n')[0]).toContain('Headline 15')
    expect(text).toContain('utm_content=900')
    expect(text).toContain('utm_source=google')
    expect(text).not.toContain('Active')
    expect(b.filename).toBe('google-search-idea-41-2026-10-03.csv')
    expect(b.destinations?.[900]).toContain('utm_content=900')
  })

  it('pads headlines from the bank, dedupes, and never exceeds 30 characters', () => {
    const b = buildSearchExport({ lane: 'google', ideas: [idea({ headlines: ['Plain Box, Plain Label', 'plain box, plain label'] })], creativeIdByIdea: {}, dailyCapCents: 2000, now })
    const rows = decodeExport(b.bytes!).text.split('\r\n').filter(Boolean).map(r => r.split('\t'))
    const header = rows[0]!
    const ad = rows.find(r => r[header.indexOf('Ad type')] === 'Responsive search ad')!
    const heads = header.map((h, i) => (h.startsWith('Headline ') ? ad[i]! : '')).filter(Boolean)
    expect(heads).toHaveLength(15)
    expect(new Set(heads.map(h => h.toLowerCase())).size).toBe(15)
    for (const h of heads) expect(h.length).toBeLessThanOrEqual(RSA_HEADLINE_MAX)
    expect(b.summary.warnings.some(w => w.includes('padded 14 headline'))).toBe(true)
    expect(decodeExport(b.bytes!).text).toContain('utm_content=idea-41')
  })

  it('rejects a headline over 30 characters', () => {
    const long = 'This headline is much too long for search'
    expect(long.length).toBeGreaterThan(RSA_HEADLINE_MAX)
    expect(() => buildSearchExport({ lane: 'google', ideas: [idea({ headlines: [long] })], creativeIdByIdea: {}, dailyCapCents: 2000, now })).toThrow(ExportRefusal)
    expect(googleTextIssues({ headlines: [long, 'a', 'b'], descriptions: ['x', 'y'], finalUrl: 'https://xdipx.com/?utm_content=1' }).join(' ')).toContain('over 30')
  })

  it('rejects a description over 90 characters', () => {
    const long = 'd'.repeat(RSA_DESCRIPTION_MAX + 1)
    expect(() => buildSearchExport({ lane: 'google', ideas: [idea({ body: [long] })], creativeIdByIdea: {}, dailyCapCents: 2000, now })).toThrow(/over 90/)
  })

  it('rejects glyphs, exclamation marks, prices and a final URL with no utm_content', () => {
    const base = { headlines: ['ok one', 'ok two', 'ok three'], descriptions: ['fine one', 'fine two'], finalUrl: 'https://xdipx.com/?utm_content=1' }
    expect(googleTextIssues({ ...base, headlines: ['Take a Peek →', 'b', 'c'] }).join(' ')).toContain('Glyph')
    expect(googleTextIssues({ ...base, headlines: ['Find your fit ♥', 'b', 'c'] }).join(' ')).toContain('Glyph')
    expect(googleTextIssues({ ...base, headlines: ['Plain ' + String.fromCharCode(0x2014) + ' simple', 'b', 'c'] }).join(' ')).toContain('Glyph')
    expect(googleTextIssues({ ...base, headlines: ['Great!', 'b', 'c'] }).join(' ')).toContain('Exclamation')
    expect(googleTextIssues({ ...base, descriptions: ['Only $29 today', 'b'] }).join(' ')).toContain('Price')
    expect(googleTextIssues({ ...base, finalUrl: 'https://xdipx.com/p' }).join(' ')).toContain('utm_content')
    expect(() => buildSearchExport({ lane: 'google', ideas: [idea({ headlines: ['Take a Peek →'] })], creativeIdByIdea: {}, dailyCapCents: 2000, now })).toThrow(ExportRefusal)
  })

  it('validate catches a tampered file (broad match, Active status)', () => {
    const b = buildSearchExport({ lane: 'google', ideas: [idea()], creativeIdByIdea: {}, dailyCapCents: 2000, now })
    const text = decodeExport(b.bytes!).text.replace('\tPhrase\t', '\tBroad\t').replace(/\tPaused\r\n/, '\tActive\r\n')
    const tampered = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    expect(validate(tampered, 'google').ok).toBe(false)
  })

  it('refuses an idea with no keywords and a mixed-lane call', () => {
    expect(() => buildSearchExport({ lane: 'google', ideas: [idea({ audience: null, products: [], headlines: ['Hello there', 'Second one', 'Third one'], title: 'Something', body: ['Plain text one', 'Plain text two'] })], creativeIdByIdea: {}, dailyCapCents: 2000, now })).toThrow(/no keywords/i)
    expect(() => buildSearchExport({ lane: 'google', ideas: [idea(), idea({ id: 42, lane: 'microsoft' })], creativeIdByIdea: {}, dailyCapCents: 2000, now })).toThrow(ExportRefusal)
  })

  it('caps the campaign budget at the daily valve', () => {
    const b = buildSearchExport({ lane: 'google', ideas: [idea({ audience: { ad_group: 'D', daily_budget_cents: 9000 } })], creativeIdByIdea: {}, dailyCapCents: 2000, now })
    expect(decodeExport(b.bytes!).text).toContain('\t20.00\t')
  })

  it('builds the Microsoft variant in the native bulk layout, UTF-8 with BOM', () => {
    const b = buildSearchExport({ lane: 'microsoft', ideas: [idea({ lane: 'microsoft' })], creativeIdByIdea: { 41: 901 }, dailyCapCents: 2000, now })
    expect(b.bytes![0]).toBe(0xef)
    const v = validate(b.bytes!, 'microsoft')
    expect(v.errors).toEqual([])
    expect(v.encoding).toBe('utf-8')
    const text = decodeExport(b.bytes!).text
    expect(text).toContain('Format Version')
    expect(text).toContain('Responsive Search Ad')
    expect(text).toContain('utm_source=bing')
    expect(b.filename.startsWith('microsoft-search-idea-41')).toBe(true)
  })
})

describe('meta-paused-draft', () => {
  const now = new Date('2026-10-03T12:00:00Z')

  it('every object is PAUSED, 25+, US, no special categories, no Advantage+ audience', () => {
    const b = buildMetaDraft({ idea: metaIdea(), creatives: [creative({ id: 900 }), creative({ id: 901, format: '1:1' })], dailyCapCents: 2000, now })
    const p = b.payloadJson as MetaDraftPayload
    expect(p.campaign.status).toBe('PAUSED')
    expect(p.adSet.status).toBe('PAUSED')
    for (const a of p.ads) expect(a.ad.status).toBe('PAUSED')
    expect(p.adSet.targeting.age_min).toBe(25)
    expect(p.adSet.targeting.geo_locations.countries).toEqual(['US'])
    expect(p.adSet.targeting.targeting_automation.advantage_audience).toBe(0)
    expect(p.campaign.special_ad_categories).toEqual([])
    expect(p.campaign.objective).toBe('OUTCOME_TRAFFIC')
    expect(p.adSet.optimization_goal).toBe('LINK_CLICKS')
    expect(JSON.stringify(p)).not.toMatch(/"status"\s*:\s*"ACTIVE"/)
    expect(p.status).toBe('ready')
    expect(p.preview.length).toBeGreaterThan(3)
    expect(p.mcpEquivalent).toContain('ads_create_ad')
    expect(p.ads).toHaveLength(2)
    const link = p.ads[0]!.adCreative.object_story_spec.link_data
    expect(link.call_to_action.type).toBe('SHOP_NOW')
    expect(new URL(link.link).searchParams.get('utm_content')).toBe('900')
    expect(link.image_hash).toBe('{{image_hash}}')
    expect(b.summary.warnings.join(' ')).toContain('subset')
  })

  it('daily budget follows break-even CPA and never exceeds the valve', () => {
    expect(metaDailyBudget({ breakEven: { cpa_cents: 1800 }, audience: null }, 2000).cents).toBe(1800)
    const capped = metaDailyBudget({ breakEven: { cpa_cents: 5000 }, audience: null }, 2000)
    expect(capped.cents).toBe(2000)
    expect(capped.source).toContain('capped')
    expect(metaDailyBudget({ breakEven: null, audience: null }, 2000).cents).toBe(1500)
    expect(metaDailyBudget({ breakEven: { cpa_cents: 10 }, audience: null }, 2000).cents).toBe(100)
  })

  it('refuses an on-skin creative', () => {
    expect(() => buildMetaDraft({ idea: metaIdea(), creatives: [creative({ onSkin: true })], dailyCapCents: 2000, now })).toThrow(/On-skin/)
  })

  it('refuses a category word in the headline or primary text', () => {
    expect(() => buildMetaDraft({ idea: metaIdea({ headlines: ['Clitoral vibrator, plain box'] }), creatives: [creative({ slogan: null })], dailyCapCents: 2000, now })).toThrow(ExportRefusal)
    expect(() => buildMetaDraft({ idea: metaIdea({ body: ['The best sex toy for you'] }), creatives: [creative()], dailyCapCents: 2000, now })).toThrow(/Pleasure or category/)
  })

  it('refuses a non-bridge, non-PDP destination and a register other than 3-4', () => {
    expect(() => buildMetaDraft({ idea: metaIdea({ destinationUrl: 'https://xdipx.com/collections/vibrators' }), creatives: [creative()], dailyCapCents: 2000, now })).toThrow(/bridge host/)
    expect(() => buildMetaDraft({ idea: metaIdea({ registerTier: '9' }), creatives: [creative()], dailyCapCents: 2000, now })).toThrow(/register 3-4/)
  })

  it('checks subset membership when the subset is supplied', () => {
    expect(() => buildMetaDraft({ idea: metaIdea({ products: [{ handle: 'raw-feed-item' }] }), creatives: [creative()], dailyCapCents: 2000, inSubset: h => h === 'wild-rose', now })).toThrow(/curated Meta subset/)
    const ok = buildMetaDraft({ idea: metaIdea({ products: [{ handle: 'wild-rose' }] }), creatives: [creative()], dailyCapCents: 2000, inSubset: h => h === 'wild-rose', now })
    expect(ok.summary.warnings.join(' ')).not.toContain('not checked')
  })

  it('assertSafe throws on an ACTIVE or under-25 payload', () => {
    const p = JSON.parse(JSON.stringify(buildMetaDraft({ idea: metaIdea(), creatives: [creative()], dailyCapCents: 2000, now }).payloadJson)) as MetaDraftPayload
    ;(p.ads[0]!.ad as { status: string }).status = 'ACTIVE'
    expect(() => MetaPushError.assertSafe(p)).toThrow(MetaPushError)
    const q = JSON.parse(JSON.stringify(buildMetaDraft({ idea: metaIdea(), creatives: [creative()], dailyCapCents: 2000, now }).payloadJson)) as MetaDraftPayload
    ;(q.adSet.targeting as { age_min: number }).age_min = 18
    expect(() => MetaPushError.assertSafe(q)).toThrow(/age_min/)
  })
})

describe('meta push', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const payload = buildMetaDraft({ idea: metaIdea(), creatives: [creative({ id: 900 })], dailyCapCents: 2000, now }).payloadJson
  const creds = () => ({ token: 'tok', accountId: 'act_1', pageId: 'page1' })

  /**
   * The whole push path with every edge mocked: a fake Graph client, an
   * in-memory ad_actions ledger, the real dispatcher, the real Meta adapter
   * and the real metaCreatePaused. No network, no database.
   */
  function harness(opts: { failOn?: number; spendEnabled?: boolean } = {}) {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = []
    const post = vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      posts.push({ path, body })
      if (opts.failOn === posts.length) throw new GraphError('api_error', `Graph POST ${path} refused: bad targeting`)
      const edge = path.split('/').pop()
      return edge === 'adimages' ? { images: { 'x.png': { hash: 'abc123' } } } : { id: `${edge}-id` }
    })
    const graph = { post, get: vi.fn(), getAll: vi.fn() } as unknown as GraphClient
    const recordPushed = vi.fn(async () => {})
    const recordPartial = vi.fn(async () => {})
    const sync = vi.fn(async () => ({}))
    const createPaused = createMetaCreatePaused({
      graph, credentials: creds, fetchBytes: async () => Buffer.from('png'),
      policyCheck: async () => ({ ok: true, refusals: [] }),
      store: { recordPushed, recordPartial }, syncAfterWrite: sync, now: () => now,
    })
    const adapter = createMetaAdapter({ graph, credentials: creds, createPaused })
    const rows: AdActionRow[] = []
    const store: ApplyStore = {
      mirrorRows: async () => [],
      countAutoActionsSince: async () => 0,
      countAutoPausesSince: async () => 0,
      findByKey: async key => rows.find(r => r.idempotencyKey === key) ?? null,
      insert: async (input: NewAdAction) => {
        if (rows.some(r => r.idempotencyKey === input.idempotencyKey)) return { inserted: false, row: null }
        const row = {
          id: rows.length + 1, ...input, params: input.params ?? null, before: input.before ?? null, after: input.after ?? null,
          status: input.status ?? 'proposed', approvedBy: null, approvedAt: null, appliedAt: null,
          platformResponse: null, error: null, expiresAt: null, reason: input.reason ?? null, ruleEventId: null, createdAt: now,
        } as AdActionRow
        rows.push(row)
        return { inserted: true, row }
      },
      transition: async (id, to: AdActionStatus, actor, extra = {}) => {
        const row = rows.find(r => r.id === id)!
        if (!isLegalTransition(row.status, to)) throw new Error(`illegal ${row.status} -> ${to}`)
        row.status = to
        if (to === 'approved') row.approvedBy = actor
        if (extra.after !== undefined) row.after = extra.after
        if (extra.error !== undefined) row.error = extra.error
        if (extra.platformResponse !== undefined) row.platformResponse = extra.platformResponse
        return row
      },
    }
    const apply: ApplyDeps = {
      store,
      settings: async () => ({ spendEnabled: opts.spendEnabled ?? true, autoApplyEnabled: false, autoActionsMaxPerDay: 10, budgetMaxStepPct: 20 }),
      adapterFor: () => adapter,
    }
    const deps = (over: Partial<MetaPushDeps> = {}): MetaPushDeps => ({
      spendEnabled: async () => opts.spendEnabled ?? true, credentials: creds, actor: 'mike@xdipx.com', apply, ...over,
    })
    return { posts, post, rows, deps, recordPushed, recordPartial, sync }
  }

  it('refuses with spend_disabled when the valve is off and never reads credentials or calls Graph', async () => {
    const h = harness()
    const credentials = vi.fn()
    await expect(pushMetaDraft(payload, 900, {}, h.deps({ spendEnabled: async () => false, credentials })))
      .rejects.toMatchObject({ code: 'spend_disabled' })
    expect(credentials).not.toHaveBeenCalled()
    expect(h.post).not.toHaveBeenCalled()
    expect(h.rows).toHaveLength(0)
  })

  it('refuses with not_configured when the valve is on but no token exists', async () => {
    const h = harness()
    await expect(pushMetaDraft(payload, 900, {}, h.deps({ credentials: () => ({ token: null, accountId: null, pageId: null }) })))
      .rejects.toMatchObject({ code: 'not_configured' })
    expect(h.post).not.toHaveBeenCalled()
    expect(h.rows).toHaveLength(0)
  })

  it('the dispatcher holds the spend valve too: no row and no Graph call', async () => {
    const h = harness({ spendEnabled: false })
    await expect(pushMetaDraft(payload, 900, {}, h.deps({ spendEnabled: async () => true })))
      .rejects.toMatchObject({ code: 'spend_disabled' })
    expect(h.post).not.toHaveBeenCalled()
    expect(h.rows).toHaveLength(0)
  })

  it('writes one ad_actions row and five Graph POSTs in order, every status PAUSED', async () => {
    const h = harness()
    const res = await pushMetaDraft(payload, 900, {}, h.deps())
    expect(h.posts.map(c => c.path)).toEqual(['act_1/adimages', 'act_1/campaigns', 'act_1/adsets', 'act_1/adcreatives', 'act_1/ads'])
    expect(h.posts[1]!.body['status']).toBe('PAUSED')
    expect(h.posts[2]!.body['status']).toBe('PAUSED')
    expect((h.posts[2]!.body['targeting'] as { age_min: number }).age_min).toBe(25)
    expect(h.posts[2]!.body['campaign_id']).toBe('campaigns-id')
    const spec = h.posts[3]!.body['object_story_spec'] as { page_id: string; link_data: { image_hash: string } }
    expect(spec.page_id).toBe('page1')
    expect(spec.link_data.image_hash).toBe('abc123')
    expect(h.posts[4]!.body['status']).toBe('PAUSED')
    expect(JSON.stringify(h.posts)).not.toContain('ACTIVE')
    expect(res.externalAdId).toBe('ads-id')

    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({
      verb: 'create_paused', tier: 'owner', status: 'applied', before: null, platform: 'meta',
      targetLevel: 'creative', targetExternalId: 'ad_creatives:900',
      proposedBy: 'mike@xdipx.com', approvedBy: 'mike@xdipx.com',
      after: { campaignId: 'campaigns-id', adSetId: 'adsets-id', creativeId: 'adcreatives-id', adId: 'ads-id' },
    })
    expect(h.recordPushed).toHaveBeenCalledWith(900, expect.objectContaining({ externalAdId: 'ads-id' }), 'mike@xdipx.com')
    expect(h.sync).toHaveBeenCalledWith('meta', ['campaigns-id', 'adsets-id', 'ads-id'])
  })

  it('reuses the campaign and ad set a sibling size already made', async () => {
    const h = harness()
    const again = await pushMetaDraft(payload, 900, { campaignId: 'C1', adSetId: 'S1' }, h.deps())
    expect(h.posts.map(c => c.path.split('/').pop())).toEqual(['adimages', 'adcreatives', 'ads'])
    expect(h.posts[2]!.body['adset_id']).toBe('S1')
    expect(again.reused).toEqual({ campaign: true, adSet: true })
  })

  it('refuses a replay of the same creative as already pushed, with no second Graph call', async () => {
    const h = harness()
    await pushMetaDraft(payload, 900, {}, h.deps())
    h.posts.length = 0
    await expect(pushMetaDraft(payload, 900, {}, h.deps())).rejects.toMatchObject({ code: 'already_pushed' })
    expect(h.posts).toHaveLength(0)
    expect(h.rows).toHaveLength(1)
  })

  it('returns the ids created so far when a later step fails, marks the row failed, and lets a retry run', async () => {
    const h = harness({ failOn: 3 })
    const err = await pushMetaDraft(payload, 900, {}, h.deps()).catch(e => e as MetaPushError)
    expect(err).toBeInstanceOf(MetaPushError)
    expect((err as MetaPushError).code).toBe('api_error')
    expect((err as MetaPushError).partial.campaignId).toBe('campaigns-id')
    expect((err as MetaPushError).message).toContain('bad targeting')
    expect(h.recordPartial).toHaveBeenCalledTimes(1)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ status: 'failed', platformResponse: { partial: { campaignId: 'campaigns-id' } } })
    expect(h.rows[0]!.error).toContain('bad targeting')

    // A retry is a second attempt row, reusing what exists.
    const ok = await pushMetaDraft(payload, 900, { campaignId: 'campaigns-id' }, h.deps())
    expect(ok.reused.campaign).toBe(true)
    expect(h.rows.map(r => r.status)).toEqual(['failed', 'applied'])
  })

  it('refuses before any Graph call when the mirror shows a disapproval (M7)', async () => {
    const post = vi.fn()
    const cp = createMetaCreatePaused({
      graph: { post, get: vi.fn(), getAll: vi.fn() } as unknown as GraphClient, credentials: creds, fetchBytes: async () => Buffer.from('png'),
      policyCheck: async () => ({ ok: false, refusals: [{ code: 'meta_disapproved', message: 'Meta ad 9 is DISAPPROVED.' }] }),
      store: { recordPushed: vi.fn(), recordPartial: vi.fn() }, syncAfterWrite: vi.fn(),
    })
    await expect(cp({ payload, adCreativeId: 900 })).rejects.toThrow(/DISAPPROVED/)
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses a destination off the bridge host before any Graph call (M1)', async () => {
    const post = vi.fn()
    const bad = JSON.parse(JSON.stringify(payload)) as MetaDraftPayload
    bad.ads[0]!.adCreative.object_story_spec.link_data.link = 'https://xdipx.com/collections/vibrators'
    const cp = createMetaCreatePaused({
      graph: { post, get: vi.fn(), getAll: vi.fn() } as unknown as GraphClient, credentials: creds, fetchBytes: async () => Buffer.from('png'),
      policyCheck: async () => ({ ok: true, refusals: [] }), store: { recordPushed: vi.fn(), recordPartial: vi.fn() }, syncAfterWrite: vi.fn(),
    })
    await expect(cp({ payload: bad, adCreativeId: 900 })).rejects.toThrow(/bridge host/)
    expect(post).not.toHaveBeenCalled()
  })

  it('nothing on the push path touches the database, so nothing writes ad_campaigns', async () => {
    const h = harness()
    await pushMetaDraft(payload, 900, {}, h.deps())
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it('the export service no longer writes the legacy ad_campaigns table', () => {
    const src = readFileSync(join(__dirname, 'service.server.ts'), 'utf8')
    expect(src).not.toMatch(/adCampaigns/)
  })
})

describe('banner-zip', () => {
  const now = new Date('2026-10-03T12:00:00Z')
  const adultIdea = idea({ id: 52, lane: 'adult', registerTier: '9', title: 'Banner idea', headlines: ['Take a peek'], body: ['Body line'], destinationUrl: 'https://xdipx.com/products/x?utm_content=zz', audience: null })
  const crs = [
    creative({ id: 11, ideaId: 52, lane: 'adult', registerTier: '9', format: '300x250', width: 300, height: 250, slogan: 'Slogan A', assetUrl: 'https://blob.example/a.png' }),
    creative({ id: 12, ideaId: 52, lane: 'adult', registerTier: '9', format: '728x90', width: 728, height: 90, slogan: 'Slogan A', assetUrl: 'https://blob.example/b.png' }),
  ]
  const fetchBytes = async (url: string) => Buffer.from(`png:${url}`)

  it('zips PNGs named <lane>-<idea>-<format>.png with copy, README and a manifest', async () => {
    const b = await buildBannerZip({ ideas: { 52: adultIdea }, creatives: crs, fetchBytes, now })
    expect(b.contentType).toBe('application/zip')
    const files = unzipSync(new Uint8Array(b.bytes!))
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'adult-52-300x250.png', 'adult-52-728x90.png', 'copy.txt', 'manifest.json'])
    expect(pngName(crs[0]!)).toBe('adult-52-300x250.png')
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as BannerManifest
    expect(manifest.count).toBe(2)
    expect(manifest.lane).toBe('adult')
    expect(manifest.entries[0]!.file).toBe('adult-52-300x250.png')
    expect(new URL(manifest.entries[0]!.destination).searchParams.get('utm_content')).toBe('11')
    const copy = strFromU8(files['copy.txt']!)
    expect(copy).toContain('Slogan A')
    expect(copy).toContain('utm_content=12')
    const readme = strFromU8(files['README.txt']!)
    expect(readme).toContain('Register tier: 9')
    expect(readme).toContain('nudity definition')
    expect(strFromU8(files['adult-52-300x250.png']!)).toBe('png:https://blob.example/a.png')
    expect(b.filename).toBe('adult-banners-idea-52-2026-10-03.zip')
  })

  it('refuses a blocked creative and a creative with no rendered image', async () => {
    const blocked = { ...crs[0]!, gates: { ...GATES_OK, vision: { state: 'block' as const, reason: 'nipple visible' } } }
    await expect(buildBannerZip({ ideas: { 52: adultIdea }, creatives: [blocked], fetchBytes, now })).rejects.toThrow(/vision gate: nipple visible/)
    await expect(buildBannerZip({ ideas: { 52: adultIdea }, creatives: [{ ...crs[0]!, status: 'blocked' }], fetchBytes, now })).rejects.toBeInstanceOf(ExportRefusal)
    await expect(buildBannerZip({ ideas: { 52: adultIdea }, creatives: [{ ...crs[0]!, assetUrl: null }], fetchBytes, now })).rejects.toThrow(/no rendered image/)
  })

  it('refuses mixed lanes', async () => {
    await expect(buildBannerZip({ ideas: { 52: adultIdea }, creatives: [crs[0]!, { ...crs[1]!, lane: 'snap' }], fetchBytes, now })).rejects.toThrow(/one lane at a time/)
  })
})
