/**
 * merge-audience-chunks.ts
 *
 * Combines audience-proposals.chunk-NN.json (subagent output) into one
 * audience-proposals.json. Verifies coverage against the needs-Claude
 * subset of the briefs file and reports any missing IDs so the failed
 * chunks can be re-dispatched.
 *
 * Subagent output contract per chunk file:
 *   {
 *     "proposals": [
 *       {
 *         "id":               "gid://shopify/Product/...",
 *         "relationshipTags": ["solo" | "couples" | "long-distance"],
 *         "lifeEventTags":    ["gift" | "date-night" | ...] (optional),
 *         "lgbtqTags":        ["queer-friendly" | ...] (optional, affirmative-signal only),
 *         "rationale":        "one-sentence justification (≤200 chars)"
 *       }, ...
 *     ]
 *   }
 *
 * Usage:
 *   npx tsx scripts/merge-audience-chunks.ts
 *   npx tsx scripts/merge-audience-chunks.ts --prefix=audience-proposals
 */

import fs from 'node:fs'
import path from 'node:path'

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=')[1] : undefined
}

interface ChunkProposal {
  id:               string
  relationshipTags: string[]
  lifeEventTags?:   string[]
  lgbtqTags?:       string[]
  rationale:        string
}

const cwd = process.cwd()
const PREFIX = argOf('--prefix') ?? 'audience-proposals'
const escaped = PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const chunkRe = new RegExp(`^${escaped}\\.chunk-\\d+\\.json$`)

const chunkFiles = fs.readdirSync(cwd).filter(f => chunkRe.test(f)).sort()

if (chunkFiles.length === 0) {
  console.error(`ERROR: no ${PREFIX}.chunk-NN.json files found in ${cwd}.`)
  console.error(`Did the subagents finish writing output?`)
  process.exit(1)
}

const all: ChunkProposal[] = []
for (const f of chunkFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(cwd, f), 'utf8')) as { proposals: ChunkProposal[] }
  console.log(`  ${f}: ${data.proposals.length} proposals`)
  all.push(...data.proposals)
}

// Dedupe by id (keep first occurrence — chunks shouldn't overlap, but safe).
const seen = new Set<string>()
const deduped = all.filter(p => {
  if (seen.has(p.id)) return false
  seen.add(p.id)
  return true
})

const outPath = path.join(cwd, `${PREFIX}.json`)
fs.writeFileSync(outPath, JSON.stringify({ proposals: deduped }, null, 2))
console.log(`\nMerged ${deduped.length} unique proposals → ${path.basename(outPath)}`)
if (all.length !== deduped.length) {
  console.log(`  (deduped ${all.length - deduped.length} repeats)`)
}

// Coverage check vs the briefs file.
const briefsPath = path.join(cwd, 'audience-proposal-briefs.json')
if (fs.existsSync(briefsPath)) {
  const briefs = JSON.parse(fs.readFileSync(briefsPath, 'utf8')) as {
    briefs: Array<{ id: string; deterministic: { needsClaude: boolean } }>
  }
  const needIds = new Set(briefs.briefs.filter(b => b.deterministic.needsClaude).map(b => b.id))
  const propIds = new Set(deduped.map(p => p.id))
  const missing = [...needIds].filter(id => !propIds.has(id))
  const extra   = [...propIds].filter(id => !needIds.has(id) && !briefs.briefs.some(b => b.id === id))

  console.log()
  console.log(`Coverage: ${needIds.size - missing.length}/${needIds.size} needs-Claude briefs have proposals`)
  if (missing.length > 0) {
    console.log(`⚠ ${missing.length} briefs missing proposals — re-dispatch the relevant chunks:`)
    for (const id of missing.slice(0, 10)) console.log(`    ${id}`)
    if (missing.length > 10) console.log(`    ...and ${missing.length - 10} more`)
  } else {
    console.log(`✓ All needs-Claude briefs covered.`)
  }
  if (extra.length > 0) {
    console.log(`⚠ ${extra.length} proposals reference IDs not in the briefs file — investigate.`)
  }
}
