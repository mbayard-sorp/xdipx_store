import { describe, it, expect } from 'vitest'
import { buildFlowPayload, emailHeaderImageUrl, flowEventProps, inferProductType, pickHeaderAsset, emailsForFlow, FLOW_NAMES } from './klaviyo-flows.server'
import { FLOW_EMAILS } from './klaviyo-flow-templates'

const ids = Object.fromEntries(FLOW_EMAILS.map(e => [e.key, `tpl-${e.key}`]))
const ctx = {
  triggerMetricId: 'MTRIG',
  placedOrderMetricId: 'MORDER',
  templateIds: ids,
  fromEmail: 'hello@xdipx.com',
  fromLabel: 'xdipx',
}

type Action = { temporary_id: string; type: string; links: { next: string | null }; data: Record<string, any> }
function actionsOf(payload: Record<string, any>): Action[] {
  return payload['data'].attributes.definition.actions as Action[]
}

describe('buildFlowPayload', () => {
  it('never sets a status field (the API creates flows as drafts)', () => {
    for (const flow of ['browse-abandonment', 'cart-abandonment', 'post-purchase'] as const) {
      const p = buildFlowPayload(flow, ctx) as Record<string, any>
      expect(p['data'].attributes.status).toBeUndefined()
      expect(p['data'].attributes.name).toBe(FLOW_NAMES[flow])
      for (const a of actionsOf(p)) expect(a.data['message']?.status).toBeUndefined()
    }
  })

  it('browse abandonment: 4h delay, one email, not-ordered filter', () => {
    const p = buildFlowPayload('browse-abandonment', ctx) as Record<string, any>
    const acts = actionsOf(p)
    expect(acts.map(a => a.type)).toEqual(['time-delay', 'send-email'])
    expect(acts[0]!.data).toMatchObject({ unit: 'hours', value: 4 })
    expect(acts[1]!.data['message'].template_id).toBe('tpl-browse-4h')
    expect(p['data'].attributes.definition.profile_filter.condition_groups[0].conditions[0].metric_id).toBe('MORDER')
    expect(p['data'].attributes.definition.triggers).toEqual([{ type: 'metric', id: 'MTRIG' }])
  })

  it('cart abandonment: 1h then 24h total, two emails', () => {
    const acts = actionsOf(buildFlowPayload('cart-abandonment', ctx))
    expect(acts.map(a => a.type)).toEqual(['time-delay', 'send-email', 'time-delay', 'send-email'])
    expect(acts[0]!.data).toMatchObject({ unit: 'hours', value: 1 })
    // 24h from the trigger means a 23h gap after the first email.
    expect(acts[2]!.data).toMatchObject({ unit: 'hours', value: 23 })
  })

  it('post-purchase: day 3 then day 14 from the order, no filter', () => {
    const p = buildFlowPayload('post-purchase', ctx) as Record<string, any>
    const acts = actionsOf(p)
    expect(acts[0]!.data).toMatchObject({ unit: 'days', value: 3 })
    expect(acts[2]!.data).toMatchObject({ unit: 'days', value: 11 })
    expect(p['data'].attributes.definition.profile_filter).toBeUndefined()
  })

  it('chains actions and ends the last one with a null next', () => {
    const acts = actionsOf(buildFlowPayload('cart-abandonment', ctx))
    expect(acts[0]!.links.next).toBe('email-1')
    expect(acts[1]!.links.next).toBe('delay-2')
    expect(acts[3]!.links.next).toBeNull()
  })

  it('uses the first subject variant and matches emailsForFlow', () => {
    const acts = actionsOf(buildFlowPayload('post-purchase', ctx))
    const emails = emailsForFlow('post-purchase')
    expect(acts[1]!.data['message'].subject_line).toBe(emails[0]!.subjects[0])
  })
})

describe('pickHeaderAsset', () => {
  const loved = (over: Record<string, unknown> = {}) => ({ id: 1, url: 'https://cdn/x.jpg', aspect: '4:5', visionVerdict: { pass: true }, ...over })

  it('prefers a rated-up on-skin asset over the packshot', async () => {
    const r = await pickHeaderAsset('wild-rose', {
      searchLovedAssets: async (_h, arch) => (arch === 'cast' ? [loved({ id: 7 })] : []),
      positionZeroImage: async () => 'https://cdn/pack.jpg',
    })
    expect(r).toEqual({ url: 'https://cdn/x.jpg', kind: 'onskin', assetId: 7 })
  })

  it('prefers wider aspects and skips a failed vision verdict', async () => {
    const r = await pickHeaderAsset('wild-rose', {
      searchLovedAssets: async () => [
        loved({ id: 1, aspect: '4:5', url: 'https://cdn/tall.jpg' }),
        loved({ id: 2, aspect: '16:9', url: 'https://cdn/wide-bad.jpg', visionVerdict: { pass: false } }),
        loved({ id: 3, aspect: '1:1', url: 'https://cdn/square.jpg' }),
      ],
      positionZeroImage: async () => null,
    })
    expect(r.assetId).toBe(3)
  })

  it('falls back to the position-0 image when nothing is rated up', async () => {
    const r = await pickHeaderAsset('wild-rose', {
      searchLovedAssets: async () => [],
      positionZeroImage: async () => 'https://cdn/pack.jpg',
    })
    expect(r).toEqual({ url: 'https://cdn/pack.jpg', kind: 'packshot' })
  })

  it('returns kind none when there is no image at all, and survives a library error', async () => {
    const r = await pickHeaderAsset('wild-rose', {
      searchLovedAssets: async () => {
        throw new Error('db down')
      },
      positionZeroImage: async () => null,
    })
    expect(r).toEqual({ url: null, kind: 'none' })
  })
})

describe('flowEventProps', () => {
  it('builds the keys the templates read', async () => {
    const props = await flowEventProps('wild-rose', {
      product: async () => ({ title: 'Wild Rose Air Pulsation Stimulator', tags: [] }),
      searchLovedAssets: async () => [],
      positionZeroImage: async () => 'https://cdn/pack.jpg',
    })
    expect(props).toMatchObject({
      ProductName: 'Wild Rose Air Pulsation Stimulator',
      ProductURL: 'https://xdipx.com/products/wild-rose',
      ProductHandle: 'wild-rose',
      ProductType: 'air-pulsation',
      HeaderImageURL: 'https://cdn/pack.jpg',
      HeaderKind: 'packshot',
    })
  })

  it('returns null for an unknown product instead of throwing', async () => {
    expect(await flowEventProps('nope', { product: async () => null })).toBeNull()
  })
})

describe('inferProductType', () => {
  it('maps catalog words to act blocks', () => {
    expect(inferProductType('Womanizer Liberty 2')).toBe('air-pulsation')
    expect(inferProductType('Le Wand Petite Rechargeable Massager')).toBe('wand')
    expect(inferProductType('Sliquid Naturals H2O Lubricant')).toBe('lube')
    expect(inferProductType('Dame Zee Bullet Vibrator')).toBe('vibrator')
    expect(inferProductType('Mystery Object')).toBeUndefined()
  })
})

describe('emailHeaderImageUrl', () => {
  it('crops a Shopify CDN header to a 2x square and keeps its version param', () => {
    const out = new URL(emailHeaderImageUrl('https://cdn.shopify.com/s/files/1/x/files/a.jpg?v=123'))
    expect(out.searchParams.get('v')).toBe('123')
    expect(out.searchParams.get('width')).toBe('1200')
    expect(out.searchParams.get('height')).toBe('1200')
    expect(out.searchParams.get('crop')).toBe('center')
  })
  it('leaves other hosts and junk alone', () => {
    expect(emailHeaderImageUrl('https://cdn/pack.jpg')).toBe('https://cdn/pack.jpg')
    expect(emailHeaderImageUrl('not a url')).toBe('not a url')
  })
})
