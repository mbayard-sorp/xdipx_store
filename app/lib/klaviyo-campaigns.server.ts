import { getPipelineSetting } from './feed-processor.server'
import { sendOwnerEmail, escapeHtml } from './owner-alerts.server'
import type { EscalationClassName } from './owner-escalation'
import { addSuggestionNote } from './team.server'

/**
 * Executor for `kind:'campaign'` suggestion rows (the email-marketing-manager
 * brief format). Turns an APPROVED campaign brief into a Klaviyo DRAFT campaign
 * plus an owner review email, and records the draft link back on the ticket as
 * a note. Before this, an approved campaign row was a permanent owner dead end:
 * the email planner filed it and nothing could execute it.
 *
 * Phase 1 is deliberately draft only. Creating a campaign through the Klaviyo
 * Campaigns API leaves it in Draft, and actually sending requires a separate
 * campaign-send-job call that this module never makes. Nothing here schedules
 * or sends. The whole path is gated behind `email_campaign_push_enabled`, which
 * defaults OFF in code (a missing setting reads as off), so with the valve off
 * nothing changes.
 *
 * The draft-only Campaigns client is create / preview / list only
 * (`createKlaviyoCampaign`, `previewKlaviyoCampaign`, `listKlaviyoCampaigns`).
 * There is deliberately NO send helper: triggering a send is a campaign-send-job
 * (POST /api/campaign-send-jobs/), an owner-attended money-valve surface that
 * stays in #57 and must never be reachable from an unattended routine (#4222,
 * the shippable code slice split from #57 clause 1).
 */

/** Valve key. Read via the generic pipeline-settings getter. Default OFF. */
export const EMAIL_CAMPAIGN_PUSH_VALVE = 'email_campaign_push_enabled'

const KLAVIYO_BASE = 'https://a.klaviyo.com/api'
const KLAVIYO_REVISION = '2024-10-15'

export interface ParsedCampaignBrief {
  /** Short internal campaign name, derived from the utm_campaign token or the subject. */
  name: string
  subject: string
  previewText: string | null
  /** The free-text audience/segment line, used to resolve a Klaviyo list. */
  audienceHint: string | null
  /** The full brief, carried into the owner email so nothing is lost. */
  body: string
}

export interface AudienceEnv {
  waitlistListId?: string | undefined
  mainListId?: string | undefined
}

export interface AudienceResolution {
  listId: string | null
  /** 'waitlist' | 'main' | 'waitlist-fallback' | 'unresolved' */
  source: string
}

export interface CampaignPayloadInput {
  name: string
  subject: string
  previewText: string | null
  listId: string
  fromEmail: string
  fromLabel: string
}

export interface CampaignPushResult {
  pushed: boolean
  /** 'ok' | 'valve-off' | 'no-klaviyo-api-key' | 'no-audience-list-configured' | 'klaviyo-error: ...' */
  reason: string
  campaignId?: string | undefined
  editUrl?: string | undefined
  ownerEmailed?: boolean | undefined
}

/** Valve gate. A missing or non-'true' setting is OFF. */
export function campaignPushEnabled(settingValue: string | null): boolean {
  return settingValue === 'true'
}

/** Strip one layer of wrapping single or double quotes from a value. */
function unquote(s: string): string {
  const trimmed = s.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

/**
 * Best-effort structured extraction from a free-text campaign brief. The
 * email-marketing-manager writes labelled lines ("Subject:", "Preview:",
 * "Segment:"); we pull what we can and fall back safely so a brief that omits a
 * label still produces a usable draft the owner finishes in Klaviyo.
 */
export function parseCampaignBrief(text: string): ParsedCampaignBrief {
  const firstMatch = (re: RegExp): string | null => {
    const m = text.match(re)
    const captured = m?.[1]
    if (!captured) return null
    const value = unquote(captured)
    return value.length > 0 ? value : null
  }

  const subject =
    firstMatch(/^\s*subject(?:\s*line)?[^:\n]*:\s*(.+)$/im)

  const previewText =
    firstMatch(/^\s*preview(?:\s*text)?[^:\n]*:\s*(.+)$/im)

  const audienceHint =
    firstMatch(/^\s*(?:audience|segment|list|recipients?)[^:\n]*:\s*(.+)$/im)

  const utm = text.match(/utm_campaign=([A-Za-z0-9_-]+)/)
  const utmName = utm?.[1]
  const name = utmName
    ? utmName
    : subject
      ? subject.slice(0, 60)
      : 'xdipx email campaign'

  return {
    name,
    subject: subject ?? 'xdipx (draft, set subject in Klaviyo)',
    previewText,
    audienceHint,
    body: text,
  }
}

/**
 * Resolve the brief's audience to a concrete Klaviyo list id. Only the app's
 * known lists exist as env ids, so this maps the prose hint onto one of them and
 * defaults to the main marketing list. The result is a DRAFT the owner confirms
 * recipients on, so a best-effort audience is safe and correctable in the UI.
 */
export function resolveAudience(hint: string | null, env: AudienceEnv): AudienceResolution {
  const h = (hint ?? '').toLowerCase()
  if (/waitlist/.test(h) && env.waitlistListId) {
    return { listId: env.waitlistListId, source: 'waitlist' }
  }
  if (env.mainListId) return { listId: env.mainListId, source: 'main' }
  if (env.waitlistListId) return { listId: env.waitlistListId, source: 'waitlist-fallback' }
  return { listId: null, source: 'unresolved' }
}

/**
 * Build the POST /api/campaigns/ body. No `send_strategy` is included, so the
 * campaign is created as an unscheduled Draft. The message content carries the
 * subject, preview, and sender; the body HTML template is left for the owner to
 * finish in Klaviyo (the full brief copy travels in the owner email).
 */
export function buildCampaignPayload(i: CampaignPayloadInput): Record<string, unknown> {
  return {
    data: {
      type: 'campaign',
      attributes: {
        name: i.name,
        audiences: { included: [i.listId], excluded: [] },
        'campaign-messages': {
          data: [
            {
              type: 'campaign-message',
              attributes: {
                definition: {
                  channel: 'email',
                  label: i.name,
                  content: {
                    subject: i.subject,
                    preview_text: i.previewText ?? '',
                    from_email: i.fromEmail,
                    from_label: i.fromLabel,
                    reply_to_email: i.fromEmail,
                  },
                },
              },
            },
          ],
        },
      },
    },
  }
}

/** Deep link to the draft campaign in the Klaviyo UI. */
export function klaviyoCampaignEditUrl(campaignId: string): string {
  return `https://www.klaviyo.com/campaign/${campaignId}/edit`
}

/** The owner review email. Carries the full brief so nothing is lost in translation. */
export function buildCampaignOwnerEmail(i: {
  suggestionId: number
  campaignName: string
  subject: string
  editUrl: string | null
  audienceSource: string
  body: string
}): { subject: string; html: string } {
  const link = i.editUrl
    ? `<p><a href="${escapeHtml(i.editUrl)}">Review and send in Klaviyo</a></p>`
    : `<p><em>No Klaviyo draft was created (no audience list resolved). Create the campaign manually from the brief below.</em></p>`
  const html = [
    `<h2>Campaign draft ready to review</h2>`,
    `<p>Ticket #${i.suggestionId} became a Klaviyo <strong>draft</strong>. Nothing was sent or scheduled.</p>`,
    `<ul>`,
    `<li><strong>Name:</strong> ${escapeHtml(i.campaignName)}</li>`,
    `<li><strong>Subject:</strong> ${escapeHtml(i.subject)}</li>`,
    `<li><strong>Audience:</strong> ${escapeHtml(i.audienceSource)}</li>`,
    `</ul>`,
    link,
    `<h3>Full brief</h3>`,
    `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(i.body)}</pre>`,
  ].join('\n')
  return { subject: `Campaign draft ready: ${i.campaignName}`, html }
}

// ─── Dependency seam ────────────────────────────────────────────────────────
// The orchestrator takes its side effects as injected deps so the decision
// logic is unit-tested without a network or a database.

export type KlaviyoCampaignCreator = (
  payload: Record<string, unknown>,
) => Promise<{ id: string }>

export interface CampaignPushDeps {
  getSetting: (key: string) => Promise<string | null>
  createCampaign: KlaviyoCampaignCreator
  sendOwnerEmail: (
    subject: string,
    html: string,
    opts: { escalation: EscalationClassName; fromName?: string },
  ) => Promise<{ sent: boolean; error?: string }>
  addNote: (id: number, ref: string) => Promise<void>
  env: {
    apiKey?: string | undefined
    waitlistListId?: string | undefined
    mainListId?: string | undefined
    fromEmail: string
    fromLabel: string
  }
}

// ─── Draft-only Campaigns client (create / preview / list) ──────────────────
// #4222: the shippable, no-spend slice of #57 clause 1. No send helper lives
// here — see the module header.

/**
 * Thin fetch wrapper for the Klaviyo Campaigns API. Shared by create, preview,
 * and list so auth, revision, and error handling stay in one place.
 */
async function klaviyoCampaignsApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      revision: KLAVIYO_REVISION,
      Authorization: `Klaviyo-API-Key ${process.env['KLAVIYO_API_KEY']}`,
    },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${KLAVIYO_BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Klaviyo campaigns API ${method} ${path} ${res.status}: ${text}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

/** JSON:API resource object, loosely typed — callers read named fields. */
export interface KlaviyoCampaignResource {
  type: string
  id: string
  attributes?: Record<string, unknown>
}

/**
 * Create a campaign. Klaviyo creates it in DRAFT status; this sends nothing.
 * Pass a payload from `buildCampaignPayload` (or an equivalent Campaigns API
 * body). Returns the new campaign's id.
 */
export async function createKlaviyoCampaign(
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const json = await klaviyoCampaignsApi<{ data?: { id?: string } }>('/campaigns/', 'POST', payload)
  const id = json.data?.id
  if (!id) throw new Error('Klaviyo campaign create returned no id')
  return { id }
}

/**
 * Read a campaign back for preview — the draft plus its message content. A GET:
 * it renders nothing to a customer and sends nothing. `messages` holds the
 * included campaign-message resources so a reviewer can see the subject/body.
 */
export async function previewKlaviyoCampaign(
  campaignId: string,
): Promise<{ campaign: KlaviyoCampaignResource; messages: KlaviyoCampaignResource[] }> {
  const json = await klaviyoCampaignsApi<{ data: KlaviyoCampaignResource; included?: KlaviyoCampaignResource[] }>(
    `/campaigns/${encodeURIComponent(campaignId)}/?include=campaign-messages`,
    'GET',
  )
  return {
    campaign: json.data,
    messages: (json.included ?? []).filter(r => r.type === 'campaign-message'),
  }
}

/**
 * List campaigns for one channel. Klaviyo's List Campaigns endpoint REQUIRES a
 * filter on `messages.channel`, so the channel is mandatory here — omitting it
 * is a 400 from Klaviyo, not an optional convenience.
 */
export async function listKlaviyoCampaigns(
  opts: { channel: 'email' | 'sms' },
): Promise<KlaviyoCampaignResource[]> {
  const filter = `equals(messages.channel,"${opts.channel}")`
  const json = await klaviyoCampaignsApi<{ data?: KlaviyoCampaignResource[] }>(
    `/campaigns/?filter=${encodeURIComponent(filter)}`,
    'GET',
  )
  return json.data ?? []
}

/** Production wiring of the dependency seam. */
export function defaultCampaignPushDeps(): CampaignPushDeps {
  return {
    getSetting: getPipelineSetting,
    createCampaign: createKlaviyoCampaign,
    sendOwnerEmail,
    addNote: addSuggestionNote,
    env: {
      apiKey: process.env['KLAVIYO_API_KEY'],
      waitlistListId: process.env['KLAVIYO_LIST_ID_WAITLIST'],
      mainListId: process.env['KLAVIYO_LIST_ID_DAILY_DEAL'],
      fromEmail: process.env['EMAIL_FROM'] ?? 'hello@xdipx.com',
      fromLabel: 'xdipx',
    },
  }
}

/**
 * Push one approved campaign brief to Klaviyo as a draft. Valve-gated: with the
 * valve off this returns immediately with `reason:'valve-off'` and touches
 * nothing. With the valve on it creates the draft, emails the owner a review
 * link, and records that link as a note on the ticket.
 */
export async function pushApprovedCampaign(
  row: { id: number; suggestion: string },
  deps: CampaignPushDeps,
): Promise<CampaignPushResult> {
  if (!campaignPushEnabled(await deps.getSetting(EMAIL_CAMPAIGN_PUSH_VALVE))) {
    return { pushed: false, reason: 'valve-off' }
  }
  if (!deps.env.apiKey) {
    return { pushed: false, reason: 'no-klaviyo-api-key' }
  }

  const brief = parseCampaignBrief(row.suggestion)
  const audience = resolveAudience(brief.audienceHint, {
    waitlistListId: deps.env.waitlistListId,
    mainListId: deps.env.mainListId,
  })

  if (!audience.listId) {
    // Cannot create a campaign without an audience. Surface the brief to the
    // owner so the plan is not silently dropped, and record why.
    const mail = buildCampaignOwnerEmail({
      suggestionId: row.id,
      campaignName: brief.name,
      subject: brief.subject,
      editUrl: null,
      audienceSource: audience.source,
      body: brief.body,
    })
    const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { escalation: 'owner-decision', fromName: 'xdipx email' })
    await deps.addNote(
      row.id,
      `Campaign push skipped: no Klaviyo audience list configured (${audience.source}). Owner emailed the brief.`,
    )
    return { pushed: false, reason: 'no-audience-list-configured', ownerEmailed: sent.sent }
  }

  const payload = buildCampaignPayload({
    name: brief.name,
    subject: brief.subject,
    previewText: brief.previewText,
    listId: audience.listId,
    fromEmail: deps.env.fromEmail,
    fromLabel: deps.env.fromLabel,
  })

  let campaign: { id: string }
  try {
    campaign = await deps.createCampaign(payload)
  } catch (err) {
    return { pushed: false, reason: `klaviyo-error: ${err instanceof Error ? err.message : String(err)}` }
  }

  const editUrl = klaviyoCampaignEditUrl(campaign.id)
  const mail = buildCampaignOwnerEmail({
    suggestionId: row.id,
    campaignName: brief.name,
    subject: brief.subject,
    editUrl,
    audienceSource: audience.source,
    body: brief.body,
  })
  const sent = await deps.sendOwnerEmail(mail.subject, mail.html, { escalation: 'owner-decision', fromName: 'xdipx email' })
  await deps.addNote(
    row.id,
    `Klaviyo draft campaign created: ${editUrl} (audience: ${audience.source}). Review and send in Klaviyo. Draft only, nothing was sent.`,
  )

  return {
    pushed: true,
    reason: 'ok',
    campaignId: campaign.id,
    editUrl,
    ownerEmailed: sent.sent,
  }
}
