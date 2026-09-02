import { beforeEach, describe, expect, it, vi } from 'vitest'

/* ---------------------------------------------------------------- fixtures */

/** Rows returned for `SELECT * FROM "<table>"`, keyed by table. */
let tableRows: Record<string, unknown[]> = {}
/** Tables the fake database reports as live. */
let liveTables: string[] = []
/** Tables whose read throws, to exercise the one-bad-table path. */
let unreadable = new Set<string>()

let blobStore: Map<string, Buffer>
let blobOn = true
let ledger: Array<Record<string, unknown>> = []
let latestDump: Record<string, unknown> | null = null

vi.mock('~/lib/db.server', () => ({
  db: {
    execute: async (q: unknown) => {
      // Drizzle's `sql` template nests: a tagged template holds StringChunks
      // (whose `value` is a string ARRAY) and, for `sql.raw(...)`, another SQL
      // object with its own chunks. Flattening only one level reads every
      // query as the empty string, which silently makes this whole mock
      // return zero rows for everything — the exact shape of the bug that
      // `db.execute(...).rows` already caused once in the module under test.
      const flatten = (node: unknown): string => {
        if (node == null) return ''
        if (typeof node === 'string') return node
        if (Array.isArray(node)) return node.map(flatten).join('')
        const o = node as { queryChunks?: unknown; value?: unknown }
        if (o.queryChunks !== undefined) return flatten(o.queryChunks)
        if (o.value !== undefined) return flatten(o.value)
        return ''
      }
      const text = flatten(q)
      if (text.includes('pg_class')) return { rows: liveTables.map(t => ({ t })) }
      const m = /"([a-z_]+)"/.exec(text)
      const table = m?.[1] ?? ''
      if (unreadable.has(table)) throw new Error(`permission denied for table ${table}`)
      return { rows: tableRows[table] ?? [] }
    },
    insert: () => ({ values: async (v: Record<string, unknown>) => { ledger.push(v) } }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => (latestDump ? [latestDump] : []) }),
        }),
        orderBy: () => ({ limit: async () => (latestDump ? [latestDump] : []) }),
      }),
    }),
  },
}))

vi.mock('~/lib/blob.server', () => ({
  blobConfigured: () => blobOn,
  blobPutPrivate: async (pathname: string, data: Buffer) => {
    blobStore.set(pathname, data)
    return { url: `https://blob.test/${pathname}`, pathname }
  },
  blobGetPrivate: async (pathname: string) => {
    const b = blobStore.get(pathname)
    if (!b) throw new Error(`blob not found: ${pathname}`)
    return b
  },
  blobListPrivate: async () => [],
  blobDelPrivate: async () => undefined,
}))

const {
  runBackup, runRestoreProbe, dumpTable, detectRowDrift, snapshotKeyFor,
  MANIFEST_FILE, STALE_HOURS,
} = await import('~/lib/db-backup.server')
const { criticalTables } = await import('~/lib/backup-manifest')

beforeEach(() => {
  blobStore = new Map()
  blobOn = true
  ledger = []
  latestDump = null
  unreadable = new Set()
  liveTables = [...criticalTables()]
  tableRows = Object.fromEntries(criticalTables().map(t => [t, [{ id: 1, table: t }]]))
})

/* -------------------------------------------------------------------- dump */

describe('the dump', () => {
  it('writes one object per critical table plus a manifest', async () => {
    const r = await runBackup(new Date('2026-09-02T04:40:00Z'))
    expect(r.status).toBe('succeeded')
    expect(r.snapshotKey).toBe('db-backup/2026-09-02')
    expect(blobStore.has(`db-backup/2026-09-02/${MANIFEST_FILE}`)).toBe(true)
    expect(blobStore.size).toBe(criticalTables().length + 1)
  })

  it('declines rather than fails when there is nowhere to write', async () => {
    // Reading "no blob token" as a failure would make the alarm red on day one
    // and trained away by day three, which is how the "enrich stage may be
    // stalled" line came to warn every day for six weeks against a dead table.
    blobOn = false
    const r = await runBackup()
    expect(r.status).toBe('skipped')
    expect(ledger.at(-1)?.['status']).toBe('skipped')
  })

  it('fails the whole run when one table cannot be read', async () => {
    // A snapshot missing a table it claims to hold is worse than no snapshot,
    // because it is trusted.
    unreadable.add('consent_log')
    const r = await runBackup()
    expect(r.status).toBe('failed')
    expect(r.error).toContain('consent_log')
    expect(blobStore.has(`${r.snapshotKey}/${MANIFEST_FILE}`)).toBe(false)
  })

  it('reports a table it has never heard of', async () => {
    liveTables = [...liveTables, 'loyalty_ledger']
    const r = await runBackup()
    expect(r.unclassified).toEqual(['loyalty_ledger'])
    // and it does not stop the dump: an unbacked-up table is a thing to fix,
    // not a reason to have no backup tonight.
    expect(r.status).toBe('succeeded')
  })

  it('records the run either way', async () => {
    await runBackup()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.['kind']).toBe('dump')
    expect(ledger[0]?.['finishedAt']).toBeInstanceOf(Date)
  })

  it('refuses a table name that is not a plain identifier', async () => {
    await expect(dumpTable('users"; DROP TABLE orders; --')).rejects.toThrow(/identifier/)
  })

  it('serialises rows as newline-delimited JSON', async () => {
    tableRows['returns'] = [{ id: 1 }, { id: 2 }, { id: 3 }]
    await runBackup(new Date('2026-09-02T04:40:00Z'))
    const { gunzipSync } = await import('node:zlib')
    const text = gunzipSync(blobStore.get('db-backup/2026-09-02/returns.ndjson.gz')!).toString()
    expect(text.split('\n')).toHaveLength(3)
    expect(JSON.parse(text.split('\n')[0]!)).toEqual({ id: 1 })
  })
})

/* ------------------------------------------------------------------- probe */

describe('the restore probe', () => {
  async function dumpThenProbe(mutate?: () => void) {
    const at = new Date('2026-09-02T04:40:00Z')
    const r = await runBackup(at)
    latestDump = { status: 'succeeded', snapshotKey: r.snapshotKey, startedAt: at.toISOString() }
    mutate?.()
    return runRestoreProbe(new Date('2026-09-02T06:10:00Z'))
  }

  it('passes on a dump it can read back', async () => {
    const p = await dumpThenProbe()
    expect(p.status).toBe('succeeded')
    expect(p.failures).toBe(0)
    expect(p.verdicts.length).toBeGreaterThan(0)
  })

  it('catches a table whose bytes went missing', async () => {
    const p = await dumpThenProbe(() => { blobStore.delete('db-backup/2026-09-02/voicemails.ndjson.gz') })
    expect(p.status).toBe('failed')
    expect(p.verdicts.find(v => v.table === 'voicemails')?.ok).toBe(false)
  })

  it('catches a truncated gzip rather than reading its valid prefix as a whole table', async () => {
    // This is the failure the probe exists for. A truncated gzip decompresses
    // to a valid prefix and its last line is half a JSON object, so counting
    // bytes would pass and parsing the ends does not.
    const p = await dumpThenProbe(() => {
      const { gzipSync } = require('node:zlib') as typeof import('node:zlib')
      blobStore.set('db-backup/2026-09-02/returns.ndjson.gz', gzipSync(Buffer.from('{"id":1}\n{"id":2', 'utf8')))
    })
    expect(p.status).toBe('failed')
    expect(p.verdicts.find(v => v.table === 'returns')?.ok).toBe(false)
  })

  it('will not grade a snapshot the dump did not finish', async () => {
    latestDump = { status: 'partial', snapshotKey: 'db-backup/2026-09-02', startedAt: new Date().toISOString() }
    const p = await runRestoreProbe()
    expect(p.status).toBe('failed')
    expect(p.error).toContain('partial')
  })

  it('says so when no dump has ever run', async () => {
    latestDump = null
    const p = await runRestoreProbe()
    expect(p.status).toBe('failed')
    expect(p.error).toContain('no dump has ever been recorded')
  })

  it('fails a readable dump that has gone stale', async () => {
    // "The bytes are fine" and "the bytes are current" are different questions.
    // A dump that stopped being taken a week ago reads back perfectly.
    const at = new Date('2026-09-02T04:40:00Z')
    const r = await runBackup(at)
    latestDump = { status: 'succeeded', snapshotKey: r.snapshotKey, startedAt: at.toISOString() }
    const p = await runRestoreProbe(new Date(at.getTime() + (STALE_HOURS + 1) * 3_600_000))
    expect(p.stale).toBe(true)
    expect(p.status).toBe('failed')
    expect(p.failures).toBe(0)   // nothing is wrong with the bytes; it is the age
  })
})

/* ------------------------------------------------------------------- drift */

describe('row drift', () => {
  const t = (table: string, rows: number) => ({ table, rows, bytes: 0 })

  it('reports a table that lost rows', () => {
    const d = detectRowDrift([t('homepage_team_suggestions', 1594)], [t('homepage_team_suggestions', 794)])
    expect(d).toEqual([{ table: 'homepage_team_suggestions', previousRows: 1594, currentRows: 794, delta: -800 }])
  })

  it('says nothing about growth', () => {
    // Every table here grows every day. A threshold on growth fires constantly
    // and is trained away, and then it is not there for the day that matters.
    expect(detectRowDrift([t('sms_turns', 900)], [t('sms_turns', 907)])).toEqual([])
  })

  it('says nothing about a table that is new since the last dump', () => {
    expect(detectRowDrift([], [t('loyalty_ledger', 5)])).toEqual([])
  })

  it('puts the worst loss first', () => {
    const d = detectRowDrift(
      [t('a', 100), t('b', 100), t('c', 100)],
      [t('a', 99), t('b', 10), t('c', 60)],
    )
    expect(d.map(x => x.table)).toEqual(['b', 'c', 'a'])
  })
})

describe('snapshot keys', () => {
  it('is one snapshot per UTC day, so a re-run replaces rather than accumulates', () => {
    expect(snapshotKeyFor(new Date('2026-09-02T04:40:00Z'))).toBe('db-backup/2026-09-02')
    expect(snapshotKeyFor(new Date('2026-09-02T23:59:00Z'))).toBe('db-backup/2026-09-02')
  })
})
