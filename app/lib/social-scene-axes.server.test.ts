/**
 * Draft-time supply of the scene axes (ticket #10479).
 *
 * THE ACCEPTANCE TEST is the first case below: a draft created from a
 * generated asset carries all four axes with the drafting agent sending none
 * of them. That is the thing two prior fixes (migrations 093 and 099, both
 * documentation-only) failed to produce, 281 rows out of 281.
 */
import { describe, expect, it, vi } from 'vitest'
import { backfillPostSceneAxes, resolveDraftSceneAxes } from './social-scene-axes.server'
import { sceneAxisTags } from './social-scene-vocab'

const ASSET_URL = 'https://cdn.shopify.com/files/social-cast-wand-hip-20260920.jpg'
const GENERATED = {
  bodyZone: 'hip-hollow',
  contactMode: 'resting',
  cropScale: 'medium',
  sceneLocation: 'bedroom-loft',
}

describe('resolveDraftSceneAxes', () => {
  it('carries all four axes when the drafting agent sends none of them', async () => {
    const loadAssetTags = vi.fn().mockResolvedValue([sceneAxisTags(GENERATED)])
    const axes = await resolveDraftSceneAxes({}, [ASSET_URL], { loadAssetTags })
    expect(axes).toEqual(GENERATED)
    expect(loadAssetTags).toHaveBeenCalledWith([ASSET_URL])
  })

  it('lets a supplied axis override the asset, so the draft field is a confirmation', async () => {
    const loadAssetTags = vi.fn().mockResolvedValue([sceneAxisTags(GENERATED)])
    const axes = await resolveDraftSceneAxes({ cropScale: 'macro' }, [ASSET_URL], { loadAssetTags })
    expect(axes.cropScale).toBe('macro')
    expect(axes.bodyZone).toBe('hip-hollow')
  })

  it('fills only the gaps when the asset knows part of the answer', async () => {
    const loadAssetTags = vi.fn().mockResolvedValue([sceneAxisTags({ cropScale: 'close' })])
    const axes = await resolveDraftSceneAxes({ bodyZone: 'sternum' }, [ASSET_URL], { loadAssetTags })
    expect(axes).toEqual({ bodyZone: 'sternum', cropScale: 'close' })
  })

  it('takes the first slide that names an axis when a carousel disagrees', async () => {
    const loadAssetTags = vi.fn().mockResolvedValue([
      sceneAxisTags({ bodyZone: 'hip-hollow' }),
      sceneAxisTags({ bodyZone: 'sternum', cropScale: 'wide' }),
    ])
    const axes = await resolveDraftSceneAxes({}, [ASSET_URL, 'b.jpg'], { loadAssetTags })
    expect(axes).toEqual({ bodyZone: 'hip-hollow', cropScale: 'wide' })
  })

  it('never looks anything up for a media-less draft', async () => {
    const loadAssetTags = vi.fn()
    expect(await resolveDraftSceneAxes({ bodyZone: 'sternum' }, [], { loadAssetTags })).toEqual({ bodyZone: 'sternum' })
    expect(loadAssetTags).not.toHaveBeenCalled()
  })

  it('degrades to the supplied axes when the lookup throws, never failing the draft', async () => {
    // Non-fatal by contract, the same shape as tryMarkPickedByUrls: losing an
    // axis is a reporting hole, losing the draft loses the billed frame.
    const loadAssetTags = vi.fn().mockRejectedValue(new Error('neon timeout'))
    const axes = await resolveDraftSceneAxes({ cropScale: 'macro' }, [ASSET_URL], { loadAssetTags })
    expect(axes).toEqual({ cropScale: 'macro' })
  })

  it('drops an out-of-vocabulary tag rather than carrying it onto a fresh post', async () => {
    const loadAssetTags = vi.fn().mockResolvedValue([['axis:bodyZone=hip_hollow', 'axis:cropScale=macro']])
    const axes = await resolveDraftSceneAxes({}, [ASSET_URL], { loadAssetTags })
    expect(axes).toEqual({ cropScale: 'macro' })
  })
})

describe('backfillPostSceneAxes, the deduped-draft branch', () => {
  it('patches an already-open row rather than leaving its axes null forever', async () => {
    const patchPostAxes = vi.fn().mockResolvedValue(undefined)
    await backfillPostSceneAxes(42, GENERATED, { patchPostAxes })
    expect(patchPostAxes).toHaveBeenCalledWith(42, GENERATED)
  })

  it('does nothing when there is nothing to fill', async () => {
    const patchPostAxes = vi.fn()
    await backfillPostSceneAxes(42, {}, { patchPostAxes })
    expect(patchPostAxes).not.toHaveBeenCalled()
  })

  it('swallows a write failure: a backfill must never break a draft', async () => {
    const patchPostAxes = vi.fn().mockRejectedValue(new Error('deadlock'))
    await expect(backfillPostSceneAxes(42, GENERATED, { patchPostAxes })).resolves.toBeUndefined()
  })
})
