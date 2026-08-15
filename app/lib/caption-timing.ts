/**
 * Pure word-timing math for the caption burn — converts ElevenLabs
 * with-timestamps character alignment into word timings and groups them into
 * caption cues. No server imports so it unit-tests standalone
 * (caption-timing.test.ts), mirroring avatar-script.ts.
 *
 * The converter strips bracketed audio-tag tokens ([warm], [playful], ...):
 * eleven_v3 tone tags are control tokens, not spoken words, and whether the
 * API includes their characters in the alignment is a live-API unknown —
 * stripping defensively covers both shapes.
 */

export interface WordTiming {
  word: string
  start: number
  end: number
}

/** ElevenLabs with-timestamps alignment: parallel per-character arrays. */
export interface CharAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

/**
 * Collapse a character alignment into word timings. Whitespace delimits words;
 * punctuation stays attached to its word. `offsetSeconds` shifts every timing,
 * for split avatar parts whose audio concatenates after earlier parts.
 */
export function charAlignmentToWordTimings(a: CharAlignment, offsetSeconds = 0): WordTiming[] {
  const out: WordTiming[] = []
  let word = ''
  let start = 0
  let end = 0
  const flush = () => {
    const cleaned = word.trim()
    word = ''
    if (!cleaned) return
    // Drop pure audio-tag tokens like "[warm]" (possibly with trailing punct).
    if (/^\[[^\]]*\]$/.test(cleaned)) return
    out.push({ word: cleaned, start: start + offsetSeconds, end: end + offsetSeconds })
  }
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i] ?? ''
    const s = a.character_start_times_seconds[i]
    const e = a.character_end_times_seconds[i]
    if (/\s/.test(ch)) {
      flush()
      continue
    }
    if (!word) start = typeof s === 'number' ? s : end
    word += ch
    if (typeof e === 'number') end = e
  }
  flush()
  return out
}

export interface CaptionCue {
  text: string
  start: number
  end: number
}

/**
 * Group word timings into caption-sized cues (same ~42-char target as
 * avatar-script's captionPhrases). Cue start = first word's start, cue end =
 * last word's end, so the burn shows each phrase exactly while it is spoken.
 */
export function groupWordTimingsIntoCues(timings: WordTiming[], maxChars = 42): CaptionCue[] {
  const cues: CaptionCue[] = []
  let words: WordTiming[] = []
  let len = 0
  const flush = () => {
    if (!words.length) return
    cues.push({
      text: words.map(w => w.word).join(' '),
      start: words[0]!.start,
      end: words[words.length - 1]!.end,
    })
    words = []
    len = 0
  }
  for (const w of timings) {
    const added = words.length ? len + 1 + w.word.length : w.word.length
    if (words.length && added > maxChars) flush()
    words.push(w)
    len = words.length === 1 ? w.word.length : len + 1 + w.word.length
    // Sentence-final punctuation is a natural cue break.
    if (/[.!?…]$/.test(w.word)) flush()
  }
  flush()
  return cues
}
