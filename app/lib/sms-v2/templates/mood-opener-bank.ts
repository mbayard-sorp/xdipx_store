/**
 * app/lib/sms-v2/templates/mood-opener-bank.ts
 *
 * Emma-voice openers for the MOOD-DETECTION stage of the discovery engine.
 * One opener is surfaced at conversation start based on detected trigger signal.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is an AI guide and editorial curator: she advises how a product works and could work for the reader, and never claims to have used, tried, tested, or owned it.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - Price never closes a message.
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type MoodOpenerChannel = 'sms' | 'chat' | 'both'

export type MoodOpenerTrigger =
  | 'vague'          // bare "hey", "hi", "what's good"
  | 'help'           // "help me pick"
  | 'first-timer'    // "I don't even know where to start"
  | 'returning'      // returning customer with prior conversation
  | 'browse'         // "what's good", broad browse
  | 'late-night'     // sent after 10pm local
  | 'special'        // "I want something special"
  | 'gift'           // gift shopper energy
  | 'first-time'     // "first time"
  | 'romantic'       // slow-and-romantic energy
  | 'tender'         // "going through a lot" / post-life-event implied
  | 'curious'        // "curious"
  | 'urgent'         // "I need something!!" exclamation energy
  | 'referred'       // "I heard about you"

export interface MoodOpenerEntry {
  id: string
  channel: MoodOpenerChannel
  trigger: MoodOpenerTrigger
  prose: string
}

export const MOOD_OPENER_BANK: ReadonlyArray<MoodOpenerEntry> = [
  {
    id: 'A-01',
    channel: 'both',
    trigger: 'vague',
    prose:
      "Oh hey. Before I throw stuff at you, tell me, are you after a feeling, or do you already have something in mind? No wrong answer, I just pick better when I know the vibe.",
  },
  {
    id: 'A-02',
    channel: 'sms',
    trigger: 'help',
    prose:
      "Happy to help. Is this a treat-yourself moment, or are you picking for someone else? That changes everything about where I start.",
  },
  {
    id: 'A-03',
    channel: 'both',
    trigger: 'first-timer',
    prose:
      "Honestly, that's the best place to start. Nothing to unlearn. Tell me, what are you hoping to feel? Curious, relaxed, connected, something else?",
  },
  {
    id: 'A-04',
    channel: 'both',
    trigger: 'returning',
    prose:
      "Welcome back. What's calling you today? Something you've been thinking about since last time, or a totally different direction?",
  },
  {
    id: 'A-05',
    channel: 'chat',
    trigger: 'browse',
    prose:
      "Depends on what good means to you right now. Is this about adding something new, or finally finding the version of something that actually works?",
  },
  {
    id: 'A-06',
    channel: 'sms',
    trigger: 'late-night',
    prose:
      "Late-night shopping energy. I respect it. Quick: solo, shared, or a gift? That tells me a lot.",
  },
  {
    id: 'A-07',
    channel: 'both',
    trigger: 'special',
    prose:
      "I love that instinct. Special like a splurge on yourself, or special like you want to surprise someone? Either way, I've got ideas.",
  },
  {
    id: 'A-08',
    channel: 'both',
    trigger: 'gift',
    prose:
      "Gift shopping is an art. Is the person you're buying for someone who has opinions about this stuff already, or are we figuring them out together?",
  },
  {
    id: 'A-09',
    channel: 'sms',
    trigger: 'first-time',
    prose:
      "First time is a big deal, and I mean that in the best way. Are you looking for a soft start, or do you already have a sense of the direction you want to go?",
  },
  {
    id: 'A-10',
    channel: 'both',
    trigger: 'romantic',
    prose:
      "I'm into this. Is it more of a slow-burn kind of night you're planning, or something a little more energetic?",
  },
  {
    id: 'A-11',
    channel: 'both',
    trigger: 'tender',
    prose:
      "No rush, no judgment here. Sometimes this is about reconnecting with yourself, sometimes it's about connection with someone else. What feels right to even explore right now?",
  },
  {
    id: 'A-12',
    channel: 'both',
    trigger: 'curious',
    prose:
      "Curious is genuinely the best way to shop for this stuff. Is the curiosity more about a specific category, or is it more of a 'I want to feel something different' kind of thing?",
  },
  {
    id: 'A-13',
    channel: 'sms',
    trigger: 'urgent',
    prose:
      "Okay, I love the energy. Fill me in a little: is this for you, a partner, or both? I'll go from there.",
  },
  {
    id: 'A-14',
    channel: 'chat',
    trigger: 'referred',
    prose:
      "Happy you found us. What brought you in today, a specific thing you heard about, or are you just seeing what we've got?",
  },
]

/**
 * Pick a mood opener for the given trigger and channel.
 * Filters to entries whose channel is 'both' or exactly matches the requested channel.
 * Picks one at random from matching entries.
 * Falls back to trigger='vague' if no entries match the requested trigger.
 */
export function pickMoodOpener(
  trigger: MoodOpenerTrigger,
  channel: 'sms' | 'chat',
): MoodOpenerEntry {
  const matches = MOOD_OPENER_BANK.filter(
    (e) => e.trigger === trigger && (e.channel === 'both' || e.channel === channel),
  )

  const pool =
    matches.length > 0
      ? matches
      : MOOD_OPENER_BANK.filter(
          (e) => e.trigger === 'vague' && (e.channel === 'both' || e.channel === channel),
        )

  // Guaranteed: 'vague' + 'both' entry A-01 always matches any channel
  return pool[Math.floor(Math.random() * pool.length)]!
}
