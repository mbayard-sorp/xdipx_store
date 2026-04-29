// Imports a Cowork-produced dial-bootstrap JSON into Sanity. The JSON shape:
//
//   {
//     "_meta": { /* optional — Cowork metadata; ignored at import */ },
//     "<ProductTypeDial>": [
//       { "label": "...", "definition": "...", "scaleLow": "...", "scaleMid": "...", "scaleHigh": "..." },
//       ...
//     ],
//     ...up to 19 type keys
//   }
//
// Two modes:
//   - default (REPLACE):  writes the JSON's entries as the canonical taxonomy
//                         for each type. Use for the initial bootstrap or for
//                         deliberate editorial resets.
//   - --append:           reads existing taxonomy, dedupes by label (case-
//                         insensitive), and writes existing + new combined.
//                         Use for gap-fill files that add to the pool.
//
// In both modes, calls writeDialTaxonomyForType per type — that writes the
// rich entries to dialTaxonomy AND mirrors flat labels into dialRegistry
// (single Sanity patch each, atomic per type).
//
// Dry-run by default. Re-run with --apply to write.
//
// Usage:
//   npx tsx scripts/import-dial-bootstrap.ts                                       # dry-run, default file, replace mode
//   npx tsx scripts/import-dial-bootstrap.ts --apply                               # replace mode, commit
//   npx tsx scripts/import-dial-bootstrap.ts --file=<path> --append --apply        # gap-fill mode, commit
//   npx tsx scripts/import-dial-bootstrap.ts --types=vibrator,dildo                # subset
import './_load-env'
import { readFileSync } from 'node:fs'
import { writeDialTaxonomyForType, getDialRegistry, getDialTaxonomy } from '../app/lib/dial-registry.server'
import { PRODUCT_TYPE_DIALS, type ProductTypeDial } from '../app/types'

const DEFAULT_FILE = '/Users/mikebayard/Documents/xdipx.com/Nalpac Reports/xdipx-dial-bootstrap.json'

interface DimensionEntry {
  label:      string
  definition: string
  scaleLow:   string
  scaleMid:   string
  scaleHigh:  string
}

interface Args {
  file:    string
  apply:   boolean
  append:  boolean
  types?:  Set<ProductTypeDial>
}

function parseArgs(argv: string[]): Args {
  const get = (prefix: string) => {
    const arg = argv.find(a => a.startsWith(`${prefix}=`))
    return arg ? arg.slice(prefix.length + 1) : undefined
  }
  const args: Args = {
    file:   get('--file') ?? DEFAULT_FILE,
    apply:  argv.includes('--apply'),
    append: argv.includes('--append'),
  }
  const types = get('--types')
  if (types) {
    const set = new Set<ProductTypeDial>()
    for (const raw of types.split(',').map(s => s.trim()).filter(Boolean)) {
      if ((PRODUCT_TYPE_DIALS as readonly string[]).includes(raw)) {
        set.add(raw as ProductTypeDial)
      } else {
        console.warn(`[args] unknown ProductTypeDial value "${raw}" — skipping`)
      }
    }
    args.types = set
  }
  return args
}

function validateEntry(entry: unknown, where: string): DimensionEntry {
  if (!entry || typeof entry !== 'object') throw new Error(`${where}: not an object`)
  const e = entry as Record<string, unknown>
  for (const key of ['label', 'definition', 'scaleLow', 'scaleMid', 'scaleHigh'] as const) {
    if (typeof e[key] !== 'string' || (e[key] as string).trim().length === 0) {
      throw new Error(`${where}: missing or empty "${key}"`)
    }
  }
  if ((e['label'] as string).length > 24) {
    throw new Error(`${where}: label "${e['label'] as string}" exceeds 24 chars`)
  }
  return {
    label:      (e['label']      as string).trim(),
    definition: (e['definition'] as string).trim(),
    scaleLow:   (e['scaleLow']   as string).trim(),
    scaleMid:   (e['scaleMid']   as string).trim(),
    scaleHigh:  (e['scaleHigh']  as string).trim(),
  }
}

function loadAndValidate(file: string): Record<ProductTypeDial, DimensionEntry[]> {
  const raw = readFileSync(file, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${err instanceof Error ? err.message : err}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('top-level must be an object')

  const valid = new Set<string>(PRODUCT_TYPE_DIALS as readonly string[])
  const out = {} as Record<ProductTypeDial, DimensionEntry[]>
  let totalDims = 0

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // Skip Cowork-style metadata blocks (e.g. `_meta`, `_notes`).
    if (key.startsWith('_')) continue
    if (!valid.has(key)) {
      throw new Error(`unknown ProductTypeDial key "${key}" in ${file}`)
    }
    if (!Array.isArray(value)) {
      throw new Error(`${key}: expected array of dimension entries`)
    }
    const entries = value.map((entry, i) => validateEntry(entry, `${key}[${i}]`))
    out[key as ProductTypeDial] = entries
    totalDims += entries.length
  }

  console.log(`[load] ${Object.keys(out).length} types · ${totalDims} dimensions total`)
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.append ? 'append' : 'replace'
  console.log(`import-dial-bootstrap: file=${args.file} mode=${mode} apply=${args.apply}${args.types ? ` types=${[...args.types].join(',')}` : ''}`)
  console.log()

  const data = loadAndValidate(args.file)

  // Snapshot existing state for diffing + merging.
  const [currentRegistry, currentTaxonomy] = await Promise.all([
    getDialRegistry(),
    getDialTaxonomy(),
  ])

  // Build the final per-type write payload. In append mode, merge existing
  // taxonomy with new entries (dedupe by label, case-insensitive). In replace
  // mode, the new entries become the canonical set.
  const finalPayload: Record<string, DimensionEntry[]> = {}
  const types = Object.keys(data) as ProductTypeDial[]

  console.log('— per-type plan —')
  for (const type of types) {
    if (args.types && !args.types.has(type)) {
      console.log(`  ${type.padEnd(14)} (skipped — not in --types filter)`)
      continue
    }
    const newEntries  = data[type]
    const oldEntries  = currentTaxonomy[type] ?? []
    const oldLabels   = currentRegistry[type] ?? []

    let combined: DimensionEntry[]
    let added: string[] = []
    let dupSkipped: string[] = []

    if (args.append) {
      const seen = new Set(oldEntries.map(e => e.label.toLowerCase()))
      const additions: DimensionEntry[] = []
      for (const e of newEntries) {
        if (seen.has(e.label.toLowerCase())) {
          dupSkipped.push(e.label)
          continue
        }
        seen.add(e.label.toLowerCase())
        additions.push(e)
        added.push(e.label)
      }
      // Coerce existing entries to DimensionEntry shape (definition/scale fields
      // may be undefined on older Sanity rows; default to empty string).
      const oldNormalized: DimensionEntry[] = oldEntries.map(e => ({
        label:      e.label,
        definition: e.definition ?? '',
        scaleLow:   e.scaleLow   ?? '',
        scaleMid:   e.scaleMid   ?? '',
        scaleHigh:  e.scaleHigh  ?? '',
      }))
      combined = [...oldNormalized, ...additions]
    } else {
      combined = newEntries
      added = newEntries.map(e => e.label)
    }

    finalPayload[type] = combined

    if (args.append) {
      console.log(
        `  ${type.padEnd(14)} ` +
        `taxonomy ${oldEntries.length}→${combined.length} ` +
        `(adding ${added.length}${dupSkipped.length > 0 ? `, skipping ${dupSkipped.length} dupes` : ''})`
      )
      if (added.length > 0) {
        console.log(`     adds: ${added.join(', ')}`)
      }
      if (dupSkipped.length > 0) {
        console.log(`     dupes (already present): ${dupSkipped.join(', ')}`)
      }
    } else {
      const newLabels = newEntries.map(e => e.label)
      const dropped = oldLabels.filter(l => !newLabels.some(n => n.toLowerCase() === l.toLowerCase()))
      const replaced = oldLabels.length > 0 && (oldLabels.length !== newLabels.length || dropped.length > 0)
      console.log(
        `  ${type.padEnd(14)} ` +
        `registry ${oldLabels.length}→${newLabels.length}` +
        (replaced ? ' (replacing prior labels)' : '') +
        ` · taxonomy ${oldEntries.length}→${newEntries.length}` +
        (oldEntries.length > 0 ? ' (replacing prior entries)' : '')
      )
      if (dropped.length > 0) {
        console.log(`     drops: ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? `, +${dropped.length - 6} more` : ''}`)
      }
    }
  }

  if (!args.apply) {
    console.log()
    console.log('[dry-run] no Sanity writes performed. Re-run with --apply to commit.')
    process.exit(0)
  }

  console.log()
  console.log('— writing —')
  let ok = 0
  let failed: Array<{ type: string; error: string }> = []
  for (const type of Object.keys(finalPayload) as ProductTypeDial[]) {
    try {
      await writeDialTaxonomyForType(type, finalPayload[type]!)
      console.log(`  ✓ ${type}`)
      ok++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ ${type}: ${msg}`)
      failed.push({ type, error: msg })
    }
  }

  console.log()
  console.log(`— done — wrote=${ok} failed=${failed.length}`)
  if (failed.length > 0) {
    for (const f of failed) console.log(`    ✗ ${f.type}: ${f.error}`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
