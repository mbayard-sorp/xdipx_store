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

export async function generateVoiceover(opts: VoiceoverOptions): Promise<Buffer> {
  const voiceId = opts.voiceId || getVoiceId()

  const res = await fetch(`${API_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: 'eleven_multilingual_v2',
    }),
  })

  if (!res.ok) throw new Error(await parseElevenLabsError(res))
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new Error('ElevenLabs TTS returned empty audio')
  return Buffer.from(buf)
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
