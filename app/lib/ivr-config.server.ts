/**
 * IVR runtime config accessor.
 *
 * Resolution priority for each key: pipelineSettings row → env var → hardcoded default.
 * Storage in pipeline_settings is human-readable (minutes for durations) so the
 * /admin/voice-and-sms UI can edit values directly. This accessor converts to
 * the units the runtime needs (ms, seconds, hours, sets, etc).
 *
 * One DB query per call, wrapped in withTimeout so a slow Neon never blocks
 * a Twilio webhook past its 15s ceiling.
 */
import { inArray } from 'drizzle-orm'
import { db } from './db.server'
import { pipelineSettings } from '../../db/schema'
import { withTimeout } from './twilio.server'

export const IVR_CONFIG_KEYS = [
  'ivrMaxCallsPerHour',
  'ivrRateLimitAllowlist',
  'smsMaxPerHour',
  'ivrBusinessHours',
  'ivrBusinessTz',
  'ivrInitialSilenceMin',
  'ivrInterTurnSilenceMin',
  'ivrMaxCallDurationMin',
  'voicemailMaxLengthMin',
  'smsHistoryWindowMin',
  'smsHistoryTurns',
  'ivrMaxPrompts',
  'ivrReEngageAttempts',
  'ivrSoftTokenBudget',
] as const

export type IvrConfigKey = (typeof IVR_CONFIG_KEYS)[number]

/**
 * Defaults match current hardcoded behavior at the time this accessor was
 * introduced. Durations stored as minutes (so admin edits in human units);
 * counts/strings as-is.
 */
export const IVR_CONFIG_DEFAULTS: Record<IvrConfigKey, string> = {
  ivrMaxCallsPerHour: '5',
  ivrRateLimitAllowlist: '',
  smsMaxPerHour: '15',
  ivrBusinessHours: '',
  ivrBusinessTz: 'America/Chicago',
  // 25_000 ms = 0.4167 min
  ivrInitialSilenceMin: '0.4167',
  // 20_000 ms = 0.3333 min
  ivrInterTurnSilenceMin: '0.3333',
  ivrMaxCallDurationMin: '15',
  voicemailMaxLengthMin: '2',
  // 24h = 1440 min
  smsHistoryWindowMin: '1440',
  smsHistoryTurns: '10',
  ivrMaxPrompts: '60',
  ivrReEngageAttempts: '2',
  ivrSoftTokenBudget: '40000',
}

/**
 * Map from config key to its env-var override. Env still wins over hardcoded
 * defaults so existing deploys don't change behavior on rollout. DB always
 * wins over both.
 */
const ENV_OVERRIDES: Record<IvrConfigKey, string | undefined> = {
  ivrMaxCallsPerHour: 'IVR_MAX_CALLS_PER_HOUR',
  ivrRateLimitAllowlist: 'IVR_RATE_LIMIT_ALLOWLIST',
  smsMaxPerHour: 'SMS_MAX_PER_HOUR',
  ivrBusinessHours: 'IVR_BUSINESS_HOURS',
  ivrBusinessTz: 'IVR_BUSINESS_TZ',
  ivrInitialSilenceMin: undefined,
  ivrInterTurnSilenceMin: undefined,
  ivrMaxCallDurationMin: undefined,
  voicemailMaxLengthMin: undefined,
  smsHistoryWindowMin: undefined,
  smsHistoryTurns: undefined,
  ivrMaxPrompts: undefined,
  ivrReEngageAttempts: undefined,
  ivrSoftTokenBudget: undefined,
}

/** Legacy ms-based env vars kept as a secondary fallback for the duration keys. */
function legacyDurationEnv(key: IvrConfigKey): number | null {
  const map: Partial<Record<IvrConfigKey, string>> = {
    ivrInitialSilenceMin: 'IVR_INITIAL_SILENCE_MS',
    ivrInterTurnSilenceMin: 'IVR_INTER_TURN_SILENCE_MS',
    ivrMaxCallDurationMin: 'IVR_MAX_CALL_DURATION_MS',
    ivrMaxPrompts: 'IVR_MAX_PROMPTS',
    ivrReEngageAttempts: 'IVR_RE_ENGAGE_ATTEMPTS',
    ivrSoftTokenBudget: 'IVR_SOFT_TOKEN_BUDGET',
  }
  const envName = map[key]
  if (!envName) return null
  const raw = process.env[envName]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export type IvrConfig = {
  maxCallsPerHour: number
  rateLimitAllowlist: Set<string>
  smsMaxPerHour: number
  businessHours: string
  businessTz: string
  initialSilenceMs: number
  interTurnSilenceMs: number
  maxCallDurationMs: number
  voicemailMaxLengthSec: number
  smsHistoryWindowHours: number
  smsHistoryTurns: number
  maxPrompts: number
  reEngageAttempts: number
  softTokenBudget: number
}

function resolveRaw(rows: Map<string, string | null>, key: IvrConfigKey): string {
  const fromDb = rows.get(key)
  if (fromDb != null && fromDb !== '') return fromDb
  const envName = ENV_OVERRIDES[key]
  if (envName) {
    const fromEnv = process.env[envName]
    if (fromEnv != null && fromEnv !== '') return fromEnv
  }
  return IVR_CONFIG_DEFAULTS[key]
}

function num(s: string, fallback: number): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

// Legacy *_MS env fallback lives at the call sites in getIvrConfig (a missing
// DB row falls back to legacyDurationEnv). This function only converts an
// admin-entered minutes value.
function minutesToMs(s: string, key: IvrConfigKey): number {
  const minutes = Number(s)
  if (!Number.isFinite(minutes)) return Number(IVR_CONFIG_DEFAULTS[key]) * 60_000
  return Math.round(minutes * 60_000)
}

export type IvrConfigSource = 'db' | 'env' | 'default'
export type IvrConfigDiagnosticRow = {
  key: IvrConfigKey
  value: string
  source: IvrConfigSource
  envName: string | null
}

/**
 * For the admin "current effective values" panel — returns each setting's
 * resolved string value plus where it came from. Mirrors getIvrConfig()
 * resolution order but without unit conversion.
 */
export async function getIvrConfigDiagnostic(): Promise<IvrConfigDiagnosticRow[]> {
  let rowMap = new Map<string, string | null>()
  try {
    const rows = await withTimeout(
      db
        .select({ key: pipelineSettings.key, value: pipelineSettings.value })
        .from(pipelineSettings)
        .where(inArray(pipelineSettings.key, IVR_CONFIG_KEYS as unknown as string[])),
      2000,
      [] as { key: string; value: string | null }[],
      'getIvrConfigDiagnostic',
    )
    rowMap = new Map(rows.map((r) => [r.key, r.value]))
  } catch (err) {
    console.error('[ivr-config] diagnostic DB load failed', err)
  }

  return IVR_CONFIG_KEYS.map((key) => {
    const dbVal = rowMap.get(key)
    if (dbVal != null && dbVal !== '') {
      return { key, value: dbVal, source: 'db' as const, envName: ENV_OVERRIDES[key] ?? null }
    }
    const envName = ENV_OVERRIDES[key]
    if (envName) {
      const envVal = process.env[envName]
      if (envVal != null && envVal !== '') {
        return { key, value: envVal, source: 'env' as const, envName }
      }
    }
    return { key, value: IVR_CONFIG_DEFAULTS[key], source: 'default' as const, envName: envName ?? null }
  })
}

export async function getIvrConfig(): Promise<IvrConfig> {
  let rowMap = new Map<string, string | null>()
  try {
    const rows = await withTimeout(
      db
        .select({ key: pipelineSettings.key, value: pipelineSettings.value })
        .from(pipelineSettings)
        .where(inArray(pipelineSettings.key, IVR_CONFIG_KEYS as unknown as string[])),
      2000,
      [] as { key: string; value: string | null }[],
      'getIvrConfig',
    )
    rowMap = new Map(rows.map((r) => [r.key, r.value]))
  } catch (err) {
    console.error('[ivr-config] DB load failed — using env+defaults', err)
  }

  // Durations: DB stores minutes, but we still honor legacy *_MS env vars when
  // no DB row is set so production keeps working unchanged on rollout.
  const initialMinRaw = rowMap.get('ivrInitialSilenceMin')
  const interTurnMinRaw = rowMap.get('ivrInterTurnSilenceMin')
  const maxDurationMinRaw = rowMap.get('ivrMaxCallDurationMin')
  const maxPromptsRaw = rowMap.get('ivrMaxPrompts')
  const reEngageRaw = rowMap.get('ivrReEngageAttempts')
  const softBudgetRaw = rowMap.get('ivrSoftTokenBudget')

  const initialSilenceMs =
    initialMinRaw != null && initialMinRaw !== ''
      ? minutesToMs(initialMinRaw, 'ivrInitialSilenceMin')
      : (legacyDurationEnv('ivrInitialSilenceMin') ?? 25_000)
  const interTurnSilenceMs =
    interTurnMinRaw != null && interTurnMinRaw !== ''
      ? minutesToMs(interTurnMinRaw, 'ivrInterTurnSilenceMin')
      : (legacyDurationEnv('ivrInterTurnSilenceMin') ?? 20_000)
  const maxCallDurationMs =
    maxDurationMinRaw != null && maxDurationMinRaw !== ''
      ? minutesToMs(maxDurationMinRaw, 'ivrMaxCallDurationMin')
      : (legacyDurationEnv('ivrMaxCallDurationMin') ?? 900_000)
  const maxPrompts =
    maxPromptsRaw != null && maxPromptsRaw !== ''
      ? num(maxPromptsRaw, 60)
      : (legacyDurationEnv('ivrMaxPrompts') ?? 60)
  const reEngageAttempts =
    reEngageRaw != null && reEngageRaw !== ''
      ? num(reEngageRaw, 2)
      : (legacyDurationEnv('ivrReEngageAttempts') ?? 2)
  const softTokenBudget =
    softBudgetRaw != null && softBudgetRaw !== ''
      ? num(softBudgetRaw, 40_000)
      : (legacyDurationEnv('ivrSoftTokenBudget') ?? 40_000)

  const voicemailMin = num(resolveRaw(rowMap, 'voicemailMaxLengthMin'), 2)
  const smsHistoryMin = num(resolveRaw(rowMap, 'smsHistoryWindowMin'), 1440)

  const allowlistRaw = resolveRaw(rowMap, 'ivrRateLimitAllowlist')
  const rateLimitAllowlist = new Set(
    allowlistRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

  return {
    maxCallsPerHour: num(resolveRaw(rowMap, 'ivrMaxCallsPerHour'), 5),
    rateLimitAllowlist,
    smsMaxPerHour: num(resolveRaw(rowMap, 'smsMaxPerHour'), 15),
    businessHours: resolveRaw(rowMap, 'ivrBusinessHours'),
    businessTz: resolveRaw(rowMap, 'ivrBusinessTz') || 'America/Chicago',
    initialSilenceMs,
    interTurnSilenceMs,
    maxCallDurationMs,
    voicemailMaxLengthSec: Math.round(voicemailMin * 60),
    smsHistoryWindowHours: smsHistoryMin / 60,
    smsHistoryTurns: num(resolveRaw(rowMap, 'smsHistoryTurns'), 10),
    maxPrompts,
    reEngageAttempts,
    softTokenBudget,
  }
}
