// Source guard for ticket #16871: hardcoded customer-facing strings in
// app/components/store/ kept shipping em-dashes (the voice charter's "No
// em-dashes anywhere", docs/emma-voice.md line 166) because nothing checked
// for one until a blank Sanity field let a fallback string render. This
// scans each component's source text (after stripping comments, so the
// plentiful em-dashes in code comments don't false-positive) for the
// character and fails the moment a new one lands, rather than waiting for
// production content to go blank.
//
// Known limitation, same as the storefront-discover-cap.test.ts precedent:
// this is a text scan, not an AST walk, so it reads whatever remains after
// comment-stripping as "customer-facing". For this codebase that is
// accurate enough in practice (comments are the only other thing an
// em-dash shows up in), and it is cheaper and more legible than parsing.
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const STORE_DIR = join(__dirname) // app/components/store

/**
 * Files that already carried an em-dash in live customer-facing text before
 * this guard was added (ticket #16871's sweep), kept out of the ticket's own
 * named scope (EmmaHero/CartDrawer/PersonalizedSearchRail/ProductSummaryGrid)
 * because cleaning them is a materially larger job: the "— {name}" byline is
 * a repeated convention across the whole Pair Bundle hero family, not a
 * stray prose dash. Filed as a follow-up (#16886) to shrink this list to
 * empty; a new file landing with an em-dash is NOT exempt just by being
 * added here; this list only grandfathers what already existed.
 */
const ALLOWLISTED_PRE_EXISTING_VIOLATIONS = new Set([
  'BundleHero.tsx',
  'PairBundleFullBleedHero.tsx',
  'PairBundleHero.tsx',
  'PairBundleHeroCarousel.tsx',
  'VariantSelector.tsx',
])

function stripComments(src: string): string {
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlockComments
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function componentFiles(): string[] {
  return readdirSync(STORE_DIR).filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
}

describe('em-dash guard (app/components/store)', () => {
  it.each(componentFiles().filter(f => !ALLOWLISTED_PRE_EXISTING_VIOLATIONS.has(f)))(
    '%s has no em-dash in customer-facing source text',
    (file) => {
      const src = readFileSync(join(STORE_DIR, file), 'utf8')
      const stripped = stripComments(src)
      expect(stripped).not.toContain('—')
    },
  )

  it('the allowlist only names files that still actually need it', () => {
    // Guards the guard: if a listed file gets cleaned up without removing it
    // here, this fails loudly instead of the allowlist silently rotting into
    // cover for a fresh violation in that file.
    for (const file of ALLOWLISTED_PRE_EXISTING_VIOLATIONS) {
      const src = readFileSync(join(STORE_DIR, file), 'utf8')
      expect(stripComments(src), `${file} is allowlisted but no longer contains an em-dash — remove it from the allowlist`).toContain('—')
    }
  })
})
