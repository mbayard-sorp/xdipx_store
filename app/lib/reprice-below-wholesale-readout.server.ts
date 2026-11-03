/**
 * Ticket #19545. The owner-decision call on the below-wholesale cohort
 * (reprice vs. delist) was answerable only by someone running
 * `scripts/reprice-below-wholesale.ts` by hand from a terminal with `.env` --
 * a script the owner must run themselves is the same as no answer. This is
 * the weekly, unattended counterpart: it runs the same read-only scan
 * (`reprice-below-wholesale-scan.server.ts`, no --apply path exists here)
 * and posts the measured counts to the existing owner blocker (#1550) that
 * already tracks this decision, so the blocker stays current without anyone
 * re-running the script.
 *
 * Blockers are matched by `dedupeKey`, not by their numeric id (fileBlocker's
 * ON CONFLICT target), so this looks the row up by id first to read its real
 * dedupeKey/title/category rather than hard-coding a guess that would file a
 * second, disconnected blocker instead of updating the one the owner already
 * sees. If #1550 is no longer open (cleared, dismissed, or renumbered), this
 * falls back to filing a clearly-labeled new row under a stable key so the
 * condition still reaches the owner rather than silently going nowhere.
 */
import { fileBlocker, listAllBlockers, type BlockerInput } from './owner-blockers.server'
import { scanRepriceBelowWholesale, formatScanSummary, type RepriceBelowWholesaleScanResult } from './reprice-below-wholesale-scan.server'

/** The blocker this readout answers (owner-decision half of #16276, per the script's own header). */
export const TARGET_BLOCKER_ID = 1550

export const FALLBACK_DEDUPE_KEY = 'reprice-below-wholesale-readout'
export const FALLBACK_TITLE = `Reprice-vs-delist decision needed for the below-wholesale cohort (blocker #${TARGET_BLOCKER_ID} not found open)`

export interface TargetBlocker {
  dedupeKey: string
  title: string
  category: string
  priority: number
}

export interface RepriceReadoutDeps {
  scan: () => Promise<RepriceBelowWholesaleScanResult>
  findTargetBlocker: () => Promise<TargetBlocker | null>
  fileBlocker: (input: BlockerInput) => Promise<unknown>
}

async function findTargetBlockerLive(): Promise<TargetBlocker | null> {
  const all = await listAllBlockers(500)
  const found = all.find(b => b.id === TARGET_BLOCKER_ID && b.status === 'open')
  return found ? { dedupeKey: found.dedupeKey, title: found.title, category: found.category, priority: found.priority } : null
}

export function defaultRepriceReadoutDeps(): RepriceReadoutDeps {
  return {
    scan: scanRepriceBelowWholesale,
    findTargetBlocker: findTargetBlockerLive,
    fileBlocker,
  }
}

export interface RepriceReadoutResult {
  /** True when the existing blocker #1550 was found open and updated; false when the fallback row was used instead. */
  updatedTargetBlocker: boolean
  dedupeKey: string
  scan: RepriceBelowWholesaleScanResult
}

/**
 * Run the read-only scan and post its counts to blocker #1550's body (or the
 * fallback row if #1550 is not open). Never touches Shopify beyond the scan's
 * own GraphQL reads; never writes a price.
 */
export async function runRepriceBelowWholesaleReadout(
  deps: RepriceReadoutDeps = defaultRepriceReadoutDeps(),
): Promise<RepriceReadoutResult> {
  const scan = await deps.scan()
  const detail = formatScanSummary(scan)
  const target = await deps.findTargetBlocker()

  await deps.fileBlocker({
    dedupeKey: target?.dedupeKey ?? FALLBACK_DEDUPE_KEY,
    title: target?.title ?? FALLBACK_TITLE,
    detail,
    category: target?.category ?? 'decision',
    priority: target?.priority ?? 2,
    source: 'sweep',
    sourceRef: 'scripts/reprice-below-wholesale.ts (shared scan)',
    evidence: `Weekly read-only catalog scan, ${new Date().toISOString().slice(0, 10)}: `
      + `${scan.scannedProducts} ACTIVE products / ${scan.variantsScanned} variants.`,
    // This row's whole point is the owner's reprice-vs-delist call itself
    // (category 'decision'), not a checkable fact a probe could clear.
    overrideNoProbeReason: 'Measured readout only; the reprice-vs-delist call is the owner decision this blocker tracks.',
  })

  return {
    updatedTargetBlocker: target != null,
    dedupeKey: target?.dedupeKey ?? FALLBACK_DEDUPE_KEY,
    scan,
  }
}
