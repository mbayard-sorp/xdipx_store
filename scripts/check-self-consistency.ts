/**
 * Deterministic pre-flight for the self-consistency defect class in a
 * Notebook draft, run BEFORE the emma-empathy-reviewer / sex-wellness-reviewer
 * gates so the writer catches a post contradicting its own stated rules
 * before spending the routine's one allowed rewrite cycle (ticket #11099).
 * Sibling of scripts/check-antithesis-cap.ts and
 * scripts/check-unsourced-frequency.ts. See app/lib/self-consistency.ts for
 * the full definition of what this flags (and the tractable subset it
 * deliberately does not catch).
 *
 * As of ticket #18045 it also runs a cross-post pass, in the same split as
 * check-fresh-language.ts / app/lib/fresh-language.ts: the in-document check
 * in app/lib/self-consistency.ts is pure, this file supplies the live Sanity
 * read. Pass `--slug` to enable it: with it, the script GROQs every published
 * `blogPost` (excluding the draft's own slug) and reds on a draft whose
 * ingress-code instruction disagrees with one already live. Without `--slug`
 * (back-compat; the comparison-doc flattening callers in
 * routine-content-daily.md do not have a slug at every call site), only the
 * in-document pass runs.
 *
 * Usage:
 *   npx tsx scripts/check-self-consistency.ts <draft.json> [--slug <self-slug>]
 *   cat draft.json | npx tsx scripts/check-self-consistency.ts [--slug <self-slug>]
 *
 * The draft JSON is the blogPost draft: { title?, excerpt?, seoTitle?, seoDescription?, body? } where body
 * is the Portable Text array. Exit 0 when clean, 1 when any finding is
 * flagged (the limit is zero), so the routine can gate on the exit code.
 */
import './_load-env'
import { readFileSync } from 'node:fs'
import { createClient } from '@sanity/client'
import { draftToParagraphs } from '../app/lib/aphorism-closer'
import {
  analyzeDraft,
  findCrossPostIngressConflicts,
  type DraftInput,
} from '../app/lib/self-consistency'

const TAG = '[self-consistency]'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const selfSlug = arg('slug')

function readInput(): string {
  const argv = process.argv.slice(2)
  const slugIndex = argv.indexOf('--slug')
  const positional = argv.filter((_, i) => i !== slugIndex && i !== slugIndex + 1)
  const path = positional[0]
  if (path) return readFileSync(path, 'utf8')
  // No path: read the draft JSON from stdin.
  return readFileSync(0, 'utf8')
}

let draft: DraftInput
try {
  const raw = readInput()
  if (!raw.trim()) {
    console.error(`${TAG} no draft JSON provided (pass a file path or pipe JSON on stdin).`)
    process.exit(1)
  }
  draft = JSON.parse(raw) as DraftInput
} catch (err) {
  console.error(`${TAG} could not read/parse draft JSON:`, err instanceof Error ? err.message : err)
  process.exit(1)
}

interface PriorPost {
  slug: string
  title?: string | null
  body?: unknown
}

async function main(): Promise<void> {
  const report = analyzeDraft(draft)

  let crossPostConflicts: ReturnType<typeof findCrossPostIngressConflicts> = []
  let crossPostNote: string

  if (selfSlug) {
    const projectId = process.env['SANITY_PROJECT_ID']
    if (!projectId) {
      console.error(`${TAG} --slug was passed but SANITY_PROJECT_ID is not set; cannot run the cross-post pass. Run scripts/setup-worktree.sh first.`)
      process.exit(1)
    }

    const sanity = createClient({
      projectId,
      dataset: process.env['SANITY_DATASET'] ?? 'production',
      apiVersion: '2024-10-01',
      useCdn: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      token: process.env['SANITY_API_TOKEN'],
    } as any)

    const priors = await sanity.fetch<PriorPost[]>(
      `*[_type == "blogPost" && status == "published" && slug.current != $slug]{title, "slug": slug.current, body}`,
      { slug: selfSlug },
    )

    crossPostConflicts = findCrossPostIngressConflicts(
      draftToParagraphs(draft),
      (priors ?? []).map(p => ({
        slug: p.slug,
        paragraphs: draftToParagraphs({ title: p.title, body: p.body }),
      })),
    )
    crossPostNote = ` + cross-post pass against ${priors?.length ?? 0} published post(s)`
  } else {
    crossPostNote = ' (cross-post pass skipped: no --slug given)'
  }

  const totalFindings = report.findings.length + crossPostConflicts.length

  if (totalFindings === 0) {
    console.log(`${TAG} OK. 0 findings${crossPostNote}.`)
    return
  }

  if (report.findings.length > 0) {
    console.error(`${TAG} ${report.findings.length} in-document finding(s) to resolve before the voice gate:`)
    for (const finding of report.findings) {
      console.error(`  [${finding.kind}] ${finding.message}`)
      for (const site of finding.sites) {
        console.error(`      [${site.section}] "${site.sentence}"`)
      }
    }
  }

  if (crossPostConflicts.length > 0) {
    console.error(
      `${TAG} ${crossPostConflicts.length} cross-post ingress-code conflict(s) against already-published posts:`,
    )
    for (const c of crossPostConflicts) {
      console.error(
        `  [cross-post-conflict] "${c.token}" gets conflicting instructions on ${c.bucket}: ` +
          `draft ${c.draftPolarity}s it, published post "${c.priorSlug}" ${c.priorPolarity}s it.`,
      )
      console.error(`      [draft, ${c.draftSite.section}] "${c.draftSite.sentence}"`)
      console.error(`      [${c.priorSlug}, ${c.priorSite.section}] "${c.priorSite.sentence}"`)
    }
  }

  process.exit(1)
}

main().catch((err) => {
  console.error(`${TAG} ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
