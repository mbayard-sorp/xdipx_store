// SYNC: this file must stay byte-identical across these two locations:
//   - app/lib/tts-normalize.ts
//   - ivr/src/tts-normalize.ts
// Checked by scripts/check-tts-normalize-sync.ts. The ivr/ Fly.io deploy
// ships from its own directory and cannot import from app/, so we mirror.
//
// normalizeForTTS — prepares authored or Claude-generated strings for a
// text-to-speech engine (Polly, ElevenLabs). The goal is for every character
// that reaches the TTS to either (a) get verbalized as a word or (b) affect
// prosody. Stray punctuation, markdown, emoji, and URLs otherwise get read
// aloud as "dot", "comma", "asterisk" by one engine or another.
//
// Pure function, zero deps, no side effects — safe to import from server or
// client code.

// Covers pictographs, emoji modifiers (skin tone), variation selectors
// (U+FE0F), and ZWJ (U+200D) so compound emoji like ❤️ don't leave a
// trailing variation-selector character behind after stripping the base.
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu

// URL rule: only matches known TLDs, word-bounded, lowercase. This is the
// single most dangerous rewrite — SKUs like "MX.20.store" or copy like
// "node.js is fine" can look URL-ish. Keep the TLD list tight.
const URL_RE = /\b([a-z][a-z0-9-]{1,40})\.(com|net|org|io|co|shop|store|app)\b/gi

// Brand-specific pronunciations. Normalizer output for `xdipx.com` is
// `ex-dip-ex dot com`, which then has its word-internal hyphens converted
// to spaces → `ex dip ex dot com`. This is Polly/ElevenLabs friendly.
const PRONUNCIATIONS: Record<string, string> = {
  xdipx: 'ex-dip-ex',
}

function spokenHost(host: string): string {
  const lower = host.toLowerCase()
  if (PRONUNCIATIONS[lower]) return PRONUNCIATIONS[lower]!
  // Fallback: spell the host out letter-by-letter. "example" → "e x a m p l e"
  return host.split('').join(' ')
}

export function normalizeForTTS(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)

  // 1. Unicode normalize + strip emoji / non-speakable pictographs.
  s = s.normalize('NFKC').replace(EMOJI_RE, '')

  // 2. Markdown markers (existing behavior from stripForTTS).
  s = s.replace(/[*_`~#]+/g, '')

  // 3. Smart punctuation → plain. Em/en dash becomes comma-pause so speech
  // doesn't slam words together where an author intended a pause.
  s = s
    .replace(/[\u201C\u201D\u2018\u2019\u00AB\u00BB]/g, '')
    .replace(/[\u2014\u2013]/g, ', ')
    .replace(/\u2026/g, '...')

  // 4. URL-ish tokens → spoken form. Must happen BEFORE we strip brackets or
  // collapse punctuation so word boundaries still work.
  s = s.replace(URL_RE, (_m, host: string, tld: string) => `${spokenHost(host)} dot ${tld.toLowerCase()}`)

  // 5. Remove quotes and brackets — TTS engines often verbalize them.
  s = s.replace(/["()[\]{}<>]/g, ' ')

  // 6. Collapse repeated/mixed punctuation.
  //    `....` → `...` (ellipsis pause preserved), `..,` → `,`, `..` → `.`,
  //    `!!!` → `!`, `???` → `?`, `?!?` → `?!`.
  s = s
    .replace(/[.,]{2,}/g, (m) => {
      if (m.includes(',')) return ','
      return m.length >= 3 ? '...' : '.'
    })
    .replace(/([;:!?])\1+/g, '$1')
    .replace(/[?!]{2,}/g, (m) => (m.includes('?') && m.includes('!') ? '?!' : m[0]!))

  // 7. Strip leading orphan punctuation + collapse space-before-punctuation
  //    (" , hello" → "hello"; "word ," → "word,").
  s = s
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?\-]+/, '')

  // 8. Word-internal hyphen → space. Better cadence in Polly/ElevenLabs and
  //    makes PRONUNCIATIONS like "ex-dip-ex" sound natural.
  s = s.replace(/(\w)-(\w)/g, '$1 $2')

  // 9. Whitespace normalize + trim.
  s = s.replace(/\s+/g, ' ').trim()

  return s
}
