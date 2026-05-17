/**
 * chunk-matters-briefs.ts
 *
 * Reads matters-proposal-briefs.json and splits the briefs that need a
 * Claude pass (deterministic.needsClaude === true) into chunk files for
 * parallel subagent dispatch. Briefs fully covered by deterministic rules
 * are skipped -- they don't need a subagent.
 *
 * Each chunk includes the canonical vocab inline so each subagent gets a
 * self-contained payload.
 *
 * Output: matters-proposal-briefs.chunk-NN.json (numbered from 01)
 *
 * Usage:
 *   npx tsx scripts/chunk-matters-briefs.ts                    # default size 75
 *   npx tsx scripts/chunk-matters-briefs.ts --size=50          # custom
 *   npx tsx scripts/chunk-matters-briefs.ts --include-all      # include deterministic too
 *   npx tsx scripts/chunk-matters-briefs.ts --input=./out.json # custom input file
 *   npx tsx scripts/chunk-matters-briefs.ts --prefix=matters-proposal-briefs  # custom prefix
 */

import fs from 'node:fs'
import path from 'node:path'

const argOf = (flag: string): string | undefined => {
  const found = process.argv.find(a => a.startsWith(`${flag}=`))
  return found ? found.split('=').slice(1).join('=') : undefined
}

const SIZE        = Number(argOf('--size') ?? 75)
const INCLUDE_ALL = process.argv.includes('--include-all')
const INPUT       = argOf('--input')  ?? 'matters-proposal-briefs.json'
const PREFIX      = argOf('--prefix') ?? 'matters-proposal-briefs'

const cwd = process.cwd()
const inputPath = path.isAbsolute(INPUT) ? INPUT : path.join(cwd, INPUT)

if (!fs.existsSync(inputPath)) {
  console.error(`ERROR: ${inputPath} not found. Run build-matters-briefs.ts first.`)
  process.exit(1)
}

// Clean stale chunk files from a prior run (same prefix).
// Also clean any matching proposals chunk files (dispatch artifacts).
const briefChunkRe    = new RegExp(`^${PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.chunk-\\d+\\.json$`)
const proposalPrefix  = PREFIX.replace(/-briefs$/, '-proposals')
const proposalChunkRe = new RegExp(`^${proposalPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.chunk-\\d+\\.json$`)
const cleanDir        = path.dirname(inputPath)
for (const f of fs.readdirSync(cleanDir)) {
  if (briefChunkRe.test(f) || proposalChunkRe.test(f)) {
    fs.unlinkSync(path.join(cleanDir, f))
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RuleHit {
  rule:       string
  tags:       string[]
  confidence: number
  evidence?:  string
}

interface DeterministicResult {
  finalMatters: string[]
  hits:         RuleHit[]
  needsClaude:  boolean
}

interface MattersProductBrief {
  shopifyProductId:  string
  handle:            string
  title:             string
  productType:       string | null
  vendor:            string
  tags:              string[]
  bodyExcerpt:       string
  nalpacDescription: string
  currentMatters:    string[]
  currentAudience:   string[]
  parsedMaterials:   string[]
  specBooleans: {
    waterproof:      boolean | null
    rechargeable:    boolean | null
    detachableParts: boolean | null
    nonElectric:     boolean | null
  }
  lengthIn:      number | null
  deterministic: DeterministicResult
  // top-level fields from the source file that may be present
  generatedAt?:  string
  totals?:       unknown
}

interface BriefsFile {
  vocab:       string[]
  briefs:      MattersProductBrief[]
  generatedAt?: string
  totals?:      unknown
}

// ── Load ─────────────────────────────────────────────────────────────────────

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as BriefsFile

const totalBriefs = data.briefs.length

const candidates = INCLUDE_ALL
  ? data.briefs
  : data.briefs.filter(b => b.deterministic.needsClaude)

if (candidates.length === 0) {
  console.log('No briefs need a Claude pass -- every product was covered by deterministic rules.')
  console.log('(If you want chunks for all briefs anyway, pass --include-all)')
  process.exit(0)
}

// ── Chunk ─────────────────────────────────────────────────────────────────────

const totalChunks = Math.ceil(candidates.length / SIZE)
const pad = (n: number) => String(n).padStart(2, '0')

console.log(`Found ${totalBriefs} briefs total (${candidates.length} with needsClaude=${INCLUDE_ALL ? 'any (--include-all)' : 'true'})`)
console.log(`Chunking ${candidates.length} briefs into ${totalChunks} chunk${totalChunks !== 1 ? 's' : ''} of size ${SIZE}`)
console.log()

const writtenFiles: string[] = []

for (let i = 0; i < totalChunks; i++) {
  const slice = candidates.slice(i * SIZE, (i + 1) * SIZE)

  // Strip top-level metadata fields that the subagent doesn't need.
  // Each brief retains all fields the subagent needs for classification.
  const strippedBriefs = slice.map(b => {
    // Destructure to drop generatedAt/totals if they somehow ended up on brief entries
    const { ...brief } = b as MattersProductBrief & { generatedAt?: unknown; totals?: unknown }
    delete (brief as { generatedAt?: unknown }).generatedAt
    delete (brief as { totals?: unknown }).totals
    return brief
  })

  const chunkMeta = {
    chunkNumber:  i + 1,
    totalChunks,
    productCount: slice.length,
  }

  const out = {
    vocab:     data.vocab,
    chunkMeta,
    briefs:    strippedBriefs,
  }

  const filename = `${PREFIX}.chunk-${pad(i + 1)}.json`
  const outPath  = path.join(cleanDir, filename)
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  writtenFiles.push(filename)

  const partial = i === totalChunks - 1 && slice.length < SIZE ? '  [partial]' : ''
  console.log(`Wrote ${filename} (${slice.length} products)${partial}`)
}

// ── Summary ───────────────────────────────────────────────────────────────────

const dispatchOrder = writtenFiles
  .map(f => f.replace(`${PREFIX}.`, '').replace('.json', ''))
  .join(' → ')

console.log()
console.log(`Dispatch order (suggested): ${dispatchOrder}`)
console.log(`Each chunk fits one subagent dispatch (~5-10 min operator time).`)
