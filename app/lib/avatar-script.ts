/**
 * Pure avatar-tier script math for the OmniHuman talking-head path. No server
 * imports so the split/estimate logic unit-tests standalone (avatar-script.test.ts)
 * and stays importable from both the pipeline and the team API validators.
 *
 * Ground truth (proven 2026-07-24): OmniHuman rejects input audio over 30s per
 * render (`audio_duration_too_long`). Longer scripts split BEFORE TTS into
 * parts budgeted well under that cap; all parts render from the SAME identity
 * frame and join in assembly where each seam doubles as a punch-in cut.
 */

/** Rough speech rate for the b-roll voiceover paths: ~15 chars of script per spoken second. */
export const TTS_CHARS_PER_SECOND = 15

/**
 * Conservative speech rate for avatar (presenterLine) estimates. Real
 * ElevenLabs reads run ~12-14 chars/s, so estimating at 12 keeps enqueue caps,
 * cost estimates, and split budgets on the safe side of the real-audio guard.
 */
export const AVATAR_TTS_CHARS_PER_SECOND = 12

/** OmniHuman hard cap on input audio length per render, seconds. */
export const OMNIHUMAN_MAX_RENDER_SECONDS = 30

/**
 * Per-part split budget, estimated seconds. Safety margin under the 29.5s
 * real-audio guard so a part that estimates at budget still clears it after
 * real TTS timing.
 */
export const AVATAR_PART_MAX_SECONDS = 24

/**
 * Hard enqueue-time cap on total presenterLine speech length, seconds. This is
 * the approved budget knob (strategy §9.5): the per-video ceiling stays at 600
 * cents and scripts stay short instead. Estimated at the conservative avatar
 * rate, so the char allowance is 35 * 12 = 420.
 */
export const AVATAR_MAX_SPEECH_SECONDS = 35

export function estimateSpeechSeconds(text: string): number {
  return Math.ceil(text.trim().length / TTS_CHARS_PER_SECOND)
}

/** Conservative avatar-tier estimate; use for enqueue caps, avatar cost, and splits. */
export function estimateAvatarSpeechSeconds(text: string): number {
  return Math.ceil(text.trim().length / AVATAR_TTS_CHARS_PER_SECOND)
}

/** Sentence-ish beats, terminal punctuation kept with its sentence. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Split a presenter line for OmniHuman's per-render audio cap. Returns a single
 * part when the estimated read fits the per-part budget; otherwise packs
 * sentences greedily into parts of at most `maxPartSeconds` estimated seconds
 * (at the conservative avatar rate). A single sentence over the budget falls
 * back to comma/clause boundaries, then word boundaries. Never returns a part
 * whose estimate exceeds the budget; part count is whatever the budget needs
 * (with the 35s cap and 24s parts, two in practice).
 */
export function splitPresenterLine(text: string, maxPartSeconds = AVATAR_PART_MAX_SECONDS): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const budgetChars = maxPartSeconds * AVATAR_TTS_CHARS_PER_SECOND
  if (trimmed.length <= budgetChars) return [trimmed]

  // Break into atoms that each fit the budget: sentences, then clauses, then
  // words, then (degenerate single-word overrun) hard character slices.
  const atoms: string[] = []
  const pushAtom = (atom: string) => {
    let rest = atom
    while (rest.length > budgetChars) {
      atoms.push(rest.slice(0, budgetChars))
      rest = rest.slice(budgetChars)
    }
    if (rest) atoms.push(rest)
  }
  for (const sentence of splitSentences(trimmed)) {
    if (sentence.length <= budgetChars) {
      atoms.push(sentence)
      continue
    }
    for (const clause of sentence.split(/(?<=,)\s+/).map(c => c.trim()).filter(Boolean)) {
      if (clause.length <= budgetChars) {
        atoms.push(clause)
        continue
      }
      for (const word of clause.split(/\s+/)) pushAtom(word)
    }
  }

  // Greedy fill: pack atoms into parts without crossing the budget.
  const parts: string[] = []
  let current = ''
  for (const atom of atoms) {
    const joined = current ? `${current} ${atom}` : atom
    if (joined.length <= budgetChars) {
      current = joined
      continue
    }
    if (current) parts.push(current)
    current = atom
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Chunk a spoken line into caption-sized phrases for the assembly burn step.
 * Splits at sentence boundaries, then at commas, then at word boundaries for
 * anything still over `maxChars`. Timing across the video is char-proportional
 * (the proven recipe); ElevenLabs with-timestamps word timing is the designed
 * upgrade and slots in here without changing callers.
 */
export function captionPhrases(text: string, maxChars = 42): string[] {
  const out: string[] = []
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= maxChars) {
      out.push(sentence)
      continue
    }
    for (const clause of sentence.split(/(?<=,)\s+/).map(c => c.trim()).filter(Boolean)) {
      if (clause.length <= maxChars) {
        out.push(clause)
        continue
      }
      // Word-boundary fill for run-on clauses.
      let current = ''
      for (const word of clause.split(/\s+/)) {
        if (current && (current.length + 1 + word.length) > maxChars) {
          out.push(current)
          current = word
        } else {
          current = current ? `${current} ${word}` : word
        }
      }
      if (current) out.push(current)
    }
  }
  return out
}
