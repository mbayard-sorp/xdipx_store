/**
 * Runtime parser for the program-manager trackers in
 * docs/store-team/trackers/*.md. Same runtime-read pattern as
 * emma-voice.server.ts (docs/** ships in the serverless bundle via
 * vercel.json includeFiles), so the admin page and owner digest always
 * reflect exactly what is on the deployed commit with no build step, no DB
 * table, and no sync job.
 *
 * The tracker row format is fixed by docs/store-team/trackers/README.md:
 * | id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The server bundle is ESM: __dirname does not exist and referencing it at
// module scope crashes every invocation at import time (took prod down on
// 2026-07-21). Same shim as emma-voice.server.ts.
const __dirname = dirname(fileURLToPath(import.meta.url))

export type Rag = 'GREEN' | 'AMBER' | 'RED' | 'UNKNOWN'

export interface TrackerMilestone {
  id: string
  milestone: string
  phase: string
  owner: string
  targetWeek: string
  status: string
  rag: Rag
  evidenceProbe: string
  lastVerified: string
  notes: string
}

export interface TrackerLogEntry {
  /** The "### ..." heading, date first by convention. */
  heading: string
  /** Raw markdown body of the entry. */
  body: string
}

export interface Tracker {
  /** File name without extension, e.g. "automation-audit-roadmap". */
  slug: string
  /** First "# " heading line. */
  title: string
  program: string
  overall: Rag
  started: string
  targetEnd: string
  milestones: TrackerMilestone[]
  statusLog: TrackerLogEntry[]
}

const DIR_CANDIDATES = [
  resolve(process.cwd(), 'docs/store-team/trackers'),
  resolve(__dirname, '../../docs/store-team/trackers'),
  resolve(__dirname, '../docs/store-team/trackers'),
]

function trackersDir(): string | null {
  for (const dir of DIR_CANDIDATES) {
    if (existsSync(dir)) return dir
  }
  return null
}

function parseRag(v: string): Rag {
  const up = v.trim().toUpperCase()
  return up === 'GREEN' || up === 'AMBER' || up === 'RED' ? up : 'UNKNOWN'
}

function matchLine(md: string, re: RegExp): string {
  const m = md.match(re)
  return m?.[1]?.trim() ?? ''
}

function parseMilestones(md: string): TrackerMilestone[] {
  const rows: TrackerMilestone[] = []
  for (const line of md.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 10) continue
    if (cells[0] === 'id') continue                       // header row
    if (cells.every(c => /^:?-+:?$/.test(c))) continue    // separator row
    rows.push({
      id:            cells[0]!,
      milestone:     cells[1]!,
      phase:         cells[2]!,
      owner:         cells[3]!,
      targetWeek:    cells[4]!,
      status:        cells[5]!,
      rag:           parseRag(cells[6]!),
      evidenceProbe: cells[7]!,
      lastVerified:  cells[8]!,
      notes:         cells[9]!,
    })
  }
  return rows
}

function parseStatusLog(md: string): TrackerLogEntry[] {
  const idx = md.indexOf('## Status log')
  if (idx === -1) return []
  const section = md.slice(idx + '## Status log'.length)
  const entries: TrackerLogEntry[] = []
  const parts = section.split(/^### /m).slice(1)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim()
    const body = (nl === -1 ? '' : part.slice(nl + 1)).trim()
    entries.push({ heading, body })
  }
  return entries
}

function parseTracker(slug: string, md: string): Tracker {
  return {
    slug,
    title:     matchLine(md, /^#\s+(.+)$/m),
    program:   matchLine(md, /^Program:\s*(.+)$/m),
    overall:   parseRag(matchLine(md, /^Overall:\s*(\S+)/m)),
    started:   matchLine(md, /Started:\s*([0-9-]+)/),
    targetEnd: matchLine(md, /Target end:\s*([0-9-]+)/),
    milestones: parseMilestones(md),
    statusLog:  parseStatusLog(md),
  }
}

/**
 * Parse every tracker file. Returns [] when the directory is missing (e.g. a
 * stripped deploy), never throws: tracker visibility must not take down the
 * admin shell or the digest.
 */
export function getTrackers(): Tracker[] {
  const dir = trackersDir()
  if (!dir) return []
  const out: Tracker[] = []
  let files: string[] = []
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')
  } catch {
    return []
  }
  for (const file of files.sort()) {
    try {
      out.push(parseTracker(file.replace(/\.md$/, ''), readFileSync(resolve(dir, file), 'utf-8')))
    } catch (err) {
      console.warn(`[tracker] failed to parse ${file}:`, err)
    }
  }
  return out
}

/**
 * The lines the program-manager writes for the owner in the latest status-log
 * entry ("Asks for the owner" paragraph), for surfacing in the daily digest.
 */
export function latestOwnerAsks(tracker: Tracker): string | null {
  const latest = tracker.statusLog[0]
  if (!latest) return null
  const m = latest.body.match(/\*\*Asks for the owner:?\*\*:?\s*([\s\S]*?)(?:\n\n|$)/)
  return m?.[1]?.trim() ?? null
}
