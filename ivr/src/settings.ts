/**
 * Admin-controlled IVR settings. Fetched from pipeline_settings at session
 * start and cached on the Session. Each key has a hardcoded fallback so a DB
 * outage (or an unconfigured fresh environment) can't strand the IVR.
 *
 * Mirrors defaults in app/routes/admin.settings.tsx — keep them in sync.
 */
import { neon } from '@neondatabase/serverless'

const url = process.env['DATABASE_URL']
const sql = neon(url ?? '')

export const DEFAULT_BRAND_VOICE =
  `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. ` +
  `Write as a trusted, funny friend who isn't embarrassed about the topic. ` +
  `Your goal is to welcome first-time buyers and delight experienced ones. ` +
  `Keep all copy tasteful — suggestive is fine, explicit is not. ` +
  `Always signal discretion, value, and trust. ` +
  `Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness". ` +
  `Never assume the reader's experience level.`

export const DEFAULT_FAREWELL_MAX_PROMPTS =
  "I really like you — but it might be easier if you send an email to hello at exdipex dot com and we can help you directly. Once again that's hello at exdipex dot com."
export const DEFAULT_FAREWELL_MAX_DURATION = DEFAULT_FAREWELL_MAX_PROMPTS
export const DEFAULT_FAREWELL_SILENT = ''

export interface IvrSettings {
  brandVoice: string
  farewellMaxPrompts: string
  farewellMaxDuration: string
  /** Empty string = don't speak anything before hangup. */
  farewellSilent: string
}

const KEYS = [
  'brandVoice',
  'ivrFarewellMaxPrompts',
  'ivrFarewellMaxDuration',
  'ivrFarewellSilent',
] as const

export async function loadIvrSettings(): Promise<IvrSettings> {
  const fallback: IvrSettings = {
    brandVoice: DEFAULT_BRAND_VOICE,
    farewellMaxPrompts: DEFAULT_FAREWELL_MAX_PROMPTS,
    farewellMaxDuration: DEFAULT_FAREWELL_MAX_DURATION,
    farewellSilent: DEFAULT_FAREWELL_SILENT,
  }
  if (!url) return fallback

  try {
    const rows = (await sql(
      `SELECT key, value FROM pipeline_settings WHERE key = ANY($1)`,
      [KEYS as unknown as string[]],
    )) as Array<{ key: string; value: string }>

    const map = new Map<string, string>()
    for (const row of rows) map.set(row.key, row.value)

    return {
      brandVoice:           map.get('brandVoice')             || fallback.brandVoice,
      farewellMaxPrompts:   map.get('ivrFarewellMaxPrompts')  || fallback.farewellMaxPrompts,
      farewellMaxDuration:  map.get('ivrFarewellMaxDuration') || fallback.farewellMaxDuration,
      // Silent caller is allowed to be empty — only admins unset it on purpose.
      farewellSilent:       map.get('ivrFarewellSilent') ?? fallback.farewellSilent,
    }
  } catch (err) {
    console.warn('[ivr] loadIvrSettings failed, using fallbacks', err)
    return fallback
  }
}
