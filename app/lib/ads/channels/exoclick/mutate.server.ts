/**
 * ExoClick mutations for the ads control plane (ticket #19412).
 * PROTECTED PATH: the owner merges every change to this file.
 *
 * This is the only code that writes to a live ExoClick campaign. It is
 * reached from the ExoClick adapter (and so from the ledger dispatcher and
 * operator.server.ts), and it re-checks its own gate on every call, so the
 * rule holds even if a caller skips the dispatcher: with
 * exoclick_operator_enabled off nothing is written, with a brake the switch
 * alone decides, and with gas the switch and exoclick_total_cap_cents both
 * must allow it (operator-core.ts).
 *
 * Verbs:
 * - pause (campaign): PUT /campaigns/pause {campaign_ids}. Brake.
 * - pause (ad, a variation): refused. The variation pause route was not
 *   verifiable when this shipped (the swagger answers 403), and a guessed
 *   write is worse than none. See variationPauseSupported.
 * - resume: PUT /campaigns/play {campaign_ids}. Gas.
 * - set_budget: PUT /campaigns/{id} with the daily budget in cents. A brake
 *   when it lowers the budget, gas otherwise. Never below ExoClick's $20 floor.
 * - block_placement: POST /campaigns/{id}/blocked/sites with an array of
 *   hostnames. Additive only: the block list is never replaced or trimmed from
 *   here, so there is deliberately no PUT or DELETE on it. Brake.
 * - update_creative: upload a banner variation to a campaign. Gas.
 * - createPaused: create a campaign with status 0 (paused). Gas.
 *
 * dryRun builds the exact requests and returns them without sending. Reads
 * still run, so a dry run shows the real before state.
 */
import { ChannelNotEnabledError, MutationRefusedError, type MutationRefusalCode } from '../errors'
import type { ChannelId, CreatedRefs, MutationRequest, MutationResult } from '../types'
import { ExoClickError, exoClient, type ExoClient } from './client.server'
import { campaignFromRow, listCampaigns, readCampaign, type ExoCampaignRead } from './campaign-read.server'
import {
  EXO_MIN_BUDGET_CENTS, MAX_BLOCK_HOSTNAMES_PER_CALL, classifyExoVerb, evaluateExoGate, normalizeHostname, projectTotalSpendCents,
  type ExoCampaignMoney, type ExoGate, type ExoOperatorSettings, type ExoVerbKind,
} from './operator-core'
import { EXOCLICK_CHANNEL, exoclickPolicyCheck } from './policy-core'

const CHANNEL: ChannelId = EXOCLICK_CHANNEL

/**
 * False until the variation pause route is verified against ExoClick's
 * swagger or a live call. The campaign verbs came from calls made by hand;
 * this one did not.
 */
export const variationPauseSupported = false

export interface ExoWrite {
  method: 'POST' | 'PUT'
  path: string
  body: unknown
}

export interface ExoMutateResult extends MutationResult {
  dryRun: boolean
  /** The writes this call sent, or would send under dryRun. */
  requests: ExoWrite[]
  touchedIds: string[]
}

export interface ExoMutateOptions {
  dryRun?: boolean
}

export interface ExoMutateDeps {
  client?: ExoClient
  settings?: () => Promise<ExoOperatorSettings>
  syncAfterWrite?: (platform: ChannelId, externalIds: string[]) => Promise<unknown>
}

/** What createPaused takes. body is ExoClick's own JSON; the money fields are ours, for the cap check. */
export interface ExoCreateCampaignPayload {
  /** The exact JSON body for POST /campaigns. status is forced to 0 (paused). */
  body: Record<string, unknown>
  dailyBudgetCents: number
  totalBudgetCents?: number | null
}

export interface ExoGateReading {
  kind: ExoVerbKind
  gate: ExoGate
  /** The campaign as read live, when the gate needed it. */
  campaign: ExoCampaignRead | null
  projectedTotalCents: number | null
}

async function defaultSettings(): Promise<ExoOperatorSettings> {
  const { getExoOperatorSettings } = await import('./settings.server')
  return getExoOperatorSettings()
}

async function defaultSyncAfterWrite(platform: ChannelId, externalIds: string[]): Promise<unknown> {
  const { syncAfterWrite } = await import('../../sync.server')
  return syncAfterWrite(platform, externalIds)
}

function refuse(code: MutationRefusalCode, message: string): never {
  throw new MutationRefusedError(CHANNEL, code, message)
}

const wholeCents = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 ? v : null

const statusOf = (c: ExoCampaignRead | null) => (c ? { status: c.status } : null)

export function createExoclickMutate(deps: ExoMutateDeps = {}) {
  const client = deps.client ?? exoClient
  const settings = deps.settings ?? defaultSettings
  const sync = deps.syncAfterWrite ?? defaultSyncAfterWrite

  /**
   * The gate for one action, with the live reads it needs. With the switch off
   * it returns before any network call, so an off switch costs nothing and
   * touches nothing.
   */
  async function readGate(
    verb: MutationRequest['verb'] | 'create_paused',
    campaignId: string | null,
    params: unknown,
    createPayload?: ExoCreateCampaignPayload,
  ): Promise<ExoGateReading> {
    const s = await settings()
    if (!s.operatorEnabled) {
      const kind = classifyExoVerb(verb, params, null)
      return { kind, gate: evaluateExoGate({ kind, settings: s, projectedTotalCents: null }), campaign: null, projectedTotalCents: null }
    }
    const campaign = campaignId ? await readCampaign(client, campaignId) : null
    const kind = classifyExoVerb(verb, params, campaign?.dailyBudgetCents ?? null)
    if (kind === 'brake') {
      return { kind, gate: evaluateExoGate({ kind, settings: s, projectedTotalCents: null }), campaign, projectedTotalCents: null }
    }
    // Gas: project the whole account, with this action's addition.
    let projected: number | null = null
    if (s.totalCapCents > 0) {
      const all = await listCampaigns(client)
      projected = projectTotalSpendCents(all, additionFor(verb, campaign, params, createPayload))
    }
    return { kind, gate: evaluateExoGate({ kind, settings: s, projectedTotalCents: projected }), campaign, projectedTotalCents: projected }
  }

  function additionFor(
    verb: MutationRequest['verb'] | 'create_paused',
    campaign: ExoCampaignRead | null,
    params: unknown,
    createPayload?: ExoCreateCampaignPayload,
  ) {
    if (verb === 'create_paused' && createPayload) {
      const m: ExoCampaignMoney = {
        id: 'new', status: 'ACTIVE', spentCents: 0,
        dailyBudgetCents: createPayload.dailyBudgetCents, totalBudgetCents: createPayload.totalBudgetCents ?? null,
      }
      return { campaign: m }
    }
    if (!campaign) return {}
    if (verb === 'resume') return { campaign: { ...campaign } }
    if (verb === 'set_budget') {
      const proposed = wholeCents(((params ?? {}) as Record<string, unknown>)['dailyBudgetCents'])
      // A raise on a running campaign is projected as that campaign carrying the new budget.
      return { campaign: { ...campaign, status: 'ACTIVE', dailyBudgetCents: proposed ?? campaign.dailyBudgetCents } }
    }
    return {}
  }

  /** Throws the typed error the dispatcher turns into a failed row. */
  function enforce(verb: string, reading: ExoGateReading): void {
    if (reading.gate.allowed) return
    if (reading.gate.code === 'not_enabled') throw new ChannelNotEnabledError(CHANNEL, `mutate:${verb}: ${reading.gate.reason}`)
    refuse('total_cap_exceeded', `${verb} refused: ${reading.gate.reason}.`)
  }

  async function send(writes: ExoWrite[], dryRun: boolean, retries?: number): Promise<unknown[]> {
    if (dryRun) return []
    const out: unknown[] = []
    for (const w of writes) {
      const opts = retries === undefined ? undefined : { retries }
      out.push(w.method === 'POST' ? await client.post(w.path, w.body, opts) : await client.put(w.path, w.body, opts))
    }
    return out
  }

  /** Read-after-write. A failed sync never undoes a write that landed. */
  async function readBack(ids: string[], dryRun: boolean): Promise<boolean> {
    if (dryRun || ids.length === 0) return false
    try {
      await sync(CHANNEL, ids)
      return true
    } catch (err) {
      console.error('[ads/exoclick/mutate] read-after-write sync failed', ids, err)
      return false
    }
  }

  function campaignTarget(m: MutationRequest): string {
    if (m.target.level !== 'campaign') {
      if (m.verb === 'pause' && m.target.level === 'ad') {
        refuse('bad_target', variationPauseSupported
          ? 'variation pause is wired'
          : 'ExoClick variation pause is not wired: the route could not be verified. Pause the campaign, or block the sites, instead.')
      }
      refuse('bad_target', `ExoClick ${m.verb} acts on a campaign, not a ${m.target.level}.`)
    }
    if (!m.target.externalId) refuse('bad_target', 'No ExoClick campaign id to change.')
    return m.target.externalId
  }

  async function mutate(m: MutationRequest, opts: ExoMutateOptions = {}): Promise<ExoMutateResult> {
    const dryRun = opts.dryRun === true
    if (m.verb === 'halt_all') throw new ChannelNotEnabledError(CHANNEL, 'mutate:halt_all')
    const id = campaignTarget(m)
    const reading = await readGate(m.verb, id, m.params)
    enforce(m.verb, reading)
    const before = statusOf(reading.campaign)
    if (!reading.campaign) refuse('bad_target', `ExoClick has no campaign ${id}.`)
    const done = async (writes: ExoWrite[], responses: unknown[], after: Record<string, unknown>, beforeRow: Record<string, unknown> | null): Promise<ExoMutateResult> => {
      const synced = await readBack([id], dryRun)
      return {
        applied: !dryRun, dryRun, requests: writes, touchedIds: dryRun ? [] : [id], synced,
        before: beforeRow, after,
        platformResponse: dryRun ? { dryRun: true, requests: writes } : responses[0] ?? null,
      }
    }

    switch (m.verb) {
      case 'pause': {
        const writes: ExoWrite[] = [{ method: 'PUT', path: 'campaigns/pause', body: { campaign_ids: [Number(id)] } }]
        return done(writes, await send(writes, dryRun), { status: 'PAUSED' }, before)
      }
      case 'resume': {
        if (reading.campaign.status === 'ARCHIVED') refuse('bad_target', `ExoClick campaign ${id} is archived and cannot be resumed.`)
        const writes: ExoWrite[] = [{ method: 'PUT', path: 'campaigns/play', body: { campaign_ids: [Number(id)] } }]
        return done(writes, await send(writes, dryRun), { status: 'ACTIVE' }, before)
      }
      case 'set_budget': {
        const p = (m.params ?? {}) as Record<string, unknown>
        const proposed = wholeCents(p['dailyBudgetCents'])
        if (proposed == null) {
          refuse('bad_params', p['lifetimeBudgetCents'] != null
            ? 'set_budget writes the daily budget only; a total budget is an owner change in the ExoClick UI.'
            : 'set_budget needs dailyBudgetCents as a whole number of cents.')
        }
        const cents = proposed as number
        if (cents < EXO_MIN_BUDGET_CENTS) refuse('bad_params', `ExoClick refuses a daily budget under ${EXO_MIN_BUDGET_CENTS} cents ($20); got ${cents}.`)
        const writes: ExoWrite[] = [{ method: 'PUT', path: `campaigns/${encodeURIComponent(id)}`, body: { daily_limit_type: 1, max_daily_budget: cents } }]
        const current = reading.campaign.dailyBudgetCents
        return done(writes, await send(writes, dryRun), { dailyBudgetCents: cents }, { dailyBudgetCents: current })
      }
      case 'block_placement': {
        const p = (m.params ?? {}) as Record<string, unknown>
        const raw = Array.isArray(p['hostnames']) ? (p['hostnames'] as unknown[]) : []
        const hostnames = [...new Set(raw.map(normalizeHostname).filter((h): h is string => h !== null))]
        if (hostnames.length === 0) refuse('bad_params', 'block_placement needs hostnames: an array of plain site hostnames.')
        if (hostnames.length > MAX_BLOCK_HOSTNAMES_PER_CALL) {
          refuse('bad_params', `block_placement takes at most ${MAX_BLOCK_HOSTNAMES_PER_CALL} hostnames per call; got ${hostnames.length}.`)
        }
        // POST adds to the block list. PUT would replace it and DELETE would remove from it.
        const writes: ExoWrite[] = [{ method: 'POST', path: `campaigns/${encodeURIComponent(id)}/blocked/sites`, body: hostnames }]
        const responses = await send(writes, dryRun)
        // Entries that were duplicates or not plain hostnames are dropped and reported, not sent.
        const rejected = raw.length - hostnames.length
        const result = await done(writes, responses, { blockedHostnames: hostnames }, before)
        return rejected > 0 ? { ...result, warning: `${rejected} of ${raw.length} entries were duplicates or not plain hostnames and were not sent.` } : result
      }
      case 'update_creative':
        return uploadBanner(m, id, reading, dryRun)
      default:
        throw new ChannelNotEnabledError(CHANNEL, `mutate:${String(m.verb)}`)
    }
  }

  /**
   * Banner variation upload. params.body is ExoClick's variation JSON. Gas,
   * and only for a URL that carries the four UTMs (docs/ads-policy.md).
   * `name` is dropped on an img_banner campaign because ExoClick rejects it
   * there (verified by hand earlier). The route, POST campaigns/{id}/variation,
   * is the read route's own path and is not verified for POST.
   */
  async function uploadBanner(m: MutationRequest, id: string, reading: ExoGateReading, dryRun: boolean): Promise<ExoMutateResult> {
    const p = (m.params ?? {}) as Record<string, unknown>
    const body = p['body']
    if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_params', 'update_creative needs params.body: the ExoClick variation JSON.')
    const variation = { ...(body as Record<string, unknown>) }
    const url = typeof variation['url'] === 'string' ? variation['url'] : ''
    const verdict = exoclickPolicyCheck({ mirror: [], bannerUrls: [url] })
    if (!verdict.ok) refuse('bad_params', verdict.refusals.map(r => r.message).join(' '))
    if (reading.campaign?.raw['media_storage_template'] === 'img_banner') delete variation['name']
    const writes: ExoWrite[] = [{ method: 'POST', path: `campaigns/${encodeURIComponent(id)}/variation`, body: variation }]
    // Creating a banner is not safe to repeat on a 5xx, so no retries.
    const responses = await send(writes, dryRun, 0)
    const synced = await readBack([id], dryRun)
    return {
      applied: !dryRun, dryRun, requests: writes, touchedIds: dryRun ? [] : [id], synced,
      before: null, after: { uploadedTo: id },
      platformResponse: dryRun ? { dryRun: true, requests: writes } : responses[0] ?? null,
    }
  }

  /** A campaign created PAUSED. The paused status is forced, whatever the body says. */
  async function createPaused(payload: unknown, opts: ExoMutateOptions = {}): Promise<CreatedRefs & { requests: ExoWrite[]; dryRun: boolean }> {
    const dryRun = opts.dryRun === true
    const p = payload as Partial<ExoCreateCampaignPayload> | null
    if (!p || typeof p !== 'object' || !p.body || typeof p.body !== 'object' || Array.isArray(p.body)) {
      refuse('bad_params', 'createPaused needs { body, dailyBudgetCents }.')
    }
    const input = p as ExoCreateCampaignPayload
    const daily = wholeCents(input.dailyBudgetCents)
    if (daily == null || daily < EXO_MIN_BUDGET_CENTS) refuse('bad_params', `createPaused needs dailyBudgetCents of at least ${EXO_MIN_BUDGET_CENTS} cents ($20).`)
    const total = input.totalBudgetCents == null ? null : wholeCents(input.totalBudgetCents)
    if (input.totalBudgetCents != null && (total == null || total < EXO_MIN_BUDGET_CENTS)) {
      refuse('bad_params', `totalBudgetCents must be at least ${EXO_MIN_BUDGET_CENTS} cents ($20) when given.`)
    }
    const reading = await readGate('create_paused', null, null, { ...input, dailyBudgetCents: daily as number, totalBudgetCents: total })
    enforce('createPaused', reading)
    const body = { ...input.body, status: 0 }
    const writes: ExoWrite[] = [{ method: 'POST', path: 'campaigns', body }]
    // Creating is not safe to repeat on a 5xx, so no retries.
    const [res] = (await send(writes, dryRun, 0)) as Array<Record<string, unknown> | undefined>
    if (dryRun) return { requests: writes, dryRun }
    const result = (res?.['result'] ?? res) as Record<string, unknown> | undefined
    const row = (result?.['campaign'] ?? result) as Record<string, unknown> | undefined
    const created = row ? campaignFromRow({ id: row['id'] ?? row['idcampaign'] ?? row['campaign_id'] }) : null
    if (!created) throw new ExoClickError('bad_response', 'ExoClick created a campaign but returned no id. Check the account before trying again.', { path: 'campaigns' })
    await readBack([created.id], false)
    return { campaignId: created.id, requests: writes, dryRun }
  }

  return { mutate, createPaused, readGate }
}

export type ExoclickMutate = ReturnType<typeof createExoclickMutate>

let shared: ExoclickMutate | null = null

/** The process-wide mutate, built on first use so importing this file reads nothing. */
export function exoclickMutate(): ExoclickMutate {
  return (shared ??= createExoclickMutate())
}
