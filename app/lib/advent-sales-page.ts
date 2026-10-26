/**
 * The 2026 advent calendar sales page on curious.xdipx.com/advents26.
 *
 * Built from the Claude Design "xdipx Sales Page Template" (desktop) and its
 * mobile frame, as one code-defined page rather than Sanity docs (owner
 * direction 2026-10-26). Copy and the contents-value figures live here;
 * price, compare-at, images, stock and the variant to buy come from Shopify
 * at request time (app/routes/bridge.$slug.tsx).
 *
 * Owner decisions 2026-10-26: keep the advent-price countdown and the stock
 * line, keep the contents values (Lovehoney's published figures). The stock
 * line shows Shopify's tracked inventory, never a fixed number. The couples
 * and solo story cards are written as unattributed ideas: no names, cities
 * or years, because none of these 2026 calendars has a past customer to
 * quote (design doctrine §6, never fabricate proof).
 *
 * Client-safe: no server imports.
 */

export const ADVENT_SLUG = 'advents26'

/** One moment for every visitor: end of Nov 24, Pacific. */
export const ADVENT_SALE_ENDS_AT = '2026-11-24T23:59:00-08:00'
export const ADVENT_SHIP_BY = 'Nov 24'
export const ADVENT_ANNOUNCEMENT = 'Advent pricing ends soon · Limited stock, no restocks · Ships discreet'

export type AdventKey = 'indulge-12' | 'romance-7' | 'womanizer-24' | 'couples-24' | 'luxury-24'

export interface AdventCalendar {
  key: AdventKey
  handle: string
  short: string
  days: number
  /** Retail value of the contents (Lovehoney's figure, owner-confirmed). */
  value: number
  brands: string[]
  title: string
  headline: string
  headlineAccent: string
  tagline: string
  ritual: string
  editorial: string[]
  fitFor: string
  skipIf: string
  features: { k: string; v: string }[]
  closer: string
}

const kv = (arr: string[]) =>
  arr.map(s => {
    const i = s.indexOf(':')
    return i > 0 ? { k: s.slice(0, i), v: s.slice(i + 1).trim() } : { k: 'Detail', v: s }
  })

export const ADVENT_CALENDARS: Record<AdventKey, AdventCalendar> = {
  'indulge-12': {
    key: 'indulge-12',
    handle: 'lovehoney-indulge-advent-calendar-2026-12-day',
    short: 'Indulge',
    days: 12,
    value: 320.87,
    brands: ['Lovehoney'],
    title: 'Lovehoney Indulge Advent Calendar 2026 (12 Day)',
    headline: 'Twelve doors, and no reason to',
    headlineAccent: 'wait.',
    tagline: 'Twelve doors, twelve reasons neither of you has to wait.',
    ritual: 'Keep it somewhere you both pass every day. One door a night, and let the twelve build toward the last one.',
    editorial: [
      'Lovehoney built the Indulge calendar as a 12-day romance gift set: gifting, romance accessories, and a reason to keep opening something new.',
      "It's for couples who like unwrapping together, a door a day instead of one big reveal on the 25th.",
    ],
    fitFor: 'Couples who like unwrapping together, and anyone shopping the season a little early.',
    skipIf: 'A single showstopper gift feels more like your speed.',
    features: kv(['Format: 12-day advent calendar', 'Brand: Lovehoney', 'Collection: Indulge', 'Occasion: Holiday gift', 'Good for: Beginners']),
    closer: 'Twelve nights of something new. Start the countdown.',
  },
  'romance-7': {
    key: 'romance-7',
    handle: 'lovehoney-x-we-vibe-romance-advent-calendar-2026-7-day',
    short: 'Romance',
    days: 7,
    value: 291,
    brands: ['Lovehoney', 'We-Vibe'],
    title: 'Lovehoney x We-Vibe Romance Advent Calendar 2026 (7 Day)',
    headline: 'One week, built for the',
    headlineAccent: 'two of you.',
    tagline: 'Seven days of surprises, built for the two of you.',
    ritual: 'Save the first door for a night you can both slow down for. The ritual is half the gift.',
    editorial: [
      'Lovehoney and We-Vibe teamed up on a 7-day calendar built entirely around romance, one door a day counting down to something worth waiting for.',
      'A strong pick for couples who like anticipation as much as the payoff.',
    ],
    fitFor: 'Couples who like anticipation as much as the payoff, with the holidays as the excuse.',
    skipIf: "You're shopping solo for one hero product. This one is designed to be opened together.",
    features: kv(['Brand: Lovehoney x We-Vibe', 'Format: 7-day advent calendar', 'Theme: Romance gift set', 'Good for: Beginners', 'SKU: 99728']),
    closer: 'Seven nights. Clear your calendar for this one.',
  },
  'womanizer-24': {
    key: 'womanizer-24',
    handle: 'lovehoney-x-womanizer-enjoy-advent-calendar-2026-24-day',
    short: 'Womanizer Enjoy',
    days: 24,
    value: 345.77,
    brands: ['Lovehoney', 'Womanizer'],
    title: 'Lovehoney x Womanizer Enjoy Advent Calendar 2026 (24 Day)',
    headline: 'The countdown is the',
    headlineAccent: 'gift.',
    tagline: 'Twenty-four days of anticipation, one Womanizer finale.',
    ritual: 'Open one a day and let the smaller surprises set the pace. Save the big one for a night meant for it.',
    editorial: [
      'This Lovehoney x Womanizer collaboration turns the countdown itself into the gift: twenty-four doors building toward a signature Enjoy reveal.',
      "It's the easy yes for anyone who wants pleasure to feel like an event rather than an errand.",
    ],
    fitFor: "Anyone who wants pleasure to feel like an event, and likes not knowing what's next.",
    skipIf: 'You already know exactly which toy you want. Go pick that one instead.',
    features: kv([
      'Format: 24-day advent calendar',
      'Collaboration: Lovehoney x Womanizer',
      'Edition: 2026 holiday release',
      'Collection: Enjoy series',
      'Finale: Signature Womanizer',
    ]),
    closer: 'Twenty-three doors of build-up. You know what door 24 is.',
  },
  'couples-24': {
    key: 'couples-24',
    handle: 'lovehoney-x-womanizer-x-we-vibe-couples-advent-calendar-2026-24-day',
    short: 'Couples',
    days: 24,
    value: 608.77,
    brands: ['Lovehoney', 'Womanizer', 'We-Vibe'],
    title: 'Lovehoney x Womanizer x We-Vibe Couples Advent Calendar 2026 (24 Day)',
    headline: 'Twenty-four nights, built',
    headlineAccent: 'for two.',
    tagline: 'Twenty-four nights, three brands, one adventure built for two.',
    ritual: 'Open one a night and let the pacing do the work. Save a free weekend evening for the bigger surprises.',
    editorial: [
      'Three names that already know pleasure, Lovehoney, Womanizer and We-Vibe, fill one box with twenty-four days of surprises built for couples to open together.',
      'Made for partners who like a reason to slow down and explore nightly.',
    ],
    fitFor: 'Partners who like a reason to slow down and explore, one night at a time.',
    skipIf: "You're chasing one specific toy rather than a month of variety.",
    features: kv([
      'Format: 24-day advent calendar',
      'Edition: 2026 Couples Edition',
      'Brands: Lovehoney, Womanizer, We-Vibe',
      'Contents: 24 individually wrapped surprises',
      'Occasion: Holiday gift for couples',
    ]),
    closer: 'Three brands. Twenty-four nights. One very good December.',
  },
  'luxury-24': {
    key: 'luxury-24',
    handle: 'lovehoney-x-womanizer-x-we-vibe-x-arcwave-luxury-advent-calendar-2026-24-day',
    short: 'Luxury',
    days: 24,
    value: 908.75,
    brands: ['Lovehoney', 'Womanizer', 'We-Vibe', 'Arcwave'],
    title: 'Lovehoney x Womanizer x We-Vibe x Arcwave Luxury Advent Calendar 2026 (24 Day)',
    headline: 'One luxurious month of',
    headlineAccent: 'yes.',
    tagline: 'Twenty-four doors, twenty-four invitations, one luxurious month of yes.',
    ritual: 'Pace yourselves. A door a night keeps the surprise working the way the format intends.',
    editorial: [
      "This is the luxury tier of xdipx's calendars: twenty-four doors, each opening onto a piece from Lovehoney, Womanizer, We-Vibe or Arcwave.",
      "It's built for couples who already know these brands and want the whole roster under one lid, not a sampler.",
    ],
    fitFor: 'Couples who already know these brands and want the whole roster under one lid.',
    skipIf: "You're shopping for one specific toy. The point here is variety spread across a month.",
    features: kv([
      'Format: 24-day advent calendar',
      'Brands: Lovehoney, Womanizer, We-Vibe, Arcwave',
      'Edition: Luxury 2026',
      'Reveal: One item per day',
      'Power: Rechargeable pieces',
    ]),
    closer: 'Four brands, one lid, a month of yes.',
  },
}

export const ADVENT_ORDER: AdventKey[] = ['indulge-12', 'romance-7', 'womanizer-24', 'couples-24', 'luxury-24']
export const ADVENT_DEFAULT: AdventKey = 'couples-24'

export function isAdventKey(v: string | null | undefined): v is AdventKey {
  return !!v && (ADVENT_ORDER as string[]).includes(v)
}

export function isAdventSalesSlug(slug: string): boolean {
  return slug.toLowerCase() === ADVENT_SLUG
}

/** The calendar whose Shopify handle this is, or null. Gates the buy action. */
export function adventByHandle(handle: string): AdventCalendar | null {
  return ADVENT_ORDER.map(k => ADVENT_CALENDARS[k]).find(c => c.handle === handle) ?? null
}

export const ADVENT_FAQ = [
  {
    q: 'What does the box look like when it arrives?',
    a: 'Plain and unbranded. No logos and no product names on the box or the label. Your statement reads XDIPX, nothing else.',
  },
  {
    q: 'When should I order to start on December 1?',
    a: 'Order by November 24 for standard shipping to arrive before door one. Expedited options are available at checkout.',
  },
  {
    q: "Can I see what's inside before I buy?",
    a: "The contents are a surprise by design. Emma can tell you which calendar fits best if you tell her what you're into.",
  },
  {
    q: 'Can I return it?',
    a: "Unopened calendars can be returned within 30 days. Opened intimate products can't be returned for hygiene reasons.",
  },
]

export interface AdventIdea {
  key: AdventKey
  /** Short label where the template had a name and city. */
  label: string
  title: string
  body: string[]
}

export const ADVENT_COUPLE_IDEAS: AdventIdea[] = [
  {
    key: 'couples-24',
    label: 'The standing date',
    title: 'Start it as a joke gift. Watch it become how December starts.',
    body: [
      "Give it as a gag gift and see how long the joke lasts. By door three it usually doesn't. Phones go in a kitchen drawer at nine, the lights come down, and whoever lost the morning coin toss opens the door.",
      'Do it once and the only holiday plan either of you cares about is nine o\'clock.',
    ],
  },
  {
    key: 'luxury-24',
    label: 'Two full calendars',
    title: 'Skip the Christmas presents. Make this the present.',
    body: [
      'Two careers, two calendars, almost no overlap. The countdown becomes the one appointment neither of you moves, twenty-four nights in a row.',
      'Add up what you usually spend on gifts that end up returned. One box, split between you, wins that math.',
    ],
  },
  {
    key: 'indulge-12',
    label: 'A full house',
    title: 'Twelve doors fits real life. Two kids, one bedtime, one door.',
    body: [
      'With small kids, a 24-night commitment can feel ambitious. Twelve is doable. The door waits until the house is quiet, and the whole day has a little secret running underneath it.',
      "Text each other guesses about tonight's door at two in the afternoon. That's the part that sneaks up on you.",
    ],
  },
  {
    key: 'romance-7',
    label: 'Long stretches apart',
    title: 'On the road all fall? Make the seven-day your welcome-home week.',
    body: [
      'Save it for the week one of you lands home before the holidays, one door a night to make up for every hotel room.',
      'A week is long enough to build up to something, and short enough that you never skip a night.',
    ],
  },
  {
    key: 'womanizer-24',
    label: 'The slow build',
    title: 'Twenty-three nights of teasing. Door 24 becomes its own holiday.',
    body: [
      "Treat the first twenty-three doors as a month-long warm-up. Every night small, playful, a little bit of a dare. Nobody peeks ahead. That's the rule.",
      "Christmas Eve gets its own tradition. Leave dinner early. You won't be tired.",
    ],
  },
]

export const ADVENT_SOLO_IDEAS: AdventIdea[] = [
  {
    key: 'luxury-24',
    label: 'Building a collection',
    title: 'Do the math once and full price stops making sense.',
    body: [
      'Four premium brands, twenty-four pieces, one checkout. Treat December as your own private month.',
      'Two things in a drawer can turn into a whole curated shelf. Nothing else in the store comes close on value.',
    ],
  },
  {
    key: 'womanizer-24',
    label: 'Evenings that are yours',
    title: "The first year feels brave. After that it's the ritual you wait for.",
    body: [
      'A candle, a glass of wine, one door a night, and twenty-four evenings that are completely yours.',
      "It ends with a Womanizer. You might not know you need one until door 24.",
    ],
  },
  {
    key: 'indulge-12',
    label: 'Finding what you like',
    title: 'Not sure what you like yet? Twelve doors will tell you.',
    body: [
      'Skip the endless product pages. Twelve doors do the choosing, and every night is a low-pressure way to try something new.',
      "It's a tasting menu: find your favorites without paying full price for any of them. Next year, the 24-day.",
    ],
  },
]

export function adventRitual(days: number) {
  return [
    { when: 'Door 1', title: 'Phones in a drawer.', body: 'One door, one surprise, and an unspoken rule: you open it together, or not at all.' },
    { when: 'The first weekend', title: "It's a standing date now.", body: "Neither of you has to ask what tonight looks like. You both already know what nine o'clock means." },
    { when: 'Halfway', title: 'The anticipation takes over.', body: "Someone is guessing tomorrow's door over breakfast. The flirting starts hours before anything gets unwrapped." },
    { when: 'The last few nights', title: 'A fuller drawer.', body: "You've built a month of inside jokes and a collection you'd never have bought one piece at a time." },
    { when: `Door ${days}`, title: 'The finale.', body: 'Clear the evening. This is the one the whole countdown was building toward.' },
  ]
}

export const money = (n: number) => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2))
