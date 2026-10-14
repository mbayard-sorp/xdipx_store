// Unit tests for the Atlas Cloud size mapper. Seedream rejects any request
// under 3,686,400 pixels (verified live 2026-08-15: "image size must be at
// least 3686400 pixels"), so every mapping and every scaled explicit size must
// clear that floor while preserving the caller's aspect.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { atlasGenerate, atlasSize } from './atlas.server'

const MIN_AREA = 3_686_400

function area(size: string): number {
  const [w, h] = size.split('*').map(Number)
  return w! * h!
}

describe('atlasSize', () => {
  it('maps every fal image_size enum at or above the provider pixel floor', () => {
    for (const key of ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9']) {
      expect(area(atlasSize(key)), key).toBeGreaterThanOrEqual(MIN_AREA)
    }
  })

  it('passes an already-large explicit size through unscaled', () => {
    expect(atlasSize({ width: 1728, height: 2160 })).toBe('1728*2160')
  })

  it('scales a small explicit size up to the pixel floor, preserving aspect', () => {
    const out = atlasSize({ width: 1080, height: 1350 })
    const [w, h] = out.split('*').map(Number)
    expect(w! * h!).toBeGreaterThanOrEqual(MIN_AREA)
    expect(w! / h!).toBeCloseTo(1080 / 1350, 2)
    expect(w! % 2).toBe(0)
    expect(h! % 2).toBe(0)
  })

  it('throws on an unmapped enum rather than silently changing aspect', () => {
    expect(() => atlasSize('portrait_21_9')).toThrow(/unmapped/)
  })

  it('throws on invalid explicit dimensions', () => {
    expect(() => atlasSize({ width: 0, height: 1080 })).toThrow(/invalid/)
  })
})

// A blocked or failed sibling used to reject the whole batch through
// Promise.all, discarding the images that completed: billed, visible in the
// Atlas dashboard, and never ingested into the social library.
describe('atlasGenerate partial results', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  function stubAtlas(outcomes: Array<'completed' | 'failed'>) {
    let submitted = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/model/generateImage') && init?.method === 'POST') {
        const id = `pred-${submitted++}`
        return Response.json({ data: { id } })
      }
      const m = url.match(/prediction\/pred-(\d+)$/)
      if (m) {
        const i = Number(m[1])
        return outcomes[i] === 'completed'
          ? Response.json({ data: { status: 'completed', outputs: [`https://atlas/out-${i}.jpg`] } })
          : Response.json({ data: { status: 'failed', error: 'content policy' } })
      }
      if (url.startsWith('https://atlas/out-')) return new Response(new Uint8Array([1, 2, 3]))
      throw new Error(`unexpected fetch ${url}`)
    }))
  }

  async function run(count: number) {
    vi.stubEnv('ATLAS_CLOUD_API_KEY', 'test-key')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    const p = atlasGenerate({ prompt: 'p', count, refImageUrl: 'https://x/ref.jpg' })
    const settled = p.then(v => ({ ok: true as const, v }), e => ({ ok: false as const, e }))
    await vi.runAllTimersAsync()
    return settled
  }

  it('returns the completed images when one sibling fails', async () => {
    stubAtlas(['completed', 'failed'])
    const out = await run(2)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.v.urls).toEqual(['https://atlas/out-0.jpg'])
    expect(out.v.requestIds).toEqual(['pred-0'])
    expect(out.v.buffers).toHaveLength(1)
  })

  it('still throws when every request fails, so callers can fall back', async () => {
    stubAtlas(['failed', 'failed'])
    const out = await run(2)
    expect(out.ok).toBe(false)
  })
})
