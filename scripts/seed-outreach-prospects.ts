/**
 * Seed outreach_prospects from docs/store-team/outreach-prospects.md.
 *
 * Upserts every READY/CONDITIONAL row that has a real contact email (6 as of
 * 2026-08-05) as a prospect with status 'new', carrying the row's vetting
 * note or caveat into policy_note. Idempotent: rerunning updates the email
 * and policy note but never touches the status of an existing row, so a
 * prospect the pipeline has already moved along is not reset.
 *
 *   DATABASE_URL=<url> npx tsx scripts/seed-outreach-prospects.ts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../app/lib/db.server'
import { outreachProspects } from '../db/schema'
import { parseProspectsDoc } from '../app/lib/outreach-prospects-doc'

const here = dirname(fileURLToPath(import.meta.url))
const DOC_PATH = join(here, '..', 'docs', 'store-team', 'outreach-prospects.md')

async function main() {
  const markdown = readFileSync(DOC_PATH, 'utf8')
  const parsed = parseProspectsDoc(markdown)
  if (parsed.length === 0) {
    console.error('No email-reachable READY/CONDITIONAL rows found. Doc format changed?')
    process.exit(1)
  }
  console.log(`Parsed ${parsed.length} email-reachable prospects from the doc.`)

  let created = 0
  let updated = 0
  for (const p of parsed) {
    const policyNote = `[${p.vetting}] ${p.policyNote}`.trim()
    const [existing] = await db
      .select({ id: outreachProspects.id, status: outreachProspects.status })
      .from(outreachProspects)
      .where(eq(outreachProspects.domain, p.domain))
      .limit(1)
    if (existing) {
      await db
        .update(outreachProspects)
        .set({
          contactEmail: p.contactEmail,
          policyNote,
          updatedAt: new Date(),
        })
        .where(eq(outreachProspects.id, existing.id))
      updated++
      console.log(`  ~ ${p.domain} (id ${existing.id}, status ${existing.status} kept)`)
    } else {
      const [row] = await db
        .insert(outreachProspects)
        .values({
          domain: p.domain,
          contactEmail: p.contactEmail,
          contactChannel: 'email',
          source: 'prospects-doc',
          status: 'new',
          policyNote,
        })
        .returning({ id: outreachProspects.id })
      created++
      console.log(`  + ${p.domain} (id ${row?.id})`)
    }
  }
  console.log(`Done: ${created} created, ${updated} updated.`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
