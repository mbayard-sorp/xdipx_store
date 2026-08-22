// Validate generated ProductWrites files against the exact server quality gate
// (explainQualityGateFailure) before pushing. Usage: gate-check.ts <file...>
import '../_load-env'
import { readFile } from 'node:fs/promises'
import { explainQualityGateFailure } from '../../app/lib/import-enrich.server'

async function main() {
  let bad = 0
  for (const f of process.argv.slice(2)) {
    try {
      const writes = JSON.parse(await readFile(f, 'utf8'))
      const reason = explainQualityGateFailure(writes)
      if (reason) { console.log(`FAIL ${f}: ${reason}`); bad++ }
      else console.log(`PASS ${f}`)
    } catch (err) {
      console.log(`FAIL ${f}: unreadable/unparseable: ${err instanceof Error ? err.message : err}`)
      bad++
    }
  }
  process.exit(bad > 0 ? 1 : 0)
}
main().catch(err => { console.error(err); process.exit(1) })
