/**
 * chunk-audience-briefs.ts
 *
 * Reads audience-proposal-briefs.json and splits the briefs that need a
 * Claude pass (deterministic.needsClaude === true) into chunk files for
 * parallel subagent dispatch. Briefs fully covered by deterministic rules
 * are skipped — they don't need a subagent.
 *
 * Each chunk includes the canonical vocab inline so each subagent gets a
 * self-contained payload.
 *
 * Output: audience-proposal-briefs.chunk-NN.json (numbered from 01)
 *
 * Usage:
 *   npx tsx scripts/chunk-audience-briefs.ts                    # default size 75
 *   npx tsx scripts/chunk-audience-briefs.ts --size=50          # custom
 *   npx tsx scripts/chunk-audience-briefs.ts --include-all      # include deterministic too
 */

import fs from 'node:fs'
import path from 'node:path'

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=')[1] : undefined
}

const SIZE = Number(argOf('--size') ?? 75)
const INCLUDE_ALL = process.argv.includes('--include-all')
const INPUT  = argOf('--input')  ?? 'audience-proposal-briefs.json'
const PREFIX = argOf('--prefix') ?? 'audience-proposal-briefs'

const cwd = process.cwd()
const inputPath = path.join(cwd, INPUT)

if (!fs.existsSync(inputPath)) {
  console.error(`ERROR: ${inputPath} not found. Run build-audience-briefs.ts first.`)
  process.exit(1)
}

// Clean stale chunks (this prefix only).
const briefChunkRe = new RegExp(`^${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.chunk-\\d+\\.json$`)
const proposalPrefix = PREFIX.replace(/-briefs$/, '-proposals')
const proposalChunkRe = new RegExp(`^${proposalPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.chunk-\\d+\\.json$`)
for (const f of fs.readdirSync(cwd)) {
  if (briefChunkRe.test(f) || proposalChunkRe.test(f)) fs.unlinkSync(path.join(cwd, f))
}

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as {
  vocab:  Record<string, string[]>
  briefs: Array<{ deterministic: { needsClaude: boolean } } & Record<string, unknown>>
}

const candidates = INCLUDE_ALL
  ? data.briefs
  : data.briefs.filter(b => b.deterministic.needsClaude)

if (candidates.length === 0) {
  console.log('No briefs need a Claude pass — every product was covered by deterministic rules.')
  console.log('(If you want chunks for all briefs anyway, pass --include-all)')
  process.exit(0)
}

const chunks = Math.ceil(candidates.length / SIZE)
const pad = (n: number) => String(n).padStart(2, '0')

for (let i = 0; i < chunks; i++) {
  const slice = candidates.slice(i * SIZE, (i + 1) * SIZE)
  const out = { vocab: data.vocab, briefs: slice }
  const outPath = path.join(cwd, `${PREFIX}.chunk-${pad(i + 1)}.json`)
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`  chunk ${pad(i + 1)}: ${slice.length} briefs → ${path.basename(outPath)}`)
}

console.log(`\nWrote ${chunks} chunks of ~${SIZE} briefs (total ${candidates.length}${INCLUDE_ALL ? '' : ` needs-Claude of ${data.briefs.length} total`}).`)
console.log(`Dispatch each chunk to a general-purpose subagent (Max subscription — zero API spend).`)
