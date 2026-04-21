/**
 * Admin action endpoint for Emma context-row picks. POST-only.
 *
 * Intents:
 *   - create-group       → insert a new group; no picks yet (lazy-on-miss fills)
 *   - update-group       → patch fields; if brief_hash changes, auto-regen against live deal
 *   - delete-group       → cascade-deletes runs via FK
 *   - regenerate-picks   → force a fresh Haiku call against the current live deal
 *   - edit-pick          → change pairingWhy for one product in a run; marks edited=true
 *   - reorder-picks      → accept JSON array of productGids, reorder the run's picks
 *   - remove-pick        → drop one product from a run
 */
import type { ActionFunctionArgs } from 'react-router'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '~/lib/session.server'
import { db } from '~/lib/db.server'
import { emmaPickGroups, type EmmaPickEntry } from '../../db/schema'
import {
  computeBriefHash,
  generatePicksForGroup,
  getGroupBySlug,
  patchRunPicks,
} from '~/lib/emma-picks.server'
import { getDailyDeal } from '~/lib/shopify.server'

export async function loader() {
  return new Response('Method Not Allowed', { status: 405 })
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 })
  }

  const form   = await request.formData()
  const intent = String(form.get('intent') ?? '')

  try {
    switch (intent) {
      case 'create-group':      return await handleCreateGroup(form)
      case 'update-group':      return await handleUpdateGroup(form)
      case 'delete-group':      return await handleDeleteGroup(form)
      case 'regenerate-picks':  return await handleRegeneratePicks(form)
      case 'edit-pick':         return await handleEditPick(form)
      case 'reorder-picks':     return await handleReorderPicks(form)
      case 'remove-pick':       return await handleRemovePick(form)
      default:
        return Response.json({ ok: false, error: 'unknown_intent' }, { status: 400 })
    }
  } catch (err) {
    console.error('[api.admin.emma-picks]', intent, err)
    const msg = err instanceof Error ? err.message : 'internal_error'
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function str(form: FormData, key: string, fallback = ''): string {
  const v = form.get(key)
  return typeof v === 'string' ? v : fallback
}

function int(form: FormData, key: string, fallback: number): number {
  const v = form.get(key)
  if (typeof v !== 'string' || v === '') return fallback
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

function bool(form: FormData, key: string): boolean {
  const v = form.get(key)
  return v === 'true' || v === 'on' || v === '1'
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `group-${Date.now()}`
}

function validateKind(k: string): 'pairing' | 'alternative' | 'adjacent' {
  return (k === 'pairing' || k === 'alternative' || k === 'adjacent') ? k : 'pairing'
}

function validateSourceType(s: string): 'tag' | 'collection' | 'manual' {
  return (s === 'tag' || s === 'collection' || s === 'manual') ? s : 'tag'
}

async function getLiveDealHandle(): Promise<string | null> {
  try {
    const d = await getDailyDeal()
    return d?.handle ?? null
  } catch {
    return null
  }
}

// ─── Intent handlers ───────────────────────────────────────────────────────

async function handleCreateGroup(form: FormData) {
  const name         = str(form, 'name').trim()
  if (!name) return Response.json({ ok: false, error: 'name_required' }, { status: 400 })

  const kind         = validateKind(str(form, 'kind', 'pairing'))
  const emmaContext  = str(form, 'emmaContext').trim()
  const sourceType   = validateSourceType(str(form, 'sourceType', 'tag'))
  const sourceValue  = str(form, 'sourceValue').trim()
  const maxPicks     = Math.max(3, Math.min(12, int(form, 'maxPicks', 10)))
  const displayCount = Math.max(1, Math.min(maxPicks, int(form, 'displayCount', 4)))
  const active       = form.has('active') ? bool(form, 'active') : true
  const sortOrder    = int(form, 'sortOrder', 0)
  const slug         = slugify(str(form, 'slug') || name)

  const briefHash = computeBriefHash({ emmaContext, sourceType, sourceValue, kind, maxPicks })

  const [row] = await db
    .insert(emmaPickGroups)
    .values({
      name, slug, kind, emmaContext, sourceType, sourceValue,
      maxPicks, displayCount, active, sortOrder, briefHash,
    })
    .returning()

  return Response.json({ ok: true, group: row })
}

async function handleUpdateGroup(form: FormData) {
  const slug = str(form, 'slug')
  if (!slug) return Response.json({ ok: false, error: 'slug_required' }, { status: 400 })

  const existing = await getGroupBySlug(slug)
  if (!existing) return Response.json({ ok: false, error: 'group_not_found' }, { status: 404 })

  const name         = str(form, 'name', existing.name).trim() || existing.name
  const kind         = validateKind(str(form, 'kind', existing.kind))
  const emmaContext  = str(form, 'emmaContext', existing.emmaContext).trim()
  const sourceType   = validateSourceType(str(form, 'sourceType', existing.sourceType))
  const sourceValue  = str(form, 'sourceValue', existing.sourceValue).trim()
  const maxPicks     = Math.max(3, Math.min(12, int(form, 'maxPicks', existing.maxPicks)))
  const displayCount = Math.max(1, Math.min(maxPicks, int(form, 'displayCount', existing.displayCount)))
  const active       = form.has('active') ? bool(form, 'active') : existing.active
  const sortOrder    = int(form, 'sortOrder', existing.sortOrder)

  const nextHash = computeBriefHash({ emmaContext, sourceType, sourceValue, kind, maxPicks })

  await db
    .update(emmaPickGroups)
    .set({
      name, kind, emmaContext, sourceType, sourceValue,
      maxPicks, displayCount, active, sortOrder,
      briefHash: nextHash,
      updatedAt: new Date(),
    })
    .where(eq(emmaPickGroups.id, existing.id))

  let regen: { triggered: boolean; ok?: boolean; reason?: string } = { triggered: false }
  if (nextHash !== existing.briefHash && active) {
    const dealHandle = await getLiveDealHandle()
    if (dealHandle) {
      const result = await generatePicksForGroup({
        group: { ...existing, name, kind, emmaContext, sourceType, sourceValue, maxPicks, displayCount, active, sortOrder, briefHash: nextHash },
        dealHandle,
        trigger: 'brief_change',
      })
      regen = { triggered: true, ok: result.ok, ...(!result.ok ? { reason: result.reason } : {}) }
    } else {
      regen = { triggered: false, reason: 'no_live_deal' }
    }
  }

  return Response.json({ ok: true, regen })
}

async function handleDeleteGroup(form: FormData) {
  const slug = str(form, 'slug')
  if (!slug) return Response.json({ ok: false, error: 'slug_required' }, { status: 400 })

  const existing = await getGroupBySlug(slug)
  if (!existing) return Response.json({ ok: false, error: 'group_not_found' }, { status: 404 })

  // FK on emma_pick_runs.group_id has ON DELETE CASCADE, so runs are cleaned up.
  await db.delete(emmaPickGroups).where(eq(emmaPickGroups.id, existing.id))
  return Response.json({ ok: true })
}

async function handleRegeneratePicks(form: FormData) {
  const slug = str(form, 'slug')
  if (!slug) return Response.json({ ok: false, error: 'slug_required' }, { status: 400 })

  const group = await getGroupBySlug(slug)
  if (!group) return Response.json({ ok: false, error: 'group_not_found' }, { status: 404 })

  const dealHandle = str(form, 'dealHandle') || (await getLiveDealHandle())
  if (!dealHandle) return Response.json({ ok: false, error: 'no_live_deal' }, { status: 400 })

  const result = await generatePicksForGroup({ group, dealHandle, trigger: 'admin' })
  if (!result.ok) return Response.json({ ok: false, error: result.reason }, { status: 400 })
  return Response.json({ ok: true, count: result.count, dealHandle })
}

async function handleEditPick(form: FormData) {
  const groupId    = int(form, 'groupId', 0)
  const dealHandle = str(form, 'dealHandle')
  const productGid = str(form, 'productGid')
  const pairingWhy = str(form, 'pairingWhy').trim()
  if (!groupId || !dealHandle || !productGid) {
    return Response.json({ ok: false, error: 'missing_params' }, { status: 400 })
  }

  const updated = await patchRunPicks(groupId, dealHandle, (picks: EmmaPickEntry[]) =>
    picks.map(p => p.productGid === productGid ? { ...p, pairingWhy, edited: true } : p),
  )
  if (!updated) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })
  return Response.json({ ok: true })
}

async function handleReorderPicks(form: FormData) {
  const groupId    = int(form, 'groupId', 0)
  const dealHandle = str(form, 'dealHandle')
  const orderJson  = str(form, 'order')
  if (!groupId || !dealHandle || !orderJson) {
    return Response.json({ ok: false, error: 'missing_params' }, { status: 400 })
  }

  let order: string[] = []
  try {
    const parsed = JSON.parse(orderJson) as unknown
    if (!Array.isArray(parsed)) throw new Error('order_not_array')
    order = parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return Response.json({ ok: false, error: 'invalid_order_json' }, { status: 400 })
  }

  const updated = await patchRunPicks(groupId, dealHandle, (picks: EmmaPickEntry[]) => {
    const byId = new Map(picks.map(p => [p.productGid, p]))
    const next: EmmaPickEntry[] = []
    for (const id of order) {
      const pick = byId.get(id)
      if (pick) {
        next.push(pick)
        byId.delete(id)
      }
    }
    // Preserve any picks not named in the order (append to tail)
    for (const pick of byId.values()) next.push(pick)
    return next
  })
  if (!updated) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })
  return Response.json({ ok: true })
}

async function handleRemovePick(form: FormData) {
  const groupId    = int(form, 'groupId', 0)
  const dealHandle = str(form, 'dealHandle')
  const productGid = str(form, 'productGid')
  if (!groupId || !dealHandle || !productGid) {
    return Response.json({ ok: false, error: 'missing_params' }, { status: 400 })
  }

  const updated = await patchRunPicks(groupId, dealHandle, (picks: EmmaPickEntry[]) =>
    picks.filter(p => p.productGid !== productGid),
  )
  if (!updated) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })
  return Response.json({ ok: true })
}
