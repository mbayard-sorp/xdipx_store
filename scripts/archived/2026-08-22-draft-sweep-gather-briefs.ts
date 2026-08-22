// Gather enrichment briefs + shared editorial context for the 2026-08-22
// draft-sweep (37 unenriched Shopify drafts, all with deal_history rows).
// Writes one dispatch file per product (brief + vocabularies, the exact input
// contract of the emma-product-enricher agent) into the out dir.
import '../_load-env'
import { mkdir, writeFile } from 'node:fs/promises'
import { gatherProductBrief, loadSharedEnrichmentContext } from '../../app/lib/enricher-brief.server'

const OUT = process.argv[2]
const IDS = process.argv.slice(3)

async function main() {
  if (!OUT || IDS.length === 0) {
    console.error('usage: gather-briefs.ts <outDir> <productId...>')
    process.exit(1)
  }
  await mkdir(OUT, { recursive: true })
  const sc = await loadSharedEnrichmentContext()
  const vocabularies = {
    moodVocab: sc.moodVocab,
    audienceVocab: sc.audienceVocab,
    mattersVocab: sc.mattersVocab,
    dialRegistryByType: sc.dialRegistryByType,
    dialTaxonomy: sc.dialTaxonomy,
  }
  let ok = 0
  for (const id of IDS) {
    const brief = await gatherProductBrief(id)
    if (!brief) {
      console.log(`FAIL ${id} no brief`)
      continue
    }
    brief.pairingCandidates = []  // deal-cycle artifact, suppressed at import time
    await writeFile(`${OUT}/dispatch-${id}.json`, JSON.stringify({ ...brief, vocabularies }, null, 1))
    console.log(`OK ${id} ${brief.sku ?? ''} ${brief.rawTitle.slice(0, 50)}`)
    ok++
    await new Promise(r => setTimeout(r, 250))
  }
  console.log(`gathered ${ok}/${IDS.length}`)
  process.exit(0)
}
main().catch(err => { console.error(err); process.exit(1) })
