/**
 * scripts/audition-cast-voices.ts — TTS-only voice audition for the video
 * pipeline's cast (ticket #6584).
 *
 * No video render, no GPU: renders 2-3 short lines per cast member through
 * ElevenLabs so the owner can compare candidate voices for cents and ratify
 * one per character before it goes on castMember.voiceId. The series bible
 * (docs/store-team/series-bible-the-group-chat.md §3) ties voiceId to the
 * same owner-approval posture as referencePhoto — a likeness decision, not
 * an agent's to make — so this script only renders candidates; it never
 * writes to Sanity.
 *
 * Lines are audition-only placeholder dialogue reflecting each character's
 * speech signature from the series bible. They are never published and never
 * used in a real episode.
 *
 * Usage:
 *   # dry run: shows which cast members have a candidate and which lines render
 *   npx tsx scripts/audition-cast-voices.ts --voice maya=<voiceId> --voice sofia=<voiceId>
 *
 *   # actually call ElevenLabs and save mp3s locally
 *   npx tsx scripts/audition-cast-voices.ts --voice maya=<voiceId> --apply [--out .voice-auditions]
 *
 * After the owner picks a favorite per character, set castMember.voiceId by
 * hand in Studio (or extend scripts/backfill-cast-metadata.ts's patch
 * pattern) — this script never writes to Sanity.
 */

import './_load-env'

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateVoiceover } from '~/lib/elevenlabs.server'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Every occurrence of a repeatable flag, e.g. --voice a=1 --voice b=2. */
function allArgs(name: string): string[] {
  const out: string[] = []
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]!)
  }
  return out
}

/**
 * Two audition-only lines per character, reflecting the series bible's speech
 * signature (docs/store-team/series-bible-the-group-chat.md §3). Never
 * customer-facing copy.
 */
const AUDITION_LINES: Record<string, string[]> = {
  emma: [
    "Hi, I'm Emma. Tell me what you're curious about and I'll help you find it.",
    "Here's what actually matters about this one.",
  ],
  maya: [
    'Come sit, you look like you need a minute and a blanket.',
    'No judgment here. Just tell me what you actually want.',
  ],
  diego: [
    "I was going to play it cool, but okay, this one's my favorite.",
    'Careful, I might convince you.',
  ],
  jade: [
    "Ask the question you're avoiding.",
    "That's the real one, isn't it.",
  ],
  marcus: [
    'I could deflect with a joke here, but the truth is even better.',
    "Take your time, nobody's rushing you.",
  ],
  priya: [
    'Okay wait, we need to talk about this immediately.',
    "That's the whole plot twist right there.",
  ],
  sofia: [
    'Just say what you want. Out loud. No apology.',
    'Wanting it is not the complicated part.',
  ],
  vivian: [
    "Nothing you're about to say will surprise me, sweetheart.",
    'Here is the part nobody tells you.',
  ],
}

interface Candidate {
  slug: string
  voiceId: string
}

function parseCandidates(pairs: string[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) {
      process.stderr.write(`SKIP: malformed --voice "${pair}", expected slug=voiceId\n`)
      continue
    }
    const slug = pair.slice(0, eq)
    const voiceId = pair.slice(eq + 1)
    if (!AUDITION_LINES[slug]) {
      process.stderr.write(`SKIP: unknown cast slug "${slug}" (known: ${Object.keys(AUDITION_LINES).join(', ')})\n`)
      continue
    }
    if (!voiceId) {
      process.stderr.write(`SKIP: "${pair}" has no voiceId after "="\n`)
      continue
    }
    candidates.push({ slug, voiceId })
  }
  return candidates
}

async function main(): Promise<number> {
  const apply = hasFlag('apply')
  const outDir = arg('out') ?? '.voice-auditions'
  const pairs = allArgs('voice')

  if (pairs.length === 0) {
    process.stderr.write(
      'No --voice slug=voiceId pairs given. Usage:\n' +
      '  npx tsx scripts/audition-cast-voices.ts --voice maya=<elevenLabsVoiceId> [--voice sofia=<id> ...] [--apply] [--out <dir>]\n' +
      `Known cast slugs: ${Object.keys(AUDITION_LINES).join(', ')}\n`,
    )
    return 0
  }

  const candidates = parseCandidates(pairs)
  if (candidates.length === 0) {
    process.stderr.write('Nothing to audition — every --voice pair was skipped.\n')
    return 2
  }

  if (!apply) {
    process.stdout.write('DRY RUN — pass --apply to actually call ElevenLabs.\n\n')
    for (const { slug, voiceId } of candidates) {
      process.stdout.write(`${slug} -> voice ${voiceId}\n`)
      for (const line of AUDITION_LINES[slug]!) process.stdout.write(`  "${line}"\n`)
    }
    return 0
  }

  mkdirSync(resolve(outDir), { recursive: true })
  let rendered = 0
  for (const { slug, voiceId } of candidates) {
    for (const [i, line] of AUDITION_LINES[slug]!.entries()) {
      const audio = await generateVoiceover({ text: line, voiceId })
      const path = resolve(outDir, `${slug}-${voiceId}-${i}.mp3`)
      writeFileSync(path, audio)
      process.stdout.write(`wrote ${path}\n`)
      rendered++
    }
  }
  process.stdout.write(
    `\nRendered ${rendered} clip(s) to ${resolve(outDir)}. Listen, then set the chosen voiceId on each ` +
    'castMember doc in Studio.\n',
  )
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`)
    process.exit(2)
  },
)
