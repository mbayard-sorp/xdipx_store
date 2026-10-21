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
  it.each(componentFiles())(
    '%s has no em-dash in customer-facing source text',
    (file) => {
      const src = readFileSync(join(STORE_DIR, file), 'utf8')
      const stripped = stripComments(src)
      expect(stripped).not.toContain('—')
    },
  )
})
