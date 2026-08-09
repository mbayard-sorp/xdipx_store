/**
 * elevenlabs.server.ts
 *
 * ElevenLabs API client — voiceover (TTS), sound effects, and music generation.
 * All three return raw audio buffers (mp3).
 */

const API_BASE = 'https://api.elevenlabs.io/v1'
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb' // ElevenLabs "George" — warm male narrator

// ─── Types ──────────────────────────────────────────────────────────────────

export type AudioType = 'voiceover' | 'sfx' | 'music'

export interface VoiceoverOptions {
  text: string
  voiceId?: string
  /**
   * Optional delivery tone (team-keys VIDEO_TONES). Routes this ONE request to
   * eleven_v3 with a leading audio tag ("[warm] ..."); multilingual_v2 (the
   * store voice's default model) does not support tags. On any error with tone
   * set, the call retries once tone-less on the default model — a video ships
   * without tone rather than failing.
   */
  tone?: string
}

export interface SoundEffectOptions {
  prompt: string
  durationSeconds?: number
}

export interface MusicOptions {
  prompt: string
  durationMs: number
  instrumental?: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env['ELEVENLABS_API_KEY']
  if (!key) throw new Error('ELEVENLABS_API_KEY environment variable is not set')
  return key
}

function getVoiceId(): string {
  return process.env['ELEVENLABS_VOICE_ID'] || DEFAULT_VOICE_ID
}

async function parseElevenLabsError(res: Response): Promise<string> {
  try {
    const data = await res.json() as Record<string, unknown>
    const detail = data.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') {
      const d = detail as Record<string, unknown>
      return (d.message ?? d.status ?? JSON.stringify(detail)) as string
    }
    return data.message as string ?? JSON.stringify(data)
  } catch {
    return `ElevenLabs API error ${res.status}`
  }
}

// ─── Voiceover (Text-to-Speech) ─────────────────────────────────────────────

const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2'
/** Audio-tag-capable model used only when a tone is requested. */
const TONED_TTS_MODEL = 'eleven_v3'

function ttsRequestBody(opts: VoiceoverOptions, withTone: boolean): { text: string; model_id: string } {
  if (withTone && opts.tone) {
    return { text: `[${opts.tone}] ${opts.text}`, model_id: TONED_TTS_MODEL }
  }
  return { text: opts.text, model_id: DEFAULT_TTS_MODEL }
}

export async function generateVoiceover(opts: VoiceoverOptions): Promise<Buffer> {
  const voiceId = opts.voiceId || getVoiceId()

  const request = async (withTone: boolean): Promise<Buffer> => {
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': getApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsRequestBody(opts, withTone)),
    })
    if (!res.ok) throw new Error(await parseElevenLabsError(res))
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) throw new Error('ElevenLabs TTS returned empty audio')
    return Buffer.from(buf)
  }

  if (opts.tone) {
    try {
      return await request(true)
    } catch (err) {
      console.warn('[elevenlabs] toned TTS failed, retrying tone-less:', err instanceof Error ? err.message.slice(0, 200) : err)
    }
  }
  return request(false)
}

/** with-timestamps alignment shape (parallel per-character arrays). */
export interface TtsCharAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export interface VoiceoverWithTimestamps {
  audio: Buffer
  /** Null when the response carried no usable alignment — callers fall back to char-proportional timing. */
  alignment: TtsCharAlignment | null
}

/**
 * TTS via /with-timestamps: same audio as generateVoiceover plus the character
 * alignment the caption burn converts to word timings (caption-timing.ts).
 * Tone handling mirrors generateVoiceover (v3 + tag, tone-less retry).
 */
export async function generateVoiceoverWithTimestamps(opts: VoiceoverOptions): Promise<VoiceoverWithTimestamps> {
  const voiceId = opts.voiceId || getVoiceId()

  const request = async (withTone: boolean): Promise<VoiceoverWithTimestamps> => {
    const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': getApiKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsRequestBody(opts, withTone)),
    })
    if (!res.ok) throw new Error(await parseElevenLabsError(res))
    const json = await res.json() as {
      audio_base64?: string
      alignment?: TtsCharAlignment | null
      normalized_alignment?: TtsCharAlignment | null
    }
    if (!json.audio_base64) throw new Error('ElevenLabs with-timestamps returned no audio')
    const audio = Buffer.from(json.audio_base64, 'base64')
    if (!audio.length) throw new Error('ElevenLabs with-timestamps returned empty audio')
    const a = json.normalized_alignment ?? json.alignment ?? null
    const alignment = a && Array.isArray(a.characters) && a.characters.length ? a : null
    return { audio, alignment }
  }

  if (opts.tone) {
    try {
      return await request(true)
    } catch (err) {
      console.warn('[elevenlabs] toned TTS (timestamps) failed, retrying tone-less:', err instanceof Error ? err.message.slice(0, 200) : err)
    }
  }
  return request(false)
}

// ─── Sound Effects ──────────────────────────────────────────────────────────

export async function generateSoundEffect(opts: SoundEffectOptions): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: opts.prompt,
    model_id: 'eleven_text_to_sound_v2',
    prompt_influence: 0.3,
  }
  if (opts.durationSeconds) body.duration_seconds = opts.durationSeconds

  const res = await fetch(`${API_BASE}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(await parseElevenLabsError(res))
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new Error('ElevenLabs SFX returned empty audio')
  return Buffer.from(buf)
}

// ─── Music Generation ───────────────────────────────────────────────────────

export async function generateMusic(opts: MusicOptions): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      music_length_ms: opts.durationMs,
      model_id: 'music_v1',
      force_instrumental: opts.instrumental ?? true,
    }),
  })

  if (!res.ok) throw new Error(await parseElevenLabsError(res))
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new Error('ElevenLabs Music returned empty audio')
  return Buffer.from(buf)
}
