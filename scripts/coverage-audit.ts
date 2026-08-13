/**
 * Coverage audit runner: finds automation with no watcher, and routes each gap
 * to whoever can fix it.
 *
 *   npx tsx scripts/coverage-audit.ts              # static checks, report only
 *   DATABASE_URL=<prod> npx tsx scripts/coverage-audit.ts    # + DB checks
 *   DATABASE_URL=<prod> npx tsx scripts/coverage-audit.ts --file   # + file them
 *   npx tsx scripts/coverage-audit.ts --json       # machine-readable
 *
 * The static half (manifest, cadences, cron parity, playbook paths) needs only
 * the repo checkout, so it runs anywhere. The DB half (observed lanes, team
 * caps, probe coverage) is skipped with a note when DATABASE_URL is unset,
 * rather than failing: a partial audit that says which part it skipped is
 * useful, and a hard failure would just mean nobody runs it.
 *
 * --file routes findings by the same line the blocker list uses: work an agent
 * can do becomes a ticket on the improvement bus, work only the owner can do
 * becomes a blocker. Both dedupe on a stable key, so running this daily files
 * nothing new until something actually changes.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  auditCronParity,
  auditObservedLanes,
  auditPlaybooks,
  auditProbeCoverage,
  auditRoutineCoverage,
  auditTeamCaps,
  auditTriggerCoverage,
  extractPath,
  parseCadences,
  parseCronRoutes,
  parseManifestRoutines,
  parseManifestTriggers,
  parseVercelCrons,
  renderReport,
  sortFindings,
  summarize,
  type CoverageFinding,
} from '../app/lib/coverage-audit'

const ROOT = resolve(import.meta.dirname, '..')
const FILE_IT = process.argv.includes('--file')
const AS_JSON = process.argv.includes('--json')

const MANIFEST = 'docs/store-team/routine-schedule.md'
const JANITOR = 'app/lib/ticket-janitor.server.ts'

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

function log(...args: unknown[]) {
  if (!AS_JSON) console.log(...args)
}

/* ── Static checks ─────────────────────────────────────────────────────────── */

function staticFindings(): CoverageFinding[] {
  const manifestMd = read(MANIFEST)
  const janitorTs = read(JANITOR)

  const routines = parseManifestRoutines(manifestMd)
  const triggers = parseManifestTriggers(manifestMd)
  const cadences = parseCadences(janitorTs)

  // A parser that silently returns nothing would report the entire fleet as
  // uncovered, which is worse than not running. Fail loudly instead.
  if (cadences.length === 0) throw new Error(`parseCadences found no entries in ${JANITOR} — the format changed, fix the parser`)
  if (routines.length === 0) throw new Error(`parseManifestRoutines found no rows in ${MANIFEST} — the table shape changed, fix the parser`)
  if (triggers.length === 0) throw new Error(`parseManifestTriggers found no rows in ${MANIFEST} — the table shape changed, fix the parser`)

  log(`Parsed ${routines.length} manifest routines, ${triggers.length} trigger rows, ${cadences.length} cadence entries.`)

  const paths = new Set<string>()
  for (const r of routines) {
    const p = extractPath(r.playbook)
    if (p && existsSync(resolve(ROOT, p))) paths.add(p)
  }

  const cronTs = read('server/cron.ts')
  const routes = parseCronRoutes(cronTs)

  return [
    ...auditRoutineCoverage(routines, triggers, cadences),
    ...auditTriggerCoverage(triggers),
    ...auditCronParity(routes, parseVercelCrons(read('vercel.json')), invokedCronPaths(routes)),
    ...auditPlaybooks(routines, paths),
  ]
}

/**
 * Which /cron paths something in the repo calls directly. `git grep` over the
 * source, excluding server/cron.ts itself (where every path appears by
 * definition) and this script. A route with a caller is an on-demand endpoint,
 * not a missed schedule.
 */
function invokedCronPaths(routes: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const r of routes) {
    try {
      const hits = execFileSync(
        'git',
        ['grep', '-l', '--fixed-strings', r, '--', 'app', 'server', 'scripts', 'db'],
        { cwd: ROOT, encoding: 'utf8' },
      )
        .split('\n')
        .filter(f => f && f !== 'server/cron.ts' && f !== 'scripts/coverage-audit.ts')
      if (hits.length > 0) out.add(r)
    } catch {
      // git grep exits 1 on no match, which is the common case.
    }
  }
  return out
}

/* ── DB checks ─────────────────────────────────────────────────────────────── */

async function dbFindings(): Promise<CoverageFinding[]> {
  const { db } = await import('../app/lib/db.server')
  const { sql } = await import('drizzle-orm')
  const cadences = parseCadences(read(JANITOR))

  const lanes = await db.execute(sql`
    SELECT team, run_type, COUNT(*)::int AS runs
      FROM homepage_team_runs
     WHERE started_at >= now() - interval '30 days'
     GROUP BY team, run_type
     ORDER BY runs DESC`)
  const observed = (lanes.rows ?? []).map(r => {
    const row = r as Record<string, unknown>
    return {
      team: row['team'] == null ? null : String(row['team']),
      runType: String(row['run_type'] ?? ''),
      runs: Number(row['runs'] ?? 0),
    }
  })

  const settings = await db.execute(sql`SELECT key, value FROM pipeline_settings`)
  const rows = (settings.rows ?? []) as Array<Record<string, unknown>>
  const present = new Set(rows.map(r => String(r['key'] ?? '')))
  const enabledTeams = rows
    .filter(r => /_team_enabled$/.test(String(r['key'] ?? '')) && String(r['value'] ?? '') === 'true')
    .map(r => String(r['key']).replace(/_team_enabled$/, ''))

  log(`Observed ${observed.length} active lanes, ${present.size} settings rows, ${enabledTeams.length} enabled teams.`)

  // The blocker table may not exist yet (migration 078 unapplied), which is a
  // normal state, not an audit failure.
  let openBlockers: Array<{ verifyProbe: string | null }> = []
  try {
    const b = await db.execute(sql`SELECT verify_probe FROM owner_blockers WHERE status = 'open'`)
    openBlockers = (b.rows ?? []).map(r => ({
      verifyProbe: (r as Record<string, unknown>)['verify_probe'] == null
        ? null
        : String((r as Record<string, unknown>)['verify_probe']),
    }))
  } catch {
    log('owner_blockers not readable (migration 078 not applied?) — skipping probe coverage.')
  }

  return [
    ...auditObservedLanes(observed, cadences),
    ...auditTeamCaps(enabledTeams, present),
    ...auditProbeCoverage(openBlockers),
  ]
}

/* ── Filing ────────────────────────────────────────────────────────────────── */

async function file(findings: readonly CoverageFinding[]) {
  const base = process.env['BASE_URL'] ?? 'https://xdipx.com'
  const token = process.env['TEAM_TOKEN'] ?? process.env['HOMEPAGE_TEAM_TOKEN'] ?? process.env['CRON_SECRET']
  if (!token) {
    console.error('--file needs TEAM_TOKEN (or HOMEPAGE_TEAM_TOKEN / CRON_SECRET) in the environment.')
    process.exitCode = 1
    return
  }

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-team-secret': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300))
    return res.json().catch(() => ({}))
  }

  for (const f of sortFindings(findings)) {
    try {
      if (f.route === 'blocker') {
        await post('/api/team/blocker', {
          op: 'file',
          dedupeKey: f.key,
          title: f.title,
          detail: f.detail,
          unblocks: 'Closes a hole where an automation failure would go unnoticed.',
          whereToGo: f.remedy,
          category: f.check === 'trigger-coverage' ? 'console' : 'execute',
          priority: f.severity === 'high' ? 2 : 3,
          source: 'sweep',
          sourceRef: `coverage-audit/${f.check}`,
          evidence: f.detail,
        })
        log(`  blocker  ${f.key}`)
      } else {
        await post('/api/team/suggestion', {
          op: 'create',
          kind: 'code',
          team: 'strategy',
          priority: f.severity === 'high' ? 2 : 3,
          dedupeKey: f.key,
          suggestion: `${f.title}. ${f.detail} DONE WHEN: ${f.remedy}`,
        })
        log(`  ticket   ${f.key}`)
      }
    } catch (err) {
      console.error(`  FAILED   ${f.key}: ${String(err).slice(0, 200)}`)
      process.exitCode = 1
    }
  }
}

/* ── Main ──────────────────────────────────────────────────────────────────── */

async function main() {
  const findings = [...staticFindings()]

  if (process.env['DATABASE_URL']) {
    findings.push(...(await dbFindings()))
  } else {
    log('\nDATABASE_URL unset — skipped the DB checks (observed lanes, team caps, probe coverage).')
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ summary: summarize(findings), findings: sortFindings(findings) }, null, 2))
  } else {
    console.log('\n' + renderReport(findings))
  }

  if (FILE_IT && findings.length > 0) {
    log('Filing…')
    await file(findings)
  } else if (FILE_IT) {
    log('Nothing to file.')
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(err => {
  console.error(err)
  process.exit(1)
})
