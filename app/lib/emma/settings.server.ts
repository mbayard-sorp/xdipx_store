/**
 * Admin-controlled chat settings. Shares the brand-voice row with the IVR
 * (pipeline_settings.brandVoice) so brand-voice edits propagate to both
 * channels automatically. Chat-only keys are namespaced with `chat*`.
 *
 * Falls back to code defaults on DB outage or unset keys so a fresh
 * environment can still run the chat.
 */
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../../db/schema'
import { inArray } from 'drizzle-orm'

export const DEFAULT_BRAND_VOICE =
  `Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. ` +
  `Write as a trusted, funny friend who isn't embarrassed about the topic. ` +
  `Your goal is to welcome first-time buyers and delight experienced ones. ` +
  `Keep all copy tasteful — suggestive is fine, explicit is not. ` +
  `Always signal discretion, value, and trust. ` +
  `Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness". ` +
  `Never assume the reader's experience level.`

export const DEFAULT_CHAT_GREETING =
  "Hey — I'm Emma. I help folks find their perfect thing on xdipx. What brings you in today?"

export const DEFAULT_CHAT_GOODBYE =
  "Thanks for chatting with xdipx — come back tomorrow for a fresh deal. ♥"

export const ALL_CHAT_TOOLS = [
  'readTodaysDeal',
  'searchProducts',
  'discoverProducts',
  'recommendSimilar',
  'getProductDetails',
  'listCollections',
  'lookupReturningCustomer',
  'lookupOrder',
  'createDraftOrder',
  'sendDealLinkSMS',
] as const

export type ChatToolName = (typeof ALL_CHAT_TOOLS)[number]

export interface ChatSettings {
  brandVoice: string
  greeting: string
  goodbye: string
  enabledTools: ChatToolName[]
  /** Max user turns before auto-wrap-up. */
  maxTurns: number
  /** Soft token budget — once crossed, wrap-up hint is injected. */
  softTokenBudget: number
  /** Idle ms before server auto-closes the session. */
  idleMs: number
}

const KEYS = [
  'brandVoice',
  'chatGreeting',
  'chatGoodbye',
  'chatEnabledTools',
  'chatMaxTurns',
  'chatSoftTokenBudget',
  'chatIdleMs',
] as const

function parseEnabledTools(raw: string | undefined): ChatToolName[] {
  if (!raw) return [...ALL_CHAT_TOOLS]
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...ALL_CHAT_TOOLS]
    const allowed = new Set(ALL_CHAT_TOOLS)
    return parsed.filter((t): t is ChatToolName => typeof t === 'string' && allowed.has(t as ChatToolName))
  } catch {
    return [...ALL_CHAT_TOOLS]
  }
}

export async function loadChatSettings(): Promise<ChatSettings> {
  const fallback: ChatSettings = {
    brandVoice: DEFAULT_BRAND_VOICE,
    greeting: DEFAULT_CHAT_GREETING,
    goodbye: DEFAULT_CHAT_GOODBYE,
    enabledTools: [...ALL_CHAT_TOOLS],
    maxTurns: 40,
    softTokenBudget: 40_000,
    idleMs: 15 * 60 * 1000,
  }

  try {
    const rows = await db
      .select()
      .from(pipelineSettings)
      .where(inArray(pipelineSettings.key, KEYS as unknown as string[]))

    const map = new Map<string, string>()
    for (const row of rows) map.set(row.key, row.value)

    return {
      brandVoice: map.get('brandVoice') || fallback.brandVoice,
      greeting: map.get('chatGreeting') || fallback.greeting,
      goodbye: map.get('chatGoodbye') || fallback.goodbye,
      enabledTools: parseEnabledTools(map.get('chatEnabledTools')),
      maxTurns: Number(map.get('chatMaxTurns')) || fallback.maxTurns,
      softTokenBudget: Number(map.get('chatSoftTokenBudget')) || fallback.softTokenBudget,
      idleMs: Number(map.get('chatIdleMs')) || fallback.idleMs,
    }
  } catch (err) {
    console.warn('[emma/chat] loadChatSettings failed, using fallbacks', err)
    return fallback
  }
}
