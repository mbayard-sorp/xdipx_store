/**
 * app/lib/sms-v2/templates/matters-bank.ts
 *
 * MATTERS-clarification bank for the discovery engine.
 * Surfaces after WHO is resolved. Asks what the customer actually cares about
 * before Emma pulls product matches.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is a trusted friend who tests everything she recommends.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - Price never closes a message.
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type MattersTrigger =
  | 'first-timer'
  | 'experienced'
  | 'gift-shopper'
  | 'couples'
  | 'terse'
  | 'vibe-described'
  | 'budget-mentioned'
  | 'general'

export interface MattersEntry {
  id: string
  channel: 'sms' | 'chat' | 'both'
  trigger: MattersTrigger
  prose: string
}

export const MATTERS_BANK: ReadonlyArray<MattersEntry> = [
  {
    id: 'C-01',
    channel: 'both',
    trigger: 'first-timer',
    prose:
      "What would make this feel like the right move? I'm thinking less about features and more about, what would make you actually excited to try it?",
  },
  {
    id: 'C-02',
    channel: 'sms',
    trigger: 'first-timer',
    prose:
      "Is there anything that would make this feel safe to try? Like quiet, discreet packaging, easy to use without reading a manual?",
  },
  {
    id: 'C-03',
    channel: 'both',
    trigger: 'experienced',
    prose:
      "You've been around a bit. Anything you've figured out really matters to you in a toy? Could be sensation, could be practical, could be something random.",
  },
  {
    id: 'C-04',
    channel: 'sms',
    trigger: 'experienced',
    prose:
      "Anything must-have? Quiet, waterproof, app-controlled, specific material? I'll filter down fast.",
  },
  {
    id: 'C-05',
    channel: 'both',
    trigger: 'gift-shopper',
    prose:
      "What does this person care about when they pick stuff for themselves? Price point, how it feels, whether it's pretty? I'm trying to get inside their head a little.",
  },
  {
    id: 'C-06',
    channel: 'chat',
    trigger: 'gift-shopper',
    prose:
      "If you had to guess what matters most to them, what would it be? Is it more about function, how it looks, or the experience of opening it?",
  },
  {
    id: 'C-07',
    channel: 'both',
    trigger: 'couples',
    prose:
      "Is there anything specific you both need it to work around? Like one of you needs it to be really quiet, or it needs to work long-distance?",
  },
  {
    id: 'C-08',
    channel: 'sms',
    trigger: 'terse',
    prose:
      "Anything off the table, or anything that's basically required? Takes me 30 seconds to narrow this way down.",
  },
  {
    id: 'C-09',
    channel: 'chat',
    trigger: 'vibe-described',
    prose:
      "Is there a practical angle I should know about? Things like whether it needs to be travel-size, waterproof, or if the materials matter to you.",
  },
  {
    id: 'C-10',
    channel: 'both',
    trigger: 'budget-mentioned',
    prose:
      "Anything besides the price that matters? I ask because within a budget there's still a lot of range, and I'd rather find the right one than just the cheapest one.",
  },
]

/**
 * Pick a MATTERS entry for the given trigger and channel.
 * Filters to entries whose channel is 'both' or exactly matches the requested channel.
 * Picks one at random from matching entries.
 * Falls back to trigger='general' if no entries match, then falls back to any
 * entry for the trigger regardless of channel.
 */
export function pickMatters(trigger: MattersTrigger, channel: 'sms' | 'chat'): MattersEntry {
  const matches = MATTERS_BANK.filter(
    (e) => e.trigger === trigger && (e.channel === 'both' || e.channel === channel),
  )

  if (matches.length > 0) {
    return matches[Math.floor(Math.random() * matches.length)]!
  }

  // Fall back to any entry for the trigger, ignoring channel
  const triggerFallback = MATTERS_BANK.filter((e) => e.trigger === trigger)
  if (triggerFallback.length > 0) {
    return triggerFallback[Math.floor(Math.random() * triggerFallback.length)]!
  }

  // Last resort: general trigger
  const general = MATTERS_BANK.filter(
    (e) => e.trigger === 'general' && (e.channel === 'both' || e.channel === channel),
  )
  return general[Math.floor(Math.random() * general.length)] ?? MATTERS_BANK[0]!
}
