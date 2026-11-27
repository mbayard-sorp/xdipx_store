/**
 * Neon compute over-burn watch: the cron half. See neon-burn-core.ts for the
 * why and the math.
 *
 * Runs once a day on a minute the compute is already awake for other crons,
 * reads two cheap catalog views, keeps the snapshot history in KV (no Neon
 * writes), and files a deduped `code` ticket per finding so R-DEV finds and
 * fixes the cause. Filing never throws (detection-tickets.server.ts).
 *
 * Server-only.
 */
import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { kvGet, kvSet } from '~/lib/kv.server'
import { fileDetectionTicket, makeDedupeKey, priorityFromSeverity } from '~/lib/detection-tickets.server'
import {
  appendSnapshot,
  assessBurn,
  renderBurnTicket,
  type BurnAssessment,
  type BurnSnapshot,
  type NeonUsage,
  type TableCounters,
} from '~/lib/neon-burn-core'

export const HISTORY_KEY = 'neon-burn:history'
const HISTORY_TTL_SECONDS = 30 * 24 * 3600

async function readSnapshot(): Promise<BurnSnapshot> {
  const res = await db.execute(sql`
    SELECT
      pg_postmaster_start_time() AS postmaster_start,
      relname,
      (coalesce(seq_scan, 0) + coalesce(idx_scan, 0))::bigint AS reads,
      (n_tup_ins + n_tup_upd + n_tup_del)::bigint AS writes
    FROM pg_stat_user_tables
  `)
  const rows = (res.rows ?? []) as Array<Record<string, unknown>>
  const tables: Record<string, TableCounters> = {}
  let postmasterStart = ''
  for (const r of rows) {
    postmasterStart ||= new Date(String(r['postmaster_start'])).toISOString()
    tables[String(r['relname'])] = { reads: Number(r['reads'] ?? 0), writes: Number(r['writes'] ?? 0) }
  }
  if (!postmasterStart) {
    const pm = await db.execute(sql`SELECT pg_postmaster_start_time() AS t`)
    postmasterStart = new Date(String((pm.rows?.[0] as Record<string, unknown>)?.['t'])).toISOString()
  }
  return { at: new Date().toISOString(), postmasterStart, tables }
}

/**
 * The billed number, when the owner has given us a Neon API key. Best effort:
 * any failure returns null and the watch falls back to the in-database proxy.
 */
async function readNeonUsage(): Promise<NeonUsage | null> {
  const key = process.env.NEON_API_KEY
  const project = process.env.NEON_PROJECT_ID
  if (!key || !project) return null
  try {
    const res = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.warn(`[neon-burn] Neon API ${res.status}; using the in-database proxy`)
      return null
    }
    const body = (await res.json()) as { project?: Record<string, unknown> }
    const p = body.project ?? {}
    const active = Number(p['active_time_seconds'])
    const periodStart = String(p['consumption_period_start'] ?? '')
    if (!Number.isFinite(active) || !periodStart) return null
    return { activeSeconds: active, periodStart }
  } catch (err) {
    console.warn('[neon-burn] Neon API read failed; using the in-database proxy:', String(err).slice(0, 200))
    return null
  }
}

export interface NeonBurnResult {
  ok: true
  neonApi: 'configured' | 'not-configured' | 'unavailable'
  assessment: BurnAssessment
  ticketsFiled: number[]
}

export async function runNeonBurnWatch(opts: { dryRun?: boolean } = {}): Promise<NeonBurnResult> {
  const snap = await readSnapshot()
  const configured = Boolean(process.env.NEON_API_KEY && process.env.NEON_PROJECT_ID)
  snap.neon = configured ? await readNeonUsage() : null

  const history = appendSnapshot((await kvGet<BurnSnapshot[]>(HISTORY_KEY)) ?? [], snap)
  if (!opts.dryRun) await kvSet(HISTORY_KEY, history, HISTORY_TTL_SECONDS)

  const assessment = assessBurn(history, new Date())
  const ticketsFiled: number[] = []
  if (!opts.dryRun) {
    for (const f of assessment.findings) {
      const id = await fileDetectionTicket({
        detector: 'neon-burn-watch',
        dedupeKey: makeDedupeKey('neon-burn', f.kind),
        priority: priorityFromSeverity('P2'),
        suggestion: renderBurnTicket(f, assessment),
        category: 'cost',
        kind: 'code',
        targetTeam: 'strategy',
      })
      if (id) ticketsFiled.push(id)
    }
  }

  return {
    ok: true,
    neonApi: !configured ? 'not-configured' : snap.neon ? 'configured' : 'unavailable',
    assessment,
    ticketsFiled,
  }
}
