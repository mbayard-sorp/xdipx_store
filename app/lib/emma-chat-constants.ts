/**
 * Client-safe constants for Emma Chat quick actions.
 * Import from this file in components — NOT from emma-chat.server.ts.
 */

export type EmmaQuickActionId =
  | 'more_direct'
  | 'shorter'
  | 'competitor_compare'
  | 'safety_disclaimer'
  | 'more_emma'

export const EMMA_QUICK_ACTION_LABELS: Record<EmmaQuickActionId, string> = {
  more_direct: 'More direct',
  shorter: 'Shorter',
  competitor_compare: 'Add competitor compare',
  safety_disclaimer: 'Add safety disclaimer',
  more_emma: 'More Emma personality',
}

export const EMMA_QUICK_ACTION_IDS: EmmaQuickActionId[] = [
  'more_direct',
  'shorter',
  'competitor_compare',
  'safety_disclaimer',
  'more_emma',
]
