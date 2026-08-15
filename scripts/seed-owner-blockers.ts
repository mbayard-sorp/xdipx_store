/**
 * Seed the owner blocker list from docs/store-team/ops-blockers.md.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/seed-owner-blockers.ts
 *   DATABASE_URL=<prod> npx tsx scripts/seed-owner-blockers.ts --dry
 *
 * The doc is freeform prose with RESOLVED paragraphs interleaved, so this is a
 * hand-authored extraction of the rows that were still open when the list moved
 * into Postgres, not a parser. A parser over that prose would be guesswork
 * dressed up as automation, and the whole point of the table is that a row
 * means something definite.
 *
 * Idempotent: every row upserts by dedupe_key, so re-running is safe. Anything
 * already done clears itself on the next probe sweep rather than needing to be
 * edited out here.
 */

import { fileBlocker, verifyBlockers, type BlockerInput } from '../app/lib/owner-blockers.server'

const DRY = process.argv.includes('--dry')

const SEED: BlockerInput[] = [
  {
    dedupeKey: 'console:sanity-mcp-content-trigger',
    title: 'Attach the Sanity (and Shopify) MCP connectors to the content routine',
    detail:
      'The content playbook mandates Sanity MCP for all reads and writes, but the connector is not attached to that trigger\'s session, so runs limp along on the Sanity HTTP API. Either enable the connectors on the content routine\'s environment, or sanction the HTTP API as an explicit fallback in routine-content-daily.md.',
    unblocks: 'Content routine runs on its intended write path instead of a fallback.',
    whereToGo: 'claude.ai → the content routine\'s connector settings. Egress binds at sandbox start, so re-trigger a fresh run after changing it.',
    category: 'console',
    priority: 2,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#25/#31',
    evidence: 'ops-blockers.md: "Sanity MCP connector not attached to the content trigger\'s session, though the playbook mandates Sanity MCP for all reads/writes."',
  },
  {
    dedupeKey: 'console:sanity-publish-write-safety',
    title: 'Authorize the gated Sanity publish write for the content routine',
    detail:
      'The write-safety classifier blocks the Sanity publish call even when content_team_autopublish is true and the voice gate PASSed, silently degrading autopublish to draft-only. This is session-level safety behavior, not something in the repo.',
    unblocks: 'Daily Notebook posts publish themselves again instead of stopping at draft.',
    whereToGo: 'claude.ai → Code sandbox settings for the content routine. Alternative: accept manual publish and document it.',
    category: 'console',
    priority: 2,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#30',
    evidence: 'ops-blockers.md: "Write-safety classifier blocks the Sanity publish write even when content_team_autopublish=true and the voice gate PASSed, silently degrading autopublish to draft-only."',
  },
  {
    dedupeKey: 'console:egress-fal-media',
    title: 'Allowlist *.fal.media for outbound fetch',
    detail:
      'Hero image generation succeeds and then the download 403s, because v3b.fal.media is not in the egress allowlist. Every Notebook post ships heroless.',
    unblocks: 'Notebook posts get hero images.',
    whereToGo: 'claude.ai → Code sandbox egress settings. See docs/homepage-team/routine-network-requirements.md. Egress binds when the sandbox starts, so re-trigger a fresh run after the change.',
    category: 'console',
    priority: 2,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#35',
    evidence: 'ops-blockers.md: "*.fal.media (e.g. v3b.fal.media) is not in the egress allowlist (download 403 after a successful generate)."',
  },
  {
    dedupeKey: 'console:gcp-imagen-billing',
    title: 'Enable billing on GCP project xdipx-store-image-gen',
    detail:
      'The Imagen fallback 403s because billing is disabled on the project, so when fal is blocked there is no second path to a hero image.',
    unblocks: 'Imagen works as the fallback when fal.ai is unavailable or blocked.',
    whereToGo: 'GCP console → project xdipx-store-image-gen → Billing.',
    category: 'console',
    priority: 3,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#35',
    evidence: 'ops-blockers.md: "the Imagen fallback 403s because billing is disabled on GCP project xdipx-store-image-gen."',
  },
  {
    dedupeKey: 'valve:seo-curation-enabled',
    title: 'Confirm the seo-curator routine is scheduled and its valve is on',
    detail:
      'The seoContentBrief queue is empty, so content-writer falls back to the static content-plan.md backlog every run and posts carry no primaryKeyword or questionKeyword targeting. The weekly routine that should populate the queue does not appear to be running.',
    unblocks: 'Blog posts get keyword targeting instead of running off a static backlog.',
    whereToGo: '/admin/homepage-team (content tab) for the seo_curation_enabled valve; the trigger itself lives in the Claude scheduler.',
    category: 'valve',
    priority: 3,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#5',
    evidence: 'ops-blockers.md: "seoContentBrief queue empty — 0 documents, so the content-writer falls back to the static content-plan.md backlog every run."',
    verifyProbe: 'setting_true',
    verifyArg: 'seo_curation_enabled',
  },
  {
    dedupeKey: 'execute:klaviyo-list-counts',
    title: 'Expose Klaviyo per-list subscribed counts to the email planner',
    detail:
      'The email planner cannot right-size send volume: consent_log.customer_id is null on every row (only a ~150 session-grant proxy) and order_line_items is empty. Until a read path exists, every email brief has to caveat volume.',
    unblocks: 'Email briefs can size sends against real list counts instead of caveating.',
    whereToGo: 'Needs a read field on GET /api/team/gate?team=email or a small endpoint proxying Klaviyo list sizes. This one may be agent-doable as a ticket rather than owner work; decide which and move it.',
    category: 'execute',
    priority: 4,
    source: 'ops-doc',
    sourceRef: 'docs/store-team/ops-blockers.md#23',
    evidence: 'ops-blockers.md: "Klaviyo list counts not visible to the team — the email planner can\'t right-size send volume."',
  },
]

async function main() {
  console.log(`Seeding ${SEED.length} owner blockers${DRY ? ' (dry run)' : ''}…\n`)

  if (DRY) {
    for (const s of SEED) {
      console.log(`  ${s.dedupeKey}\n    ${s.title}`)
    }
    console.log('\nDry run: nothing written.')
    return
  }

  let created = 0
  let seen = 0
  for (const s of SEED) {
    const res = await fileBlocker(s)
    if (res.created) created++
    else seen++
    console.log(`  ${res.created ? 'created' : 're-observed'} #${res.id}  ${s.dedupeKey}`)
  }

  console.log(`\n${created} created, ${seen} already present. Running the probe sweep…`)
  const verified = await verifyBlockers()
  console.log(
    `  checked ${verified.checked}: ${verified.autoCleared.length} auto-cleared, ` +
    `${verified.stillBlocked} still blocked, ${verified.unknown} unknown`,
  )
  for (const c of verified.autoCleared) console.log(`  ✓ cleared #${c.id} ${c.title}`)
  console.log('\nDone. See /admin/blockers.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
