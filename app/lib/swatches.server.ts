import { inArray } from 'drizzle-orm'
import { db } from './db.server'
import { colorSwatchCache } from '../../db/schema'
import { generateWithSystem } from './claude.server'

type SwatchMap = Record<string, string>

const hot = new Map<string, string>()

const HEX_RE = /^#[0-9a-f]{6}$/i

function normalize(label: string): string {
  return label.trim().toLowerCase()
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
}

async function inferWithClaude(labels: string[]): Promise<SwatchMap> {
  const system = `You map fabric / garment / product color names to a single 6-digit hex color that visually approximates the label. Return ONLY valid JSON: an object mapping each input label (exactly as given, verbatim) to a "#RRGGBB" string. No commentary, no markdown. If a label is patterned (camo, tie-dye, print), pick the dominant hue.`
  const user = `Map each of these color labels to a hex code:\n${JSON.stringify(labels)}\n\nReturn only JSON like {"Sage":"#7C8F78","Heather Dusk":"#8A8390"}.`

  const raw = await generateWithSystem({
    system,
    user,
    maxTokens: Math.min(256, 32 + labels.length * 24),
    timeoutMs: 1500,
    caller: 'swatches',
  })
  const parsed = JSON.parse(stripFences(raw)) as Record<string, unknown>
  const out: SwatchMap = {}
  for (const label of labels) {
    const hex = parsed[label]
    if (typeof hex === 'string' && HEX_RE.test(hex)) {
      out[normalize(label)] = hex.toLowerCase()
    }
  }
  return out
}

/**
 * Returns a `{ [normalizedLabel]: "#rrggbb" }` map for the given labels.
 * Hot cache → DB → Claude inference (single batched call, 1500ms timeout).
 * Unresolvable labels are simply omitted so callers fall through to
 * their own defaults (COLOR_MAP, cream-2).
 */
export async function getSwatchMap(labels: string[]): Promise<SwatchMap> {
  if (labels.length === 0) return {}

  const uniqueLabels = Array.from(
    new Map(labels.map(l => [normalize(l), l])).entries(),
  )

  const result: SwatchMap = {}
  const dbMisses: { key: string; label: string }[] = []

  for (const [key, label] of uniqueLabels) {
    const hit = hot.get(key)
    if (hit) result[key] = hit
    else dbMisses.push({ key, label })
  }
  if (dbMisses.length === 0) return result

  try {
    const rows = await db
      .select({ colorKey: colorSwatchCache.colorKey, hex: colorSwatchCache.hex })
      .from(colorSwatchCache)
      .where(inArray(colorSwatchCache.colorKey, dbMisses.map(m => m.key)))
    const dbMap = new Map(rows.map(r => [r.colorKey, r.hex]))
    const stillMissing: { key: string; label: string }[] = []
    for (const miss of dbMisses) {
      const hex = dbMap.get(miss.key)
      if (hex && HEX_RE.test(hex)) {
        hot.set(miss.key, hex)
        result[miss.key] = hex
      } else if (dbMap.has(miss.key)) {
        // Cached null — previous inference failed; don't retry this request
      } else {
        stillMissing.push(miss)
      }
    }
    if (stillMissing.length === 0) return result

    let inferred: SwatchMap = {}
    try {
      inferred = await inferWithClaude(stillMissing.map(m => m.label))
    } catch (err) {
      console.warn('[swatches] inference failed:', (err as Error).message)
    }

    const rowsToInsert = stillMissing.map(m => ({
      colorKey: m.key,
      label: m.label,
      hex: inferred[m.key] ?? null,
      source: 'ai',
    }))
    try {
      await db.insert(colorSwatchCache).values(rowsToInsert).onConflictDoNothing()
    } catch (err) {
      console.warn('[swatches] cache insert failed:', (err as Error).message)
    }
    for (const m of stillMissing) {
      const hex = inferred[m.key]
      if (hex) {
        hot.set(m.key, hex)
        result[m.key] = hex
      }
    }
    return result
  } catch (err) {
    console.warn('[swatches] DB lookup failed:', (err as Error).message)
    return result
  }
}
