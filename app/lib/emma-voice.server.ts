/**
 * Runtime source of truth for the xdipx brand voice. Loads `docs/emma-voice.md`
 * (the canonical voice charter) at module init and slices it into the CORE
 * block plus per-channel compositions.
 *
 * Every prompt in the app that writes customer-facing (or team-facing, in
 * Emma's own words) copy should import from here instead of re-stating voice
 * rules inline. If the charter changes, every surface picks it up on next
 * deploy with no prompt-file edits.
 *
 * Reads via `fs`, not a Vite `?raw` import: `scripts/build-vercel.mjs` bundles
 * `server/index.ts` (which pulls this file in transitively) with a standalone
 * esbuild pass that has no loader for `?raw`, so the import must survive both
 * the Vite SSR build and that raw esbuild pass. `docs/**` is whitelisted in
 * `vercel.json`'s `includeFiles` so this resolves at runtime in production too.
 *
 * Non-Node-fs consumers (evals harness, the standalone `ivr/` package,
 * one-off `tsx` scripts run from a different cwd) have their own copy or fs
 * read — see the header comments in `evals/judge/prompt.ts` and
 * `ivr/src/emma-note.ts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The bundle location varies by build: app/lib/ in source and the Vite SSR
// build, server/ in the standalone esbuild vercel-entry bundle (where a
// __dirname-relative '../../docs' escapes /var/task and lands on the
// nonexistent /var/docs). process.cwd() is the repo root locally and
// /var/task on Vercel, where includeFiles places docs/ — so it goes first.
const CHARTER_CANDIDATES = [
  resolve(process.cwd(), 'docs/emma-voice.md'),
  resolve(__dirname, '../../docs/emma-voice.md'),
  resolve(__dirname, '../docs/emma-voice.md'),
]
const charterPath = CHARTER_CANDIDATES.find(p => existsSync(p))
if (!charterPath) {
  throw new Error(`emma-voice.server: docs/emma-voice.md not found; tried ${CHARTER_CANDIDATES.join(', ')}`)
}
const charter = readFileSync(charterPath, 'utf-8')

function slice(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`emma-voice.server: missing marker pair ${startMarker} / ${endMarker} in docs/emma-voice.md`)
  }
  return text.slice(start + startMarker.length, end).trim()
}

/** The always-on voice rules: what xdipx is, Emma's placement, hard rules, trust canon. */
export const EMMA_VOICE_CORE = slice(charter, '<!-- core:start -->', '<!-- core:end -->')

const MARKETING_ADDENDUM      = slice(charter, '<!-- addendum:marketing:start -->', '<!-- addendum:marketing:end -->')
const ENRICHMENT_ADDENDUM     = slice(charter, '<!-- addendum:enrichment:start -->', '<!-- addendum:enrichment:end -->')
const CONVERSATIONAL_ADDENDUM = slice(charter, '<!-- addendum:conversational:start -->', '<!-- addendum:conversational:end -->')
const SUPPORT_ADDENDUM        = slice(charter, '<!-- addendum:support:start -->', '<!-- addendum:support:end -->')
const VIDEO_ADDENDUM          = slice(charter, '<!-- addendum:video:start -->', '<!-- addendum:video:end -->')
const SOCIAL_ADDENDUM         = slice(charter, '<!-- addendum:social:start -->', '<!-- addendum:social:end -->')

/** CORE + the marketing/advertising addendum (site, email, ads, themed calendar copy). */
export const EMMA_VOICE_MARKETING = `${EMMA_VOICE_CORE}\n\n${MARKETING_ADDENDUM}`

/** CORE + the product enrichment / SEO addendum. */
export const EMMA_VOICE_ENRICHMENT = `${EMMA_VOICE_CORE}\n\n${ENRICHMENT_ADDENDUM}`

/** CORE + the conversational addendum (SMS, chat, discovery, IVR). */
export const EMMA_VOICE_CONVERSATIONAL = `${EMMA_VOICE_CORE}\n\n${CONVERSATIONAL_ADDENDUM}`

/** CORE + the support addendum (customer service replies). */
export const EMMA_VOICE_SUPPORT = `${EMMA_VOICE_CORE}\n\n${SUPPORT_ADDENDUM}`

/** CORE + the video addendum (reel/short scripts and their captions; codified 2026-08-16). */
export const EMMA_VOICE_VIDEO = `${EMMA_VOICE_CORE}\n\n${VIDEO_ADDENDUM}`

/** CORE + the social addendum (Instagram/TikTok/X organic posts; migration 084). */
export const EMMA_VOICE_SOCIAL = `${EMMA_VOICE_CORE}\n\n${SOCIAL_ADDENDUM}`

/** The full charter text, unsliced, for callers that want everything (e.g. an eval judge). */
export const EMMA_VOICE_FULL = charter
