/**
 * Ticket #16685: register-10 ExoClick banners end to end. An adult idea at
 * register 10 renders all six ExoClick sizes under the byte cap, and its zip
 * says register 10, stamps utm_source=exoclick&utm_medium=display and lands on
 * the canonical /products/{slug}.
 */
import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { randomBytes } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'

vi.mock('~/lib/db.server', () => ({ db: {} }))

import { composeAd } from '~/lib/ad-compose.server'
import { AD_FORMATS, EXOCLICK_MAX_IMAGE_BYTES, LANE_FORMATS, formatsForLane, maxBytesForSize } from '~/lib/ad-formats'
import { chooseLayout, getConcept } from '~/lib/ad-render-rules'
import { classifyChannelGroup } from '../../../server/webhooks'
import { exoclickPolicyCheck } from '~/lib/ads/channels/exoclick/adapter.server'
import { buildBannerZip, type BannerManifest } from './banner-zip.server'
import {
  LEGACY_ADULT_UTM_SOURCE, adultLandingFor, adultNetworkFor, isAdultLanding, utmParamsFor, withUtms,
  type ExportCreative, type ExportIdea,
} from './common'
import { fitImageUnderBytes, fitPngUnderBytes } from './fit-bytes.server'
import type { GatesJson } from '~/lib/ad-render-rules'

const PASS = { state: 'pass' as const, reason: 'ok' }
const GATES_OK: GatesJson = { vision: PASS, product: PASS, voice: PASS, policy: PASS, text: PASS }
const EXO_SIZES = ['160x600', '300x250', '728x90', '900x250', '300x100', '300x50']

/** A noisy photographic stand-in plate: worst case for PNG size. */
async function noisyPlate(w: number, h: number): Promise<Buffer> {
  const px = randomBytes(w * h * 3)
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

function adultIdea(over: Partial<ExportIdea> = {}): ExportIdea {
  return {
    id: 300, lane: 'adult', registerTier: '10', conceptSlug: 'body-map', title: 'Body map', oneLiner: null,
    products: [{ handle: 'we-vibe-sync-2' }],
    headlines: ['Two motors, one of you', 'Wear it in, take it slow'], body: ['Body line'],
    audience: null,
    destinationUrl: 'https://curious.xdipx.com/second-spring?utm_content=old',
    breakEven: null, policyCheck: 'Pass at 10.', status: 'hearted',
    ...over,
  }
}

function adultCreative(id: number, format: string, over: Partial<ExportCreative> = {}): ExportCreative {
  const [w, h] = format.split('x').map(Number)
  return {
    id, ideaId: 300, lane: 'adult', registerTier: '10', format, width: w!, height: h!, slogan: 'Two motors, one of you',
    status: 'draft', gates: GATES_OK, assetUrl: `https://blob.example/${id}.png`, onSkin: true,
    ...over,
  }
}

describe('ExoClick format catalog', () => {
  it('gives the adult lane exactly the six static ExoClick sizes, each capped at 150 KB', () => {
    expect([...LANE_FORMATS['adult']!].sort()).toEqual([...EXO_SIZES].sort())
    for (const f of formatsForLane('adult')) {
      expect(f.maxBytes).toBe(EXOCLICK_MAX_IMAGE_BYTES)
      expect(f.id.length).toBeLessThanOrEqual(8)
    }
    expect(EXOCLICK_MAX_IMAGE_BYTES).toBe(150 * 1024)
    expect(maxBytesForSize(300, 50)).toBe(EXOCLICK_MAX_IMAGE_BYTES)
    expect(maxBytesForSize(1080, 1080)).toBeNull()
  })
})

describe('byte fitting', () => {
  it('keeps a file already under the cap untouched', async () => {
    const small = await sharp({ create: { width: 300, height: 50, channels: 3, background: '#FFE6DD' } }).png().toBuffer()
    const r = await fitPngUnderBytes(small, EXOCLICK_MAX_IMAGE_BYTES)
    expect(r.encoding).toBe('original')
    expect(r.bytes).toBe(small)
  })

  it('falls back to JPEG for the export when no palette PNG fits, keeping the pixel size', async () => {
    const big = await noisyPlate(900, 250)
    expect(big.length).toBeGreaterThan(EXOCLICK_MAX_IMAGE_BYTES)
    const r = await fitImageUnderBytes(big, EXOCLICK_MAX_IMAGE_BYTES)
    expect(r.withinLimit).toBe(true)
    expect(r.bytes.length).toBeLessThanOrEqual(EXOCLICK_MAX_IMAGE_BYTES)
    const meta = await sharp(r.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([900, 250])
  }, 30_000)
})

describe('register-10 adult idea renders every ExoClick size under the cap', () => {
  it('composes all six sizes at their exact pixels, legible and under 150 KB', async () => {
    const concept = getConcept('sculpture-hall')
    for (const id of EXO_SIZES) {
      const f = AD_FORMATS.find(x => x.id === id)!
      const plate = await noisyPlate(f.plateBucket === 'story' ? 540 : 800, f.plateBucket === 'story' ? 960 : 450)
      const slogan = ['Two motors, one of you, all night', 'Two motors, one of you', 'Two motors, one you'].find(t => t.length <= f.maxSloganChars)!
      expect(slogan.length).toBeLessThanOrEqual(f.maxSloganChars)
      const res = await composeAd({ template: chooseLayout(concept, f, true), width: f.width, height: f.height, slogan, kicker: concept.kicker, ground: 'coral-soft', plate })
      const meta = await sharp(res.png).metadata()
      expect([meta.width, meta.height, meta.format]).toEqual([f.width, f.height, 'png'])
      expect(res.metrics.truncated).toBe(false)
      expect(res.metrics.maxBytes).toBe(EXOCLICK_MAX_IMAGE_BYTES)
      expect(res.png.length).toBeLessThanOrEqual(EXOCLICK_MAX_IMAGE_BYTES)
      expect(res.metrics.overBudget).toBe(false)
    }
  }, 60_000)
})

describe('adult attribution and landing', () => {
  it('stamps the network as source and display as medium; ExoClick is the default', () => {
    const p = utmParamsFor(adultIdea(), 77, { format: '300x250' })
    expect(p).toEqual({ utm_source: 'exoclick', utm_medium: 'display', utm_campaign: 'ad300-body-map', utm_content: '77' })
    expect(utmParamsFor(adultIdea({ audience: { network: 'juicyads' } }), 77)['utm_source']).toBe('juicyads')
    expect(adultNetworkFor({ audience: { network: 'adult:exoclick' } })).toBe('exoclick')
    expect(adultNetworkFor({ audience: { network: 'trafficjunky' } })).toBe('exoclick')
    expect(utmParamsFor(adultIdea(), 1, { format: 'native-1' })['utm_medium']).toBe('native')
    expect(utmParamsFor(adultIdea(), 1)['utm_source']).not.toBe(LEGACY_ADULT_UTM_SOURCE)
  })

  it('lands on the canonical PDP: bridge and query strings never survive', () => {
    expect(adultLandingFor(adultIdea())).toBe('https://xdipx.com/products/we-vibe-sync-2')
    expect(adultLandingFor(adultIdea({ destinationUrl: 'https://www.xdipx.com/products/Lelo-Sona-2/?ref=x&utm_content=1' }))).toBe('https://xdipx.com/products/lelo-sona-2')
    expect(adultLandingFor(adultIdea({ destinationUrl: null, products: [] }))).toBeNull()
    expect(isAdultLanding('https://xdipx.com/products/a-b')).toBe(true)
    expect(isAdultLanding('https://curious.xdipx.com/products/a-b')).toBe(false)
    expect(isAdultLanding('https://curious.xdipx.com/gawk-gawk-3000')).toBe(true)
    expect(isAdultLanding('http://curious.xdipx.com/gawk-gawk-3000')).toBe(false)
    expect(adultLandingFor(adultIdea({ audience: { salesPage: 'Gawk-Gawk-3000' } }))).toBe('https://curious.xdipx.com/gawk-gawk-3000')
    expect(adultLandingFor(adultIdea({ audience: { salesPage: '../evil' } }))).toBe('https://xdipx.com/products/we-vibe-sync-2')
    expect(isAdultLanding('https://xdipx.com/collections/vibrators')).toBe(false)
  })

  it('counts an ExoClick click as paid and passes the adapter UTM policy', () => {
    const url = withUtms('https://xdipx.com/products/we-vibe-sync-2', adultIdea(), 77, { format: '300x250' })
    expect(classifyChannelGroup({ utmSource: 'exoclick', utmMedium: 'display' })).toBe('paid')
    expect(classifyChannelGroup({ utmSource: LEGACY_ADULT_UTM_SOURCE, utmMedium: 'paid' })).toBe('paid')
    const verdict = exoclickPolicyCheck({ mirror: [], bannerUrls: [url] } as never)
    expect(verdict.ok).toBe(true)
  })
})

describe('ExoClick banner zip', () => {
  const now = new Date('2026-10-20T12:00:00Z')

  it('says register 10, stamps exoclick/display and lands every URL on /products/{slug}', async () => {
    const crs = EXO_SIZES.map((f, i) => adultCreative(500 + i, f))
    const b = await buildBannerZip({ ideas: { 300: adultIdea() }, creatives: crs, fetchBytes: async () => Buffer.from('png'), now })
    const files = unzipSync(new Uint8Array(b.bytes!))
    const readme = strFromU8(files['README.txt']!)
    expect(readme).toContain('Register tier: 10')
    expect(readme).toContain('Copy runs at register 10')
    expect(readme).toContain('Network: exoclick')
    expect(readme).toContain('product page')
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as BannerManifest
    expect(manifest.count).toBe(6)
    for (const e of manifest.entries) {
      const u = new URL(e.destination)
      expect(`${u.origin}${u.pathname}`).toBe('https://xdipx.com/products/we-vibe-sync-2')
      expect(u.searchParams.get('utm_source')).toBe('exoclick')
      expect(u.searchParams.get('utm_medium')).toBe('display')
      expect(u.searchParams.get('utm_campaign')).toBe('ad300-body-map')
      expect(u.searchParams.get('utm_content')).toBe(String(e.creativeId))
      expect(e.network).toBe('exoclick')
    }
    expect(Object.values(b.destinations!).every(d => d.includes('utm_source=exoclick&utm_medium=display'))).toBe(true)
  })

  it('re-encodes an over-cap PNG and names it by what it holds', async () => {
    const big = await noisyPlate(900, 250)
    const b = await buildBannerZip({ ideas: { 300: adultIdea() }, creatives: [adultCreative(601, '900x250')], fetchBytes: async () => big, now })
    const files = unzipSync(new Uint8Array(b.bytes!))
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as BannerManifest
    const e = manifest.entries[0]!
    expect(e.bytes).toBeLessThanOrEqual(EXOCLICK_MAX_IMAGE_BYTES)
    expect(e.encoding).not.toBe('original')
    expect(files[e.file]!.length).toBe(e.bytes)
  }, 30_000)

  it('refuses an idea with no product to land on, and two networks in one pack', async () => {
    const noProduct = adultIdea({ products: [], destinationUrl: 'https://curious.xdipx.com/x' })
    await expect(buildBannerZip({ ideas: { 300: noProduct }, creatives: [adultCreative(1, '300x250')], fetchBytes: async () => Buffer.from('p'), now })).rejects.toThrow(/no product to land on/)
    const juicy = adultIdea({ id: 301, audience: { network: 'juicyads' } })
    await expect(buildBannerZip({
      ideas: { 300: adultIdea(), 301: juicy },
      creatives: [adultCreative(1, '300x250'), adultCreative(2, '300x250', { ideaId: 301 })],
      fetchBytes: async () => Buffer.from('p'), now,
    })).rejects.toThrow(/one adult network at a time/)
  })
})

describe('ExoClick click macro on adult links', () => {
  it('appends the macro unencoded on ExoClick links', () => {
    const url = withUtms('https://curious.xdipx.com/gawk-gawk-3000', adultIdea(), 503, { format: 'banner_300x250' })
    expect(url.endsWith('&exoclid={conversions_tracking}')).toBe(true)
    expect(new URL(url).searchParams.get('utm_source')).toBe('exoclick')
  })

  it('leaves JuicyAds and every other lane alone', () => {
    const juicy = adultIdea({ audience: { network: 'juicyads' } })
    expect(withUtms('https://xdipx.com/products/a', juicy, 1, {})).not.toContain('exoclid')
    expect(withUtms('https://xdipx.com/products/a', { ...adultIdea(), lane: 'google' }, 1, {})).not.toContain('exoclid')
  })
})
