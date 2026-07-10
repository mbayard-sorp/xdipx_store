/**
 * One-off triage of the seoKeyword bank's pending backlog.
 *
 * The April 2026 research run left ~1,750 terms in `pending` because the
 * auto-approve rule required volume data no term had (no DataForSEO creds).
 * This script applies the same routing rules the pipeline now uses
 * (see writeCandidates in app/lib/seo-research.server.ts), in order:
 *
 *   1. Hard-reject any term matching isPolicyTermRisk() (competitor name or
 *      medical/efficacy claim), regardless of the LLM's flag.
 *   2. Skip flagged terms (they stay a human queue in Sanity Studio),
 *      kind=='branded', and intent=='navigational'.
 *   3. Approve relevanceScore >= 0.85. Volume-unknown does not block.
 *   4. Demote relevanceScore < 0.50 to rejected (joins the <avoid> list).
 *   5. Leave the 0.50-0.85 gray zone pending for the seo-curator routine.
 *
 * Run (dry-run):  npx tsx scripts/seo-bank-triage.ts
 * Apply:          npx tsx scripts/seo-bank-triage.ts --apply
 */
import 'dotenv/config'
import { createClient } from '@sanity/client'
import { isPolicyTermRisk } from '../app/lib/seo-research.server'

const SANITY_PROJECT_ID = process.env['SANITY_PROJECT_ID']
const SANITY_DATASET    = process.env['SANITY_DATASET'] ?? 'production'
const SANITY_TOKEN      = process.env['SANITY_API_TOKEN']
const APPLY             = process.argv.includes('--apply')

const APPROVE_THRESHOLD = 0.85
const REJECT_THRESHOLD  = 0.50

if (!SANITY_PROJECT_ID || !SANITY_TOKEN) {
  console.error('Missing SANITY_PROJECT_ID or SANITY_API_TOKEN')
  process.exit(1)
}

const sanity = createClient({
  projectId:  SANITY_PROJECT_ID,
  dataset:    SANITY_DATASET,
  apiVersion: '2024-10-01',
  token:      SANITY_TOKEN,
  useCdn:     false,
  perspective: 'raw',
})

interface KeywordDoc {
  _id:            string
  term:           string
  kind?:          string
  intent?:        string
  relevanceScore?: number
  volume?:        number
  flagged?:       boolean
}

type Decision = 'approve' | 'reject-policy' | 'reject-low-relevance' | 'skip-flagged' | 'skip-branded' | 'skip-navigational' | 'keep-pending'

function decide(doc: KeywordDoc): Decision {
  const risk = isPolicyTermRisk(doc.term)
  if (risk) return 'reject-policy'
  if (doc.flagged) return 'skip-flagged'
  if (doc.kind === 'branded') return 'skip-branded'
  if (doc.intent === 'navigational') return 'skip-navigational'
  const rel = doc.relevanceScore ?? 0.5
  if (rel >= APPROVE_THRESHOLD) return 'approve'
  if (rel < REJECT_THRESHOLD) return 'reject-low-relevance'
  return 'keep-pending'
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'dry run'}\n`)

  const docs = await sanity.fetch<KeywordDoc[]>(
    `*[_type == "seoKeyword" && status == "pending"]{
      _id, term, kind, intent, relevanceScore, volume, flagged
    }`,
  )
  console.log(`Pending keywords: ${docs.length}\n`)

  const counts: Record<Decision, number> = {
    'approve': 0, 'reject-policy': 0, 'reject-low-relevance': 0,
    'skip-flagged': 0, 'skip-branded': 0, 'skip-navigational': 0, 'keep-pending': 0,
  }
  const samples: Record<Decision, string[]> = {
    'approve': [], 'reject-policy': [], 'reject-low-relevance': [],
    'skip-flagged': [], 'skip-branded': [], 'skip-navigational': [], 'keep-pending': [],
  }

  let tx = sanity.transaction()
  let txSize = 0
  let written = 0

  for (const doc of docs) {
    const decision = decide(doc)
    counts[decision]++
    if (samples[decision].length < 8) samples[decision].push(doc.term)

    if (!APPLY) continue

    if (decision === 'approve') {
      tx = tx.patch(doc._id, p => p.set({ status: 'approved', lastResearchedAt: new Date().toISOString() }))
      txSize++
    } else if (decision === 'reject-policy') {
      const risk = isPolicyTermRisk(doc.term)
      tx = tx.patch(doc._id, p => p.set({
        status: 'rejected',
        flagged: true,
        flagReason: `triage: ${risk === 'competitor' ? 'competitor brand name' : 'regulated medical/efficacy claim'} (pattern match)`,
      }))
      txSize++
    } else if (decision === 'reject-low-relevance') {
      tx = tx.patch(doc._id, p => p.set({ status: 'rejected' }))
      txSize++
    }

    if (txSize >= 100) {
      await tx.commit()
      written += txSize
      console.log(`  committed ${written} patches...`)
      tx = sanity.transaction()
      txSize = 0
    }
  }

  if (APPLY && txSize > 0) {
    await tx.commit()
    written += txSize
  }

  console.log('Decision summary:')
  for (const [decision, n] of Object.entries(counts)) {
    if (n === 0) continue
    console.log(`  ${decision.padEnd(22)} ${String(n).padStart(5)}   e.g. ${samples[decision as Decision].slice(0, 4).join(' | ')}`)
  }
  console.log(APPLY ? `\nApplied ${written} patches.` : '\nDry run only. Re-run with --apply to write.')
}

main().catch(err => { console.error(err); process.exit(1) })
