/**
 * Read-only live exercise of the render-truth gate.
 *
 *   npx tsx scripts/render-truth-live.ts
 *
 * Reads the published slate off payload B, fetches the live homepage with the
 * same cache-busting the cron uses, and prints the assertions. Writes nothing:
 * no KV fingerprint snapshot, no tickets, no Sanity mutation. Safe to point at
 * production.
 */
import 'dotenv/config'
import {
  assertSlateRendered,
  extractPublishedSlate,
  fingerprintSlate,
  normalizeRenderedText,
  FALLBACK_MARKERS,
} from '~/lib/homepage-healthcheck.server'
import { readHomepagePayloadB } from '~/lib/homepage-payload.server'

const ORIGIN = (process.env['BASE_URL'] || 'https://xdipx.com').replace(/\/$/, '')

async function main() {
  const payload = await readHomepagePayloadB()
  if (!payload) throw new Error('no payload B blob')

  // Layer-1 inputs (Sanity -> payload), read-only.
  const { getHomepageDocRaw, getHomeConfig } = await import('~/lib/sanity.server')
  const [raw, cfg] = await Promise.all([
    getHomepageDocRaw().catch(() => null),
    getHomeConfig().catch(() => null),
  ])
  const rawSections = Array.isArray(raw?.['sections']) ? (raw['sections'] as unknown[]).length : 0
  console.log('--- layer 1 (Sanity -> payload) ---')
  console.log('served variant:', cfg?.activeVariant ?? process.env['HOME_VARIANT'] ?? 'legacy')
  console.log('raw Sanity sections:', rawSections)
  console.log('doc _updatedAt:', raw?.['_updatedAt'] ?? '(none)')

  const slate = extractPublishedSlate(payload)
  console.log('--- published slate (payload B) ---')
  console.log(JSON.stringify(slate, null, 2))
  console.log('builtAt:', new Date(payload.builtAt).toISOString())

  const url = `${ORIGIN}/?__healthcheck=${Date.now()}-live`
  const res = await fetch(url, { headers: { 'user-agent': 'xdipx-homepage-healthcheck' } })
  const html = await res.text()
  console.log(`\n--- live fetch ---\n${url}\nHTTP ${res.status}, ${html.length} bytes`)

  const assertions = assertSlateRendered(slate, html)
  console.log('\n--- assertions ---')
  for (const a of assertions) {
    console.log(`${a.ok ? 'PASS' : 'FAIL'}  [${a.section}] ${a.expected}${a.detail ? `  (${a.detail})` : ''}`)
  }
  const failed = assertions.filter(a => !a.ok)
  console.log(`\nrender-truth: ${failed.length === 0 ? 'PASS' : `FAIL (${failed.length})`}`)

  const text = normalizeRenderedText(html)
  console.log('\n--- fallback markers present in rendered text ---')
  for (const [slot, marker] of Object.entries(FALLBACK_MARKERS)) {
    console.log(`${slot}: ${text.includes(marker.toLowerCase().replace(/\s+/g, '')) ? 'PRESENT' : 'absent'}`)
  }
  console.log('\n--- fingerprint ---')
  console.log(JSON.stringify(fingerprintSlate(slate), null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
