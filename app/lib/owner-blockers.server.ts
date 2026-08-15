/**
 * The owner blocker list (078): the things only Mike can clear, as rows.
 *
 * The daily digest already had a "Needs Mike" section, but it could only see
 * blockers that already had a row somewhere: a blocked ticket, a needs-owner
 * PR, an approved promo. The blockers that actually stall features get decided
 * in conversation and land in prose. "Apply migration 068." "Allowlist
 * *.fal.media." "Enable Imagen billing." "Flip the trend valve." Those lived
 * in docs/store-team/ops-blockers.md, in a memory file, or nowhere, and
 * nothing could tell you whether they were still true a week later.
 *
 * Two things make this different from the doc it replaces:
 *
 *   1. A blocker has an identity (dedupe_key), so the doc parser, the DB
 *      sweep, and the transcript miner all collapse onto one row instead of
 *      three, and re-observing it ages the row instead of duplicating it.
 *   2. A blocker carries a PROBE wherever a machine check exists, so the list
 *      closes its own rows the moment the owner does the thing. A list that
 *      needs hand-curation rots into exactly the artifact it replaced.
 *
 * Every probe is read-only. Probe args come from agents, so identifiers are
 * validated against a strict pattern and checked against information_schema
 * before they are ever interpolated; values are always bound.
 *
 * Server-only.
 */

import { sql } from 'drizzle-orm'
import { db } from '~/lib/db.server'

/* Types, probe phrasing, and the email renderer are pure and live in
 * owner-blockers-core so /admin/blockers can use them without pulling the Neon
 * client into the client bundle. Re-exported here so server callers have one
 * import. */
export * from '~/lib/owner-blockers-core'
import {
  BLOCKER_CATEGORIES,
  BLOCKER_SOURCES,
  PROBE_DESCRIPTIONS,
  blockerEmailSubject,
  isIdent,
  isProbe,
  renderBlockerEmail,
  type BlockerInput,
  type OwnerBlocker,
  type ProbeVerdict,
} from '~/lib/owner-blockers-core'

async function tableExists(table: string): Promise<ProbeVerdict> {
  if (!isIdent(table)) return null
  const res = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${table} LIMIT 1`)
  return (res.rows ?? []).length > 0
}

async function columnExists(arg: string): Promise<ProbeVerdict> {
  const [table, column] = arg.split('.')
  if (!table || !column || !isIdent(table) || !isIdent(column)) return null
  const res = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
     LIMIT 1`)
  return (res.rows ?? []).length > 0
}

async function settingIs(key: string, want: string): Promise<ProbeVerdict> {
  if (!key || key.length > 64) return null
  const res = await db.execute(sql`
    SELECT value FROM pipeline_settings WHERE key = ${key} LIMIT 1`)
  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return want === 'false' ? true : false
  return String(row['value'] ?? '') === want
}

/**
 * Does this table have any rows at all? The table name is validated as an
 * identifier AND confirmed to exist in information_schema before it is
 * interpolated, since a dynamic relation cannot be a bound parameter.
 */
async function rowsExist(table: string): Promise<ProbeVerdict> {
  if (!isIdent(table)) return null
  const exists = await tableExists(table)
  if (exists !== true) return null
  const res = await db.execute(sql`SELECT 1 FROM ${sql.raw(`"${table}"`)} LIMIT 1`)
  return (res.rows ?? []).length > 0
}

/** 'team|run_type|days' — has this routine written a run row recently? */
async function routineRan(arg: string): Promise<ProbeVerdict> {
  const [team, runType, daysRaw] = arg.split('|')
  if (!team || !runType) return null
  const days = Math.min(Math.max(parseInt(daysRaw ?? '7', 10) || 7, 1), 90)
  const res = await db.execute(sql`
    SELECT 1 FROM homepage_team_runs
     WHERE team = ${team} AND run_type = ${runType}
       AND started_at >= now() - (${String(days)} || ' days')::interval
     LIMIT 1`)
  return (res.rows ?? []).length > 0
}

export interface ProbeDef {
  /** Human phrasing of what would clear the row, shown on /admin/blockers. */
  describe: (arg: string) => string
  run: (arg: string) => Promise<ProbeVerdict>
}

const RUNNERS: Record<string, (arg: string) => Promise<ProbeVerdict>> = {
  table_exists:  tableExists,
  column_exists: columnExists,
  setting_true:  a => settingIs(a, 'true'),
  setting_false: a => settingIs(a, 'false'),
  rows_exist:    rowsExist,
  routine_ran:   routineRan,
}

/**
 * The executable probes: core's phrasing paired with the runner here. Built by
 * walking PROBE_DESCRIPTIONS so a probe can never be described to the owner
 * without something able to check it, or vice versa.
 */
export const PROBES: Record<string, ProbeDef> = Object.fromEntries(
  Object.entries(PROBE_DESCRIPTIONS)
    .filter(([name]) => Object.hasOwn(RUNNERS, name))
    .map(([name, describe]) => [name, { describe, run: RUNNERS[name]! }]),
)

/* ── Writing ───────────────────────────────────────────────────────────────── */

function clamp(s: string | null | undefined, n: number): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  return t ? t.slice(0, n) : null
}

export interface FileBlockerResult {
  id: number
  created: boolean
  reopened: boolean
}

/**
 * File a blocker, or re-observe one already filed.
 *
 * Idempotent by dedupe_key, which is the whole point: the doc parser, the
 * nightly DB sweep, and the transcript miner will all independently rediscover
 * the same blocker, and the owner should see one line, aging, not three.
 *
 * A re-observation of an OPEN row bumps last_seen_at and fills in any field
 * that was previously empty, but never overwrites detail the owner may have
 * edited. A re-observation of a CLEARED row reopens it: the condition came
 * back, which is a real event worth surfacing rather than silently ignoring.
 */
export async function fileBlocker(input: BlockerInput): Promise<FileBlockerResult> {
  const dedupeKey = clamp(input.dedupeKey, 80)
  const title = clamp(input.title, 200)
  if (!dedupeKey) throw new Error('fileBlocker: dedupeKey required')
  if (!title) throw new Error('fileBlocker: title required')

  const category = (BLOCKER_CATEGORIES as readonly string[]).includes(input.category ?? '')
    ? input.category! : 'other'
  const source = (BLOCKER_SOURCES as readonly string[]).includes(input.source ?? '')
    ? input.source! : 'agent'
  const priority = Math.min(Math.max(Math.round(Number(input.priority ?? 3)) || 3, 1), 5)
  const probe = isProbe(input.verifyProbe) ? input.verifyProbe : null

  // Read the prior status first. The upsert below cannot report it: RETURNING
  // sees post-update values, so an already-open row and a genuinely reopened
  // one are indistinguishable there.
  const priorRes = await db.execute(sql`
    SELECT status FROM owner_blockers WHERE dedupe_key = ${dedupeKey} LIMIT 1`)
  const priorRow = (priorRes.rows ?? [])[0] as Record<string, unknown> | undefined
  const priorStatus = priorRow ? String(priorRow['status'] ?? '') : null

  const res = await db.execute(sql`
    INSERT INTO owner_blockers (
      dedupe_key, title, detail, unblocks, where_to_go, category, priority,
      source, source_ref, evidence, verify_probe, verify_arg
    ) VALUES (
      ${dedupeKey}, ${title}, ${clamp(input.detail, 4000)}, ${clamp(input.unblocks, 2000)},
      ${clamp(input.whereToGo, 1000)}, ${category}, ${priority},
      ${source}, ${clamp(input.sourceRef, 500)}, ${clamp(input.evidence, 4000)},
      ${probe}, ${clamp(input.verifyArg, 200)}
    )
    ON CONFLICT (dedupe_key) DO UPDATE SET
      last_seen_at = now(),
      updated_at   = now(),
      -- Reopen a cleared row: the condition came back.
      status       = CASE WHEN owner_blockers.status = 'cleared' THEN 'open'
                          ELSE owner_blockers.status END,
      cleared_at   = CASE WHEN owner_blockers.status = 'cleared' THEN NULL
                          ELSE owner_blockers.cleared_at END,
      cleared_by   = CASE WHEN owner_blockers.status = 'cleared' THEN NULL
                          ELSE owner_blockers.cleared_by END,
      -- Fill gaps, never clobber what is already recorded.
      detail       = COALESCE(owner_blockers.detail, EXCLUDED.detail),
      unblocks     = COALESCE(owner_blockers.unblocks, EXCLUDED.unblocks),
      where_to_go  = COALESCE(owner_blockers.where_to_go, EXCLUDED.where_to_go),
      evidence     = COALESCE(owner_blockers.evidence, EXCLUDED.evidence),
      verify_probe = COALESCE(owner_blockers.verify_probe, EXCLUDED.verify_probe),
      verify_arg   = COALESCE(owner_blockers.verify_arg, EXCLUDED.verify_arg)
    RETURNING id, (xmax = 0) AS created`)

  const row = (res.rows ?? [])[0] as Record<string, unknown> | undefined
  return {
    id: Number(row?.['id'] ?? 0),
    created: row?.['created'] === true,
    reopened: priorStatus === 'cleared',
  }
}

export async function clearBlocker(
  id: number,
  by: 'owner' | 'auto' | 'agent',
  note?: string | null,
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE owner_blockers
       SET status = 'cleared', cleared_at = now(), cleared_by = ${by},
           clear_note = ${clamp(note, 1000)}, updated_at = now()
     WHERE id = ${id} AND status <> 'cleared'
     RETURNING id`)
  return (res.rows ?? []).length > 0
}

export async function dismissBlocker(id: number, note?: string | null): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE owner_blockers
       SET status = 'dismissed', cleared_at = now(), cleared_by = 'owner',
           clear_note = ${clamp(note, 1000)}, updated_at = now()
     WHERE id = ${id} AND status = 'open'
     RETURNING id`)
  return (res.rows ?? []).length > 0
}

/* ── Reading ───────────────────────────────────────────────────────────────── */

function toBlocker(r: Record<string, unknown>): OwnerBlocker {
  const firstSeen = String(r['first_seen_at'] ?? '')
  return {
    id: Number(r['id'] ?? 0),
    dedupeKey: String(r['dedupe_key'] ?? ''),
    title: String(r['title'] ?? ''),
    detail: r['detail'] == null ? null : String(r['detail']),
    unblocks: r['unblocks'] == null ? null : String(r['unblocks']),
    whereToGo: r['where_to_go'] == null ? null : String(r['where_to_go']),
    category: String(r['category'] ?? 'other'),
    priority: Number(r['priority'] ?? 3),
    status: String(r['status'] ?? 'open'),
    source: String(r['source'] ?? 'agent'),
    sourceRef: r['source_ref'] == null ? null : String(r['source_ref']),
    evidence: r['evidence'] == null ? null : String(r['evidence']),
    verifyProbe: r['verify_probe'] == null ? null : String(r['verify_probe']),
    verifyArg: r['verify_arg'] == null ? null : String(r['verify_arg']),
    lastVerifiedAt: r['last_verified_at'] == null ? null : String(r['last_verified_at']),
    lastVerifyOk: r['last_verify_ok'] == null ? null : r['last_verify_ok'] === true,
    firstSeenAt: firstSeen,
    lastSeenAt: String(r['last_seen_at'] ?? ''),
    ageDays: Math.max(0, Math.round(Number(r['age_days'] ?? 0))),
  }
}

const SELECT_COLS = sql`
  id, dedupe_key, title, detail, unblocks, where_to_go, category, priority,
  status, source, source_ref, evidence, verify_probe, verify_arg,
  last_verified_at::text AS last_verified_at, last_verify_ok,
  first_seen_at::text AS first_seen_at, last_seen_at::text AS last_seen_at,
  EXTRACT(epoch FROM now() - first_seen_at)::float8 / 86400 AS age_days`

export async function listOpenBlockers(limit = 50): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     WHERE status = 'open'
     ORDER BY priority ASC, first_seen_at ASC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

export async function listRecentlyCleared(days = 7, limit = 20): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     WHERE status = 'cleared'
       AND cleared_at >= now() - (${String(days)} || ' days')::interval
     ORDER BY cleared_at DESC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

export async function listAllBlockers(limit = 200): Promise<OwnerBlocker[]> {
  const res = await db.execute(sql`
    SELECT ${SELECT_COLS} FROM owner_blockers
     ORDER BY (status = 'open') DESC, priority ASC, first_seen_at ASC
     LIMIT ${limit}`)
  return (res.rows ?? []).map(r => toBlocker(r as Record<string, unknown>))
}

/* ── Verification sweep ────────────────────────────────────────────────────── */

export interface VerifyResult {
  checked: number
  autoCleared: Array<{ id: number; title: string }>
  stillBlocked: number
  unknown: number
}

/**
 * Run every open blocker's probe and auto-clear the ones whose condition is
 * now satisfied. This is what keeps the list honest without anyone curating
 * it: the morning after Mike applies a migration or flips a valve, the row
 * closes itself and stops appearing in the email.
 *
 * A probe that errors or returns null leaves the row open. Never the reverse.
 */
export async function verifyBlockers(): Promise<VerifyResult> {
  const open = await listOpenBlockers(200)
  const out: VerifyResult = { checked: 0, autoCleared: [], stillBlocked: 0, unknown: 0 }

  for (const b of open) {
    if (!b.verifyProbe || !isProbe(b.verifyProbe)) continue
    out.checked++
    let verdict: ProbeVerdict = null
    try {
      verdict = await PROBES[b.verifyProbe]!.run(b.verifyArg ?? '')
    } catch (err) {
      console.warn(`[owner-blockers] probe ${b.verifyProbe}(${b.verifyArg}) failed:`, String(err).slice(0, 200))
      verdict = null
    }

    await db.execute(sql`
      UPDATE owner_blockers
         SET last_verified_at = now(), last_verify_ok = ${verdict}, updated_at = now()
       WHERE id = ${b.id}`)

    if (verdict === true) {
      await clearBlocker(b.id, 'auto', `probe ${b.verifyProbe}(${b.verifyArg ?? ''}) satisfied`)
      out.autoCleared.push({ id: b.id, title: b.title })
    } else if (verdict === false) {
      out.stillBlocked++
    } else {
      out.unknown++
    }
  }
  return out
}

/* ── The daily send ────────────────────────────────────────────────────────── */

export interface BlockerEmailResult {
  sent: boolean
  skipped?: string
  open?: number
  autoCleared?: number
  subject?: string
}

/**
 * Verify, then send. Order matters: probes run first so a blocker the owner
 * cleared yesterday never appears in this morning's email. Sending a list that
 * asks for something already done is the fastest way to teach someone to stop
 * reading it.
 *
 * Unlike the digest, this sends even when the list is empty. "Nothing is
 * waiting on you today" is information, and its absence would make silence
 * ambiguous: no email could mean nothing to do, or could mean the cron died.
 */
export async function runBlockerEmail(opts: { force?: boolean } = {}): Promise<BlockerEmailResult> {
  const { sendOwnerEmail } = await import('~/lib/owner-alerts.server')
  const { kvSetNX, kvDel } = await import('~/lib/kv.server')

  // Read the valve straight from pipeline_settings rather than through
  // getValve(), whose key type is the fixed VALVE_KEYS union. Fail OPEN: if the
  // settings read errors we still send, because the failure mode of this
  // particular email is "the owner never learns he is blocking something".
  if (!opts.force) {
    const off = await settingIs('blocker_email_enabled', 'false').catch(() => false)
    if (off === true) return { sent: false, skipped: 'blocker_email_enabled is off' }
  }

  const day = new Date().toISOString().slice(0, 10)
  if (!opts.force) {
    const first = await kvSetNX(`blocker-email:sent:${day}`, String(Date.now()), 26 * 3600)
    if (!first) return { sent: false, skipped: 'already sent today (pass force=1 to re-send)' }
  }

  const verified = await verifyBlockers()
  const open = await listOpenBlockers()
  const cleared = await listRecentlyCleared()
  const baseUrl = process.env['BASE_URL'] ?? 'https://xdipx.com'

  const subject = blockerEmailSubject(open)
  const html = renderBlockerEmail(open, cleared, baseUrl)
  const res = await sendOwnerEmail(subject, html, { fromName: 'xdipx blockers' })

  if (res.sent) {
    return { sent: true, subject, open: open.length, autoCleared: verified.autoCleared.length }
  }

  // Give the day slot back and fail loudly, same contract as the digest: a
  // list that silently did not send is the exact failure class it exists to catch.
  if (!opts.force) await kvDel(`blocker-email:sent:${day}`)
  throw new Error(`blocker email send failed: ${res.error ?? 'unknown error'}`)
}
