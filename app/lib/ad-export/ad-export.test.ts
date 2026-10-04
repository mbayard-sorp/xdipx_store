import { describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import { EXPORTER_BY_LANE, TEXT_EXPORT_LANES, exporterForLane } from './types'
import { EXPORTERS, getExporter } from './registry.server'
import { ExportRefusal, utmParamsFor, withUtms, type ExportCreative, type ExportIdea } from './common'
import { AD_GROUP_PLANS, ALL_NEGATIVES, COPY_THEMES } from './google-bank'
import { RSA_DESCRIPTION_MAX, RSA_HEADLINE_MAX, googleTextIssues } from './policy'
import { buildSearchExport, decodeExport, validate } from './google-editor-csv.server'
import { buildMetaDraft, metaDailyBudget } from './meta-paused-draft.server'
import { MetaPushError, type MetaDraftPayload } from './meta-payload'
import { pushMetaDraft, type MetaPushDeps } from './meta-push.server'
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

  it('only the Meta exporter can push', () => {
    expect(EXPORTERS['meta-paused-draft'].push).toBeTypeOf('function')
    expect(EXPORTERS['google-editor-csv'].push).toBeUndefined()
    expect(EXPORTERS['banner-zip'].push).toBeUndefined()
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

  function deps(over: Partial<MetaPushDeps> & { fetchImpl?: typeof fetch } = {}): MetaPushDeps {
    return {
      spendEnabled: async () => true,
      credentials: () => ({ token: 'tok', accountId: 'act_1', pageId: 'page1' }),
      fetchBytes: async () => Buffer.from('png'),
      ...over,
    }
  }

  it('refuses with spend_disabled when the valve is off and never reads credentials or calls the network', async () => {
    const f = vi.fn()
    const creds = vi.fn()
    await expect(pushMetaDraft(payload, 900, {}, deps({ spendEnabled: async () => false, credentials: creds, fetchImpl: f as unknown as typeof fetch })))
      .rejects.toMatchObject({ code: 'spend_disabled' })
    expect(f).not.toHaveBeenCalled()
    expect(creds).not.toHaveBeenCalled()
  })

  it('refuses with not_configured when the valve is on but no token exists', async () => {
    const f = vi.fn()
    await expect(pushMetaDraft(payload, 900, {}, deps({ credentials: () => ({ token: null, accountId: null, pageId: null }), fetchImpl: f as unknown as typeof fetch })))
      .rejects.toMatchObject({ code: 'not_configured' })
    expect(f).not.toHaveBeenCalled()
  })

  it('creates image, campaign, ad set, creative and ad in order, ad PAUSED, and reuses existing ids', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push({ url: String(url), body })
      expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer tok')
      expect(String(url)).not.toContain('tok')
      const path = String(url).split('/').pop()
      const json = path === 'adimages' ? { images: { 'x.png': { hash: 'abc123' } } } : { id: `${path}-id` }
      return new Response(JSON.stringify(json), { status: 200 })
    })
    const res = await pushMetaDraft(payload, 900, {}, deps({ fetchImpl: f as unknown as typeof fetch }))
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['adimages', 'campaigns', 'adsets', 'adcreatives', 'ads'])
    expect(calls[1]!.body['status']).toBe('PAUSED')
    expect(calls[2]!.body['status']).toBe('PAUSED')
    expect((calls[2]!.body['targeting'] as { age_min: number }).age_min).toBe(25)
    expect(calls[2]!.body['campaign_id']).toBe('campaigns-id')
    const spec = calls[3]!.body['object_story_spec'] as { page_id: string; link_data: { image_hash: string } }
    expect(spec.page_id).toBe('page1')
    expect(spec.link_data.image_hash).toBe('abc123')
    expect(calls[4]!.body['status']).toBe('PAUSED')
    expect(JSON.stringify(calls)).not.toContain('ACTIVE')
    expect(res.externalAdId).toBe('ads-id')

    calls.length = 0
    const again = await pushMetaDraft(payload, 900, { campaignId: 'C1', adSetId: 'S1' }, deps({ fetchImpl: f as unknown as typeof fetch }))
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['adimages', 'adcreatives', 'ads'])
    expect(again.reused).toEqual({ campaign: true, adSet: true })
  })

  it('returns the ids created so far when a later step fails', async () => {
    let n = 0
    const f = vi.fn(async (url: string) => {
      n += 1
      if (n === 3) return new Response(JSON.stringify({ error: { message: 'bad targeting' } }), { status: 400 })
      return new Response(JSON.stringify(String(url).endsWith('adimages') ? { images: { a: { hash: 'h' } } } : { id: `id${n}` }), { status: 200 })
    })
    const err = await pushMetaDraft(payload, 900, {}, deps({ fetchImpl: f as unknown as typeof fetch })).catch(e => e as MetaPushError)
    expect(err).toBeInstanceOf(MetaPushError)
    expect((err as MetaPushError).code).toBe('api_error')
    expect((err as MetaPushError).partial.campaignId).toBe('id2')
    expect((err as MetaPushError).message).toContain('bad targeting')
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
