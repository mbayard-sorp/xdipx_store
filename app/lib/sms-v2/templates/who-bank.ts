/**
 * app/lib/sms-v2/templates/who-bank.ts
 *
 * WHO-CLARIFICATION sub-banks for the discovery engine.
 * Six sub-banks keyed by WhoTrigger. B-6 entries are soft-beat replies
 * that do NOT advance the conversation gate.
 *
 * Voice rules (from CLAUDE.md + Emma persona):
 *   - Emma is a trusted friend who tests everything she recommends.
 *   - Suggestive is fine, explicit is not.
 *   - Never "sex" as adjective. Use "intimate", "pleasure", "wellness", "satisfaction".
 *   - No em-dashes. Use commas, periods, or hyphens in compounds.
 *   - No countdowns, no "buy now".
 *   - Price never closes a message.
 *   - B-5 (gendered-acknowledged) entries must NOT re-ask audience; they bridge to MATTERS.
 *   - B-6 (tender-pivot) entries are soft-beat candidates, no product mention.
 *   - Brand is "XDIPX" (pronounced "ex-dip-ex").
 */

export type WhoTrigger =
  | 'partner-hinted'
  | 'solo'
  | 'couples'
  | 'gift-no-recipient'
  | 'gendered-acknowledged'
  | 'tender-pivot'

export interface WhoEntry {
  id: string
  channel: 'sms' | 'chat' | 'both'
  trigger: WhoTrigger
  prose: string
  /** True for B-6 entries. These run as soft-beat replies and do not advance the gate. */
  isSoftBeat?: boolean
}

export const WHO_BANK: ReadonlyArray<WhoEntry> = [
  // ─── B-1: partner-hinted (6 variants) ────────────────────────────────────────
  {
    id: 'B-1a',
    channel: 'both',
    trigger: 'partner-hinted',
    prose:
      "Is this for a partner, or more of a you-and-them-together situation? Either way I'll figure out their taste as we go.",
  },
  {
    id: 'B-1b',
    channel: 'sms',
    trigger: 'partner-hinted',
    prose:
      "Quick: is your partner in on this, or is it a surprise? Makes a difference in what I'd lean toward.",
  },
  {
    id: 'B-1c',
    channel: 'both',
    trigger: 'partner-hinted',
    prose:
      "Tell me a little about who you're shopping for. Not looking for their life story, just: do you have a sense of what they like, or are we starting fresh?",
  },
  {
    id: 'B-1d',
    channel: 'sms',
    trigger: 'partner-hinted',
    prose:
      "Is this for their body specifically, or more of a shared-experience thing? Either works, just helps me narrow it.",
  },
  {
    id: 'B-1e',
    channel: 'chat',
    trigger: 'partner-hinted',
    prose:
      "Is this something they're going to use solo, something you'd use together, or honestly not sure yet? All of those are valid starting points.",
  },
  {
    id: 'B-1f',
    channel: 'both',
    trigger: 'partner-hinted',
    prose:
      "Are you shopping for someone whose preferences you know pretty well, or is this a bit of a discovery mission?",
  },

  // ─── B-2: solo (5 variants) ───────────────────────────────────────────────────
  {
    id: 'B-2a',
    channel: 'both',
    trigger: 'solo',
    prose:
      "Love it. Is this filling a gap in something you already have, or is it more like you're starting fresh and open to anything?",
  },
  {
    id: 'B-2b',
    channel: 'sms',
    trigger: 'solo',
    prose:
      "Just you, got it. Have you tried this kind of thing before, or is this new territory?",
  },
  {
    id: 'B-2c',
    channel: 'both',
    trigger: 'solo',
    prose:
      "Good. What are you hoping it adds? Something for winding down, something more energetic, something in between?",
  },
  {
    id: 'B-2d',
    channel: 'chat',
    trigger: 'solo',
    prose:
      "For you. Perfect. Is there a specific sensation or experience you're chasing, or are you more in 'I'll know it when I see it' territory?",
  },
  {
    id: 'B-2e',
    channel: 'sms',
    trigger: 'solo',
    prose:
      "Nice. Any features that matter to you right off the bat? Quiet motors, waterproof, rechargeable, anything like that?",
  },
  {
    // B-2f added during voice Stage D testing — solo callers often answered
    // "for me" without volunteering gender, leaving audience ambiguous. This
    // variant asks body type in Emma's voice so the slot extractor can
    // resolve for-her vs for-him and the gate can advance. Phrased softly:
    // "you" + "anatomy" rather than "for her body / for him body" which
    // user feedback flagged as too clinical.
    id: 'B-2f',
    channel: 'both',
    trigger: 'solo',
    prose:
      "So I can point you the right way, can I ask which side you're shopping for? Things designed with her anatomy in mind, with his, or honestly both work for you?",
  },

  // ─── B-3: couples (5 variants) ───────────────────────────────────────────────
  {
    id: 'B-3a',
    channel: 'both',
    trigger: 'couples',
    prose:
      "Love a couple's pick. Is this something you'd both be involved in, or more of a surprise from one side?",
  },
  {
    id: 'B-3b',
    channel: 'sms',
    trigger: 'couples',
    prose:
      "For both of you, great. Are you looking for something that works for either body, or something more specific to one of you?",
  },
  {
    id: 'B-3c',
    channel: 'both',
    trigger: 'couples',
    prose:
      "Couples shopping is one of my favorite things. Is the goal more connection, more novelty, or both? No wrong answer.",
  },
  {
    id: 'B-3d',
    channel: 'chat',
    trigger: 'couples',
    prose:
      "Got it, a shared pick. Do you have a sense of whether one of you would be more on the receiving end, or is it more of an equal-opportunity situation?",
  },
  {
    id: 'B-3e',
    channel: 'sms',
    trigger: 'couples',
    prose:
      "Are you two shopping together right now, or is this a solo mission on their behalf?",
  },

  // ─── B-4: gift-no-recipient (5 variants) ─────────────────────────────────────
  {
    id: 'B-4a',
    channel: 'both',
    trigger: 'gift-no-recipient',
    prose:
      "Gift shopping. I can work with that. Is the person you're buying for someone who's pretty open about this stuff, or is it a bit of a guess?",
  },
  {
    id: 'B-4b',
    channel: 'sms',
    trigger: 'gift-no-recipient',
    prose:
      "Who's the lucky person? Not asking for their name, just: do you have a sense of what they like, or are we going off vibes?",
  },
  {
    id: 'B-4c',
    channel: 'both',
    trigger: 'gift-no-recipient',
    prose:
      "Is this for someone who'd know exactly what they want if you asked them, or is the whole point that they'd never ask for it themselves?",
  },
  {
    id: 'B-4d',
    channel: 'chat',
    trigger: 'gift-no-recipient',
    prose:
      "Tell me a little about them. Have they ever mentioned anything they're curious about, or is this more of a 'I just know them well enough' situation?",
  },
  {
    id: 'B-4e',
    channel: 'sms',
    trigger: 'gift-no-recipient',
    prose:
      "Is this for their body, something you'd both use, or more of a set-the-mood kind of gift?",
  },

  // ─── B-5: gendered-acknowledged (4 variants, bridge to MATTERS) ──────────────
  {
    id: 'B-5a',
    channel: 'both',
    trigger: 'gendered-acknowledged',
    prose:
      "Got it. Is this their first time with something like this, or do they have opinions already?",
  },
  {
    id: 'B-5b',
    channel: 'both',
    trigger: 'gendered-acknowledged',
    prose:
      "I love that you're picking for them. Do you have a feel for what they care about, like how it feels, how it looks, whether it's quiet?",
  },
  {
    id: 'B-5c',
    channel: 'both',
    trigger: 'gendered-acknowledged',
    prose:
      "Good, I've got a good sense of who we're shopping for. What matters most to them: how something feels, how discreet it is, a specific function?",
  },
  {
    id: 'B-5d',
    channel: 'sms',
    trigger: 'gendered-acknowledged',
    prose:
      "Nice. Have they used anything like this before, or are we starting from the beginning?",
  },

  // ─── B-6: tender-pivot (6 variants, isSoftBeat: true) ────────────────────────
  {
    id: 'B-6a',
    channel: 'both',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "That's a big thing to be navigating. I'm glad you're here. No rush to figure anything out right now. What feels like the right energy, something just for you, or something that's more about reconnecting with yourself?",
  },
  {
    id: 'B-6b',
    channel: 'both',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "Long-distance is its own kind of hard. Are you thinking something you'd use together over a call, something to send them, or something just for you in the in-between?",
  },
  {
    id: 'B-6c',
    channel: 'both',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "No pressure, and honestly no rush. First time back at anything can feel like a lot. Do you want to start soft, or do you already have a sense of what feels comfortable?",
  },
  {
    id: 'B-6d',
    channel: 'both',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "I hear you. Bodies change, and so does what feels good. Do you know if there are any comfort considerations I should keep in mind, or are you still figuring that out?",
  },
  {
    id: 'B-6e',
    channel: 'both',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "I'm really glad you reached out. Take whatever time you need here. If and when you want to explore something, I'm here. What feels right to even talk about right now?",
  },
  {
    id: 'B-6f',
    channel: 'sms',
    trigger: 'tender-pivot',
    isSoftBeat: true,
    prose:
      "That makes sense. No rush. When you're ready to look at anything specific, just say the word and I'll find something that fits where you are.",
  },
]

/**
 * Pick a WHO-clarification entry for the given trigger and channel.
 * Filters to entries whose channel is 'both' or exactly matches the requested channel.
 * Picks one at random from matching entries.
 * If no entries match, returns the first entry for that trigger regardless of channel.
 */
export function pickWho(trigger: WhoTrigger, channel: 'sms' | 'chat'): WhoEntry {
  const matches = WHO_BANK.filter(
    (e) => e.trigger === trigger && (e.channel === 'both' || e.channel === channel),
  )

  const pool =
    matches.length > 0
      ? matches
      : WHO_BANK.filter((e) => e.trigger === trigger)

  return pool[Math.floor(Math.random() * pool.length)]!
}
