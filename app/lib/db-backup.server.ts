/**
 * The nightly dump, and the probe that proves it can be read back.
 *
 * ## Why this exists
 *
 * Stage G1 of the 2026-09-01 automation audit response was the only line marked
 * RED with nothing at all behind it. A grep of the whole repository for
 * `pg_dump`, Neon branching, PITR or any restore policy returned zero hits
 * outside prose in two earlier audits. Meanwhile Stages B, C, D and E each
 * increased the number of writes this system makes to this database with no
 * human in the loop. A system that manages itself but cannot be restored is not
 * self-sufficient; it is one bad migration from unrecoverable.
 *
 * ## The two paths, and which one this is
 *
 * Neon point-in-time restore is the primary path and needs no code: it rewinds
 * the whole database to a timestamp inside the history-retention window. Its two
 * limits are why this file exists anyway.
 *
 *   1. It rewinds EVERYTHING. This database is shared — 19 `public` tables
 *      belong to a dormant video-studio application — so a PITR to undo an
 *      xdipx mistake also rewinds that. And it cannot undo one table without
 *      undoing every other write made since.
 *   2. The retention window is a Neon plan setting nothing in this repo can
 *      read, so its length is currently an assumption. See the runbook.
 *
 * This file is the surgical alternative: a per-table logical snapshot that can
 * restore one clobbered table without touching anything else, and that survives
 * the Neon account entirely.
 *
 * ## Private, and not negotiable
 *
 * The critical tier contains consent records, SMS and voicemail transcripts,
 * order lines and every conversation a customer has had with Emma. It is
 * written with `access: 'private'` through `blobPutPrivate`, never the public
 * `blobPut`. A random URL suffix is obscurity, not access control.
 *
 * ## A partial dump is a failure, not a smaller success
 *
 * Both budgets below exist because a 300s lambda is SIGKILLed, not slowed, when
 * a table grows past what was measured. A run that hits either budget records
 * `partial`, names the table it stopped on, and writes NO manifest — so the
 * restore probe cannot grade an incomplete snapshot as a good one. A backup
 * that silently covers less than it claims is the same failure as a digest
 * printing GOOD over a dead pipeline, which this estate has already paid for.
 */

import { desc, eq, sql } from 'drizzle-orm'
import { gzipSync, gunzipSync } from 'node:zlib'

import { blobGetPrivate, blobListPrivate, blobPutPrivate, blobConfigured, blobDelPrivate } from '~/lib/blob.server'
import { db } from '~/lib/db.server'
import { isIdent } from '~/lib/owner-blockers-core'
import { criticalTables, unclassified } from '~/lib/backup-manifest'
import { backupRuns } from '../../db/schema'

const LOG = '[db-backup]'

/** Blob prefix. Everything this stage writes lives under it. */
export const SNAPSHOT_PREFIX = 'db-backup'

/** The file inside a snapshot that says what the snapshot contains. */
export const MANIFEST_FILE = '_manifest.json'

/**
 * Wall-clock budget. `maxDuration` is 300s; stopping at 210 leaves room to
 * serialise the last table, write the ledger row, and answer the request. The
 * measured cost of the whole critical tier on 2026-09-02 was 16 MB across
 * 17,137 rows, so this is roughly an order of magnitude of headroom rather than
 * a tight fit — which is the point, since the alarm should fire on a table that
 * grew unexpectedly, long before the platform kills the process.
 */
export const WALL_CLOCK_BUDGET_MS = 210_000

/** Byte budget on the compressed output, for the same reason. */
export const BYTE_BUDGET = 64 * 1024 * 1024

/** A nightly dump older than this has failed silently. */
export const STALE_HOURS = 36

/** How many nightly snapshots to keep. */
export const KEEP_SNAPSHOTS = 14

export interface TableDump {
  table: string
  rows: number
  bytes: number
}

export interface SnapshotManifest {
  snapshotKey: string
  takenAt: string
  tables: TableDump[]
  totalBytes: number
  /** Live tables this build of `backup-manifest.ts` had never heard of. */
  unclassified: string[]
}

export type BackupStatus = 'succeeded' | 'partial' | 'failed' | 'skipped'

export interface BackupResult {
  status: BackupStatus
  snapshotKey: string | null
  tables: TableDump[]
  totalBytes: number
  unclassified: string[]
  error: string | null
  elapsedMs: number
}

/* ------------------------------------------------------------------ reads */

/**
 * Every base table in the `public` schema.
 *
 * Scoped to `public` on purpose: `neon_auth` (9 tables) and `drizzle`
 * (`__drizzle_migrations`) are other systems' schemas, and treating their
 * contents as "unclassified xdipx tables" would make the alarm below permanent
 * and therefore worthless.
 */
export async function listLiveTables(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname = 'public'
     ORDER BY 1
  `)
  return ((res.rows ?? []) as Array<{ t: string }>).map(r => r.t)
}

/**
 * Serialise one table as gzipped NDJSON.
 *
 * NDJSON rather than SQL INSERTs: a restore of one table is a scripted
 * `INSERT ... ON CONFLICT` loop either way, and NDJSON can also be read by
 * anything, including a human with `zcat` and `jq`, at the moment when reading
 * it matters most.
 */
export async function dumpTable(table: string): Promise<{ rows: number; gz: Buffer }> {
  // The table name reaches SQL as an identifier, so it never comes from
  // anywhere but the manifest and is still checked. `isIdent` is the same guard
  // the blocker probes use for exactly this.
  if (!isIdent(table)) throw new Error(`refusing to dump a non-identifier table name: ${table}`)
  const res = await db.execute(sql`SELECT * FROM ${sql.raw(`"${table}"`)}`)
  const list = (res.rows ?? []) as unknown[]
  const body = list.map(r => JSON.stringify(r)).join('\n')
  return { rows: list.length, gz: gzipSync(Buffer.from(body, 'utf8')) }
}

/* ------------------------------------------------------------------ write */

/** `db-backup/2026-09-02` */
export function snapshotKeyFor(now: Date): string {
  return `${SNAPSHOT_PREFIX}/${now.toISOString().slice(0, 10)}`
}

export async function runBackup(now: Date = new Date()): Promise<BackupResult> {
  const startedAt = now
  const t0 = Date.now()
  const empty = {
    tables: [] as TableDump[],
    totalBytes: 0,
    unclassified: [] as string[],
    snapshotKey: null,
  }

  if (!blobConfigured()) {
    // Declining because there is nowhere to write is a real outcome, not a
    // failure: reading it as one would train the alarm away before the alarm
    // ever meant anything.
    const result: BackupResult = { ...empty, status: 'skipped', error: 'no blob token configured', elapsedMs: 0 }
    await record('dump', startedAt, result)
    return result
  }

  const snapshotKey = snapshotKeyFor(now)
  const tables: TableDump[] = []
  let totalBytes = 0
  let stoppedOn: string | null = null

  let live: string[] = []
  try {
    live = await listLiveTables()
  } catch (err) {
    const result: BackupResult = { ...empty, status: 'failed', error: `could not list tables: ${String(err)}`, elapsedMs: Date.now() - t0 }
    await record('dump', startedAt, result)
    return result
  }
  const unknown = unclassified(live)

  for (const table of criticalTables()) {
    if (Date.now() - t0 > WALL_CLOCK_BUDGET_MS) { stoppedOn = `${table} (wall clock)`; break }
    if (totalBytes > BYTE_BUDGET) { stoppedOn = `${table} (byte budget)`; break }
    try {
      const { rows, gz } = await dumpTable(table)
      await blobPutPrivate(`${snapshotKey}/${table}.ndjson.gz`, gz, { contentType: 'application/gzip' })
      tables.push({ table, rows, bytes: gz.byteLength })
      totalBytes += gz.byteLength
    } catch (err) {
      // One unreadable table fails the whole run. A snapshot missing a table it
      // claims to hold is worse than no snapshot, because it is trusted.
      const result: BackupResult = {
        status: 'failed', snapshotKey, tables, totalBytes, unclassified: unknown,
        error: `${table}: ${String(err)}`, elapsedMs: Date.now() - t0,
      }
      await record('dump', startedAt, result)
      return result
    }
  }

  if (stoppedOn) {
    // No manifest is written. The restore probe resolves a snapshot through its
    // manifest, so a partial run is unreadable to it by construction rather
    // than by a flag it might forget to check.
    const result: BackupResult = {
      status: 'partial', snapshotKey, tables, totalBytes, unclassified: unknown,
      error: `budget exhausted at ${stoppedOn} after ${tables.length}/${criticalTables().length} tables`,
      elapsedMs: Date.now() - t0,
    }
    await record('dump', startedAt, result)
    return result
  }

  const manifest: SnapshotManifest = {
    snapshotKey,
    takenAt: now.toISOString(),
    tables,
    totalBytes,
    unclassified: unknown,
  }
  try {
    await blobPutPrivate(
      `${snapshotKey}/${MANIFEST_FILE}`,
      Buffer.from(JSON.stringify(manifest, null, 1), 'utf8'),
      { contentType: 'application/json' },
    )
  } catch (err) {
    const result: BackupResult = {
      status: 'failed', snapshotKey, tables, totalBytes, unclassified: unknown,
      error: `manifest write failed: ${String(err)}`, elapsedMs: Date.now() - t0,
    }
    await record('dump', startedAt, result)
    return result
  }

  const result: BackupResult = {
    status: 'succeeded', snapshotKey, tables, totalBytes, unclassified: unknown,
    error: null, elapsedMs: Date.now() - t0,
  }
  await record('dump', startedAt, result)
  await pruneSnapshots()
  return result
}

/* ------------------------------------------------------------------ probe */

export interface TableVerdict {
  table: string
  expectedRows: number
  actualRows: number
  ok: boolean
  note?: string
}

export interface ProbeResult {
  status: BackupStatus
  snapshotKey: string | null
  ageHours: number | null
  stale: boolean
  verdicts: TableVerdict[]
  failures: number
  error: string | null
}

/**
 * Read the newest dump back and grade it.
 *
 * This is the half that makes the other half a backup. A dump nobody has read
 * back is a file, and the failure modes it hides are the expensive ones: an
 * empty table that serialised to zero bytes, a gzip that never finished, a
 * private object the token can no longer read. Every one of those produces a
 * `succeeded` dump row and an unusable snapshot.
 *
 * It reads through the ledger's `snapshot_key`, not by listing blobs, so it can
 * only ever grade a snapshot the dump itself claimed to finish.
 */
export async function runRestoreProbe(now: Date = new Date()): Promise<ProbeResult> {
  const startedAt = now
  const base: ProbeResult = {
    status: 'failed', snapshotKey: null, ageHours: null, stale: true,
    verdicts: [], failures: 0, error: null,
  }

  if (!blobConfigured()) {
    const result = { ...base, status: 'skipped' as BackupStatus, error: 'no blob token configured', stale: false }
    await recordProbe(startedAt, result)
    return result
  }

  const [latest] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.kind, 'dump'))
    .orderBy(desc(backupRuns.startedAt))
    .limit(1)

  if (!latest || latest.status !== 'succeeded' || !latest.snapshotKey) {
    const result = {
      ...base,
      error: latest
        ? `newest dump is ${latest.status}, not succeeded`
        : 'no dump has ever been recorded',
    }
    await recordProbe(startedAt, result)
    return result
  }

  const ageHours = (now.getTime() - new Date(latest.startedAt).getTime()) / 3_600_000
  const stale = ageHours > STALE_HOURS

  let manifest: SnapshotManifest
  try {
    const raw = await blobGetPrivate(`${latest.snapshotKey}/${MANIFEST_FILE}`)
    manifest = JSON.parse(raw.toString('utf8')) as SnapshotManifest
  } catch (err) {
    const result = { ...base, snapshotKey: latest.snapshotKey, ageHours, stale, error: `manifest unreadable: ${String(err)}` }
    await recordProbe(startedAt, result)
    return result
  }

  const verdicts: TableVerdict[] = []
  for (const t of manifest.tables) {
    try {
      const gz = await blobGetPrivate(`${latest.snapshotKey}/${t.table}.ndjson.gz`)
      const text = gunzipSync(gz).toString('utf8')
      const lines = text.length === 0 ? [] : text.split('\n')
      // Parsing the first and last line is the difference between "the bytes
      // are there" and "the bytes are rows". A truncated gzip decompresses to a
      // valid prefix, and its last line is half a JSON object.
      if (lines.length > 0) {
        JSON.parse(lines[0]!)
        JSON.parse(lines[lines.length - 1]!)
      }
      verdicts.push({
        table: t.table,
        expectedRows: t.rows,
        actualRows: lines.length,
        ok: lines.length === t.rows,
        ...(lines.length === t.rows ? {} : { note: 'row count does not match the manifest' }),
      })
    } catch (err) {
      verdicts.push({ table: t.table, expectedRows: t.rows, actualRows: -1, ok: false, note: String(err) })
    }
  }

  const failures = verdicts.filter(v => !v.ok).length
  const result: ProbeResult = {
    status: failures === 0 && !stale ? 'succeeded' : 'failed',
    snapshotKey: latest.snapshotKey,
    ageHours,
    stale,
    verdicts,
    failures,
    error: failures > 0
      ? `${failures} of ${verdicts.length} tables did not read back`
      : stale ? `newest good dump is ${ageHours.toFixed(1)}h old, floor is ${STALE_HOURS}h` : null,
  }
  await recordProbe(startedAt, result)
  return result
}

/* ------------------------------------------------------------------ drift */

export interface DriftFinding {
  table: string
  previousRows: number
  currentRows: number
  delta: number
}

/**
 * Tables that lost rows between two dumps.
 *
 * This is the cheap half of G1 and arguably the useful one. A point-in-time
 * restore only helps inside the retention window, so what actually decides
 * whether a mass-delete is recoverable is how fast anyone notices. Today
 * nothing would: an agent DML bug that emptied 800 suggestion rows would leave
 * no trace but the rows being gone.
 *
 * Only shrinkage is reported. Growth is the normal state of every table here,
 * and a threshold on growth would fire constantly and be trained away.
 */
export function detectRowDrift(
  previous: readonly TableDump[],
  current: readonly TableDump[],
  minDelta = 1,
): DriftFinding[] {
  const before = new Map(previous.map(t => [t.table, t.rows]))
  const out: DriftFinding[] = []
  for (const t of current) {
    const prev = before.get(t.table)
    if (prev === undefined) continue
    const delta = t.rows - prev
    if (delta <= -minDelta) {
      out.push({ table: t.table, previousRows: prev, currentRows: t.rows, delta })
    }
  }
  return out.sort((a, b) => a.delta - b.delta)
}

/** The row counts from the newest succeeded dump before `beforeId`. */
export async function previousDumpTables(beforeId: number): Promise<TableDump[]> {
  const rows = await db
    .select()
    .from(backupRuns)
    .where(sql`${backupRuns.kind} = 'dump' AND ${backupRuns.status} = 'succeeded' AND ${backupRuns.id} < ${beforeId}`)
    .orderBy(desc(backupRuns.id))
    .limit(1)
  const t = rows[0]?.tables
  return Array.isArray(t) ? (t as TableDump[]) : []
}

/* ------------------------------------------------------------- retention */

/**
 * Keep the newest `KEEP_SNAPSHOTS` days and delete the rest.
 *
 * Best-effort, and deliberately after the ledger row is written: a retention
 * sweep that throws must never turn a good dump into a failed one.
 */
export async function pruneSnapshots(keep = KEEP_SNAPSHOTS): Promise<number> {
  try {
    const all = await blobListPrivate(`${SNAPSHOT_PREFIX}/`)
    const days = [...new Set(all.map(b => b.pathname.split('/')[1]).filter((d): d is string => !!d))].sort().reverse()
    const doomed = new Set(days.slice(keep))
    if (doomed.size === 0) return 0
    const paths = all.filter(b => doomed.has(b.pathname.split('/')[1] ?? '')).map(b => b.pathname)
    await blobDelPrivate(paths)
    return paths.length
  } catch (err) {
    console.error(LOG, 'prune failed (ignored):', err)
    return 0
  }
}

/* --------------------------------------------------------------- ledger */

/**
 * Every write here swallows its own error, for the same reason `cron-runs`
 * does: a run that worked but could not write its row is a gap in the record,
 * not an incident, and bookkeeping must never manufacture a failure.
 */
async function record(kind: 'dump', startedAt: Date, r: BackupResult): Promise<void> {
  try {
    await db.insert(backupRuns).values({
      kind,
      startedAt,
      finishedAt: new Date(),
      status: r.status,
      snapshotKey: r.snapshotKey,
      tables: r.tables,
      totalBytes: r.totalBytes,
      error: r.error,
    })
  } catch (err) {
    console.error(LOG, 'ledger write failed (ignored):', err)
  }
}

async function recordProbe(startedAt: Date, r: ProbeResult): Promise<void> {
  try {
    await db.insert(backupRuns).values({
      kind: 'restore-probe',
      startedAt,
      finishedAt: new Date(),
      status: r.status,
      snapshotKey: r.snapshotKey,
      tables: r.verdicts.map(v => ({ table: v.table, rows: v.actualRows, bytes: 0 })),
      totalBytes: 0,
      error: r.error,
    })
  } catch (err) {
    console.error(LOG, 'probe ledger write failed (ignored):', err)
  }
}
