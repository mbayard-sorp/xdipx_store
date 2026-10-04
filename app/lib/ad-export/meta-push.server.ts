/**
 * Meta paused draft: the push step. See meta-paused-draft.server.ts for the
 * contract. Order of refusals is deliberate and tested: the valve is checked
 * FIRST, so with ads_spend_enabled off nothing else is read or sent.
 *
 *   1. valve off                       -> MetaPushError('spend_disabled')
 *   2. token, account or page missing  -> MetaPushError('not_configured')
 *   3. payload not a safe paused draft -> MetaPushError('not_exportable')
 *   4. Marketing API calls in order, each with status PAUSED:
 *      adimages (hash), campaign, ad set, ad creative, ad
 *
 * Campaign and ad set ids that already exist for the idea (a sibling size was
 * pushed first) are passed in and reused, so three sizes make one campaign.
 * A failure part way returns the ids created so far on the error so the caller
 * can store them and a retry does not duplicate.
 */
import { MetaPushError, isMetaDraftPayload, type MetaDraftPayload } from './meta-payload'

export interface MetaCredentials { token: string | null; accountId: string | null; pageId: string | null }

export function metaCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MetaCredentials {
  const clean = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null)
  const account = clean(env['META_AD_ACCOUNT_ID'])
  return {
    token: clean(env['META_ADS_ACCESS_TOKEN']) ?? clean(env['META_ACCESS_TOKEN']),
    accountId: account ? (account.startsWith('act_') ? account : `act_${account}`) : null,
    pageId: clean(env['META_PAGE_ID']),
  }
}

export interface MetaPushDeps {
  spendEnabled: () => Promise<boolean>
  credentials: () => MetaCredentials
  fetchImpl?: typeof fetch
  fetchBytes: (url: string) => Promise<Buffer>
}

export interface MetaPushExisting { campaignId?: string | null; adSetId?: string | null }

export interface MetaPushResult {
  externalAdId: string
  campaignId: string
  adSetId: string
  creativeId: string
  imageHash: string
  pushedAt: string
  reused: { campaign: boolean; adSet: boolean }
}

const GRAPH = 'https://graph.facebook.com'

async function call(
  f: typeof fetch,
  token: string,
  version: string,
  path: string,
  body: Record<string, unknown>,
  partial: MetaPushError['partial'],
  step: string,
): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await f(`${GRAPH}/${version}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new MetaPushError('api_error', `Meta ${step} request failed: ${err instanceof Error ? err.message : String(err)}`, partial)
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || json['error']) {
    const e = (json['error'] ?? {}) as Record<string, unknown>
    const msg = typeof e['error_user_msg'] === 'string' ? e['error_user_msg'] : typeof e['message'] === 'string' ? e['message'] : `HTTP ${res.status}`
    throw new MetaPushError('api_error', `Meta ${step} refused: ${msg}`, partial)
  }
  return json
}

/** Create the paused draft for one ad of a payload set. Never creates anything ACTIVE. */
export async function pushMetaDraft(
  payload: unknown,
  adCreativeId: number,
  existing: MetaPushExisting,
  deps: MetaPushDeps,
): Promise<MetaPushResult> {
  if (!(await deps.spendEnabled())) {
    throw new MetaPushError('spend_disabled', 'Spend is off (ads_spend_enabled is false). Nothing was sent to Meta.')
  }
  const cred = deps.credentials()
  const missing = [!cred.token && 'META_ADS_ACCESS_TOKEN', !cred.accountId && 'META_AD_ACCOUNT_ID', !cred.pageId && 'META_PAGE_ID'].filter(Boolean)
  if (missing.length) throw new MetaPushError('not_configured', `Meta is not configured: ${missing.join(', ')} not set. Nothing was sent.`)
  if (!isMetaDraftPayload(payload)) throw new MetaPushError('not_exportable', 'No ready Meta payload on this creative. Build it first.')
  MetaPushError.assertSafe(payload)
  const p: MetaDraftPayload = payload
  const ad = p.ads.find(a => a.creativeId === adCreativeId)
  if (!ad) throw new MetaPushError('not_exportable', `Creative #${adCreativeId} is not in this payload.`)
  if (!ad.image.assetUrl) throw new MetaPushError('not_exportable', 'The creative has no rendered image to upload.')

  const f = deps.fetchImpl ?? fetch
  const token = cred.token!
  const acct = cred.accountId!
  const v = p.apiVersion
  const partial: MetaPushError['partial'] = {}

  // 1. image hash
  let bytes: Buffer
  try { bytes = await deps.fetchBytes(ad.image.assetUrl) } catch (err) {
    throw new MetaPushError('api_error', `Could not read the rendered PNG: ${err instanceof Error ? err.message : String(err)}`, partial)
  }
  const up = await call(f, token, v, `${acct}/adimages`, { bytes: bytes.toString('base64'), name: ad.image.filename }, partial, 'image upload')
  const images = (up['images'] ?? {}) as Record<string, { hash?: string }>
  const hash = Object.values(images)[0]?.hash
  if (!hash) throw new MetaPushError('api_error', 'Meta image upload returned no hash.', partial)
  partial.imageHash = hash

  // 2. campaign (reused when a sibling size already made it)
  let campaignId = existing.campaignId ?? null
  const reusedCampaign = !!campaignId
  if (!campaignId) {
    const r = await call(f, token, v, `${acct}/campaigns`, { ...p.campaign }, partial, 'campaign')
    campaignId = String(r['id'] ?? '')
    if (!campaignId) throw new MetaPushError('api_error', 'Meta campaign create returned no id.', partial)
  }
  partial.campaignId = campaignId

  // 3. ad set
  let adSetId = existing.adSetId ?? null
  const reusedAdSet = !!adSetId
  if (!adSetId) {
    const r = await call(f, token, v, `${acct}/adsets`, { ...p.adSet, campaign_id: campaignId }, partial, 'ad set')
    adSetId = String(r['id'] ?? '')
    if (!adSetId) throw new MetaPushError('api_error', 'Meta ad set create returned no id.', partial)
  }
  partial.adSetId = adSetId

  // 4. creative
  const spec = ad.adCreative.object_story_spec
  const cr = await call(f, token, v, `${acct}/adcreatives`, {
    name: ad.adCreative.name,
    object_story_spec: { page_id: cred.pageId, link_data: { ...spec.link_data, image_hash: hash } },
  }, partial, 'ad creative')
  const creativeId = String(cr['id'] ?? '')
  if (!creativeId) throw new MetaPushError('api_error', 'Meta ad creative create returned no id.', partial)
  partial.creativeId = creativeId

  // 5. ad, PAUSED
  const ar = await call(f, token, v, `${acct}/ads`, {
    name: ad.ad.name, status: 'PAUSED', adset_id: adSetId, creative: { creative_id: creativeId },
  }, partial, 'ad')
  const adId = String(ar['id'] ?? '')
  if (!adId) throw new MetaPushError('api_error', 'Meta ad create returned no id.', partial)
  partial.adId = adId

  return {
    externalAdId: adId, campaignId, adSetId, creativeId, imageHash: hash,
    pushedAt: new Date().toISOString(), reused: { campaign: reusedCampaign, adSet: reusedAdSet },
  }
}
