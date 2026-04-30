/**
 * tools-by-stage — allowlist of tool names permitted per conversation stage.
 * Phase 6c stub — other phases (6a, 6b, 6d) define stage handlers and
 * populate this with their stage+tool mappings.
 *
 * kbLookup is registered here as a forward ref: every stage that handles
 * customer inquiries may call the knowledge-base lookup tool.
 */

export type SmsStage =
  | 'DISCOVERY'
  | 'RESEARCH'
  | 'PRESENTATION'
  | 'OBJECTION'
  | 'POST_PURCHASE'

/**
 * Tools allowed per stage. kbLookup is a forward ref — implemented in
 * app/lib/sms-v2/tools/kb-lookup.server.ts (Phase 6c).
 * Other phases add their own tools to the relevant stages' arrays.
 */
export const TOOLS_BY_STAGE: Record<SmsStage, string[]> = {
  DISCOVERY:     ['kbLookup'],
  RESEARCH:      ['kbLookup'],
  PRESENTATION:  ['kbLookup'],
  OBJECTION:     ['kbLookup'],
  POST_PURCHASE: ['kbLookup'],
}
