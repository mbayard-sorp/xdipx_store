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

export const DEFAULT_GREETING =
  "Hey, you've reached ex-dip-ex. I'm {feeling} you called. This call may be recorded. What's going on?"
export const DEFAULT_FEELINGS = 'so happy,thrilled,super excited,really glad,pumped,stoked,delighted'
export const DEFAULT_ACTIVITIES = "browsing the vault,curating today's deal,testing out some new arrivals,organizing the stockroom"

export const DEFAULT_FAREWELL_GOODBYE = "Thanks for calling ex-dip-ex — have a great one!"
export const DEFAULT_FAREWELL_MAX_PROMPTS =
  "I really like you — but it might be easier if you send an email to hello at exdipex dot com and we can help you directly. Once again that's hello at exdipex dot com."
export const DEFAULT_FAREWELL_MAX_DURATION = DEFAULT_FAREWELL_MAX_PROMPTS
export const DEFAULT_FAREWELL_SILENT = ''

export interface IvrSettings {
  brandVoice: string
  /** Resolved greeting text (placeholders already substituted). */
  greeting: string
  /** Happy-path goodbye injected into system prompt. */
  farewellGoodbye: string
  farewellMaxPrompts: string
  farewellMaxDuration: string
  /** Empty string = don't speak anything before hangup. */
  farewellSilent: string
}

const KEYS = [
  'brandVoice',
  'ivrGreeting',
  'ivrFeelings',
  'ivrActivities',
  'ivrFarewellGoodbye',
  'ivrFarewellMaxPrompts',
  'ivrFarewellMaxDuration',
  'ivrFarewellSilent',
] as const

function pickRandom(csv: string, fallback: string): string {
  const items = csv.split(',').map(s => s.trim()).filter(Boolean)
  if (!items.length) return fallback
  return items[Math.floor(Math.random() * items.length)]!
}

function resolveGreeting(template: string, feelings: string, activities: string): string {
  const feeling = pickRandom(feelings, 'happy')
  const activity = pickRandom(activities, 'working')
  return template.replace('{feeling}', feeling).replace('{activity}', activity)
}

export async function loadIvrSettings(): Promise<IvrSettings> {
  const fallback: IvrSettings = {
    brandVoice: DEFAULT_BRAND_VOICE,
    greeting: resolveGreeting(DEFAULT_GREETING, DEFAULT_FEELINGS, DEFAULT_ACTIVITIES),
    farewellGoodbye: DEFAULT_FAREWELL_GOODBYE,
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
      greeting: resolveGreeting(
        map.get('ivrGreeting') || DEFAULT_GREETING,
        map.get('ivrFeelings') || DEFAULT_FEELINGS,
        map.get('ivrActivities') || DEFAULT_ACTIVITIES,
      ),
      farewellGoodbye:      map.get('ivrFarewellGoodbye')     || fallback.farewellGoodbye,
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
