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
/** Emma's holiday portrait (fal Kontext from singleton.editor's photo, 2026-10-26). Not the canonical likeness. */
export const ADVENT_EMMA_PHOTO = 'https://cdn.sanity.io/images/0nlwk8cf/production/36b67652ec0054a5df56f25d206d567d485d7275-1024x1024.jpg'
export const ADVENT_ANNOUNCEMENT = 'Advent price ends Nov 24 · 2026 editions, limited stock · Plain box, billed XDIPX'

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
    tagline: 'Twelve Lovehoney surprises, one a night, and something to look forward to all day.',
    ritual: 'Set it where you pass it every day. The last door gets harder to ignore each time you walk by.',
    editorial: [
      "Lovehoney's Indulge is a 12-day calendar for the first twelve nights of December, with a wrapped surprise behind each door.",
      'Twelve is the easy size: enough nights to settle into it, few enough to fit around everything else December asks of you.',
    ],
    fitFor: 'Couples who like unwrapping together, and anyone who wants a first calendar that is easy to say yes to.',
    features: kv(['Format: 12-day advent calendar', 'Brand: Lovehoney', 'Collection: Indulge', 'Occasion: Holiday gift', 'Good for: Beginners']),
    closer: 'Open the first door and the other eleven get very hard to leave closed.',
  },
  'romance-7': {
    key: 'romance-7',
    handle: 'lovehoney-x-we-vibe-romance-advent-calendar-2026-7-day',
    short: 'Romance',
    days: 7,
    value: 291,
    brands: ['Lovehoney', 'We-Vibe'],
    title: 'Lovehoney x We-Vibe Romance Advent Calendar 2026 (7 Day)',
    headline: 'One week to slow down,',
    headlineAccent: 'together.',
    tagline: 'Lovehoney and We-Vibe, seven doors, and one week that belongs to the two of you.',
    ritual: 'Pick a first night with no early alarm, then keep the rest of that week clear around it.',
    editorial: [
      'Lovehoney and We-Vibe put this 7-day calendar together around romance. Seven doors, seven evenings.',
      'Seven days is a full week of something to open, and short enough to fit any December.',
    ],
    fitFor: 'Couples who enjoy the lead-up as much as the night itself, with December as the reason.',
    features: kv(['Brand: Lovehoney x We-Vibe', 'Format: 7-day advent calendar', 'Theme: Romance gift set', 'Good for: Beginners', 'Doors: 7']),
    closer: 'Seven doors, one week, and nothing else on the calendar.',
  },
  'womanizer-24': {
    key: 'womanizer-24',
    handle: 'lovehoney-x-womanizer-enjoy-advent-calendar-2026-24-day',
    short: 'Womanizer Enjoy',
    days: 24,
    value: 345.77,
    brands: ['Lovehoney', 'Womanizer'],
    title: 'Lovehoney x Womanizer Enjoy Advent Calendar 2026 (24 Day)',
    headline: 'Twenty-four doors, and the last one is a',
    headlineAccent: 'Womanizer.',
    tagline: 'Twenty-four surprises from Lovehoney and Womanizer, ending on a signature Womanizer reveal.',
    ritual: 'Open them in order, at whatever pace your evenings allow. When door 24 comes, keep that night free.',
    editorial: [
      'Twenty-four doors from Lovehoney and Womanizer, with a signature Womanizer waiting behind the last one.',
      'Start on December 1 and door 24 falls on Christmas Eve.',
    ],
    fitFor: 'Anyone who wants pleasure to feel like an event, and loves not knowing what comes next.',
    features: kv([
      'Format: 24-day advent calendar',
      'Collaboration: Lovehoney x Womanizer',
      'Edition: 2026 holiday release',
      'Collection: Enjoy series',
      'Finale: Signature Womanizer',
    ]),
    closer: 'Twenty-three doors of build-up, then a Womanizer. Plan the last night first.',
  },
  'couples-24': {
    key: 'couples-24',
    handle: 'lovehoney-x-womanizer-x-we-vibe-couples-advent-calendar-2026-24-day',
    short: 'Couples',
    days: 24,
    value: 608.77,
    brands: ['Lovehoney', 'Womanizer', 'We-Vibe'],
    title: 'Lovehoney x Womanizer x We-Vibe Couples Advent Calendar 2026 (24 Day)',
    headline: 'Twenty-four nights of unwrapping something new,',
    headlineAccent: 'together.',
    tagline: 'Twenty-four wrapped surprises from Lovehoney, Womanizer and We-Vibe, and a reason to be home by evening.',
    ritual: 'Open them together. Keep weekends clear for lingering and weeknights short and easy.',
    editorial: [
      'Lovehoney, Womanizer and We-Vibe fill one box with twenty-four individually wrapped surprises, made for two people to open together.',
      'Twenty-four evenings with something new to open and nowhere else to be.',
    ],
    fitFor: 'Partners who want to discover something new together, a little more every night.',
    features: kv([
      'Format: 24-day advent calendar',
      'Edition: 2026 Couples Edition',
      'Brands: Lovehoney, Womanizer, We-Vibe',
      'Contents: 24 individually wrapped surprises',
      'Occasion: Holiday gift for couples',
    ]),
    closer: 'Twenty-four wrapped surprises in one box, and December 1 to start.',
  },
  'luxury-24': {
    key: 'luxury-24',
    handle: 'lovehoney-x-womanizer-x-we-vibe-x-arcwave-luxury-advent-calendar-2026-24-day',
    short: 'Luxury',
    days: 24,
    value: 908.75,
    brands: ['Lovehoney', 'Womanizer', 'We-Vibe', 'Arcwave'],
    title: 'Lovehoney x Womanizer x We-Vibe x Arcwave Luxury Advent Calendar 2026 (24 Day)',
    headline: 'Four brands behind',
    headlineAccent: 'twenty-four doors.',
    tagline: 'Lovehoney, Womanizer, We-Vibe and Arcwave, with rechargeable pieces in the mix.',
    ritual: 'Give each door its own evening and let the twenty-four of them stretch across December.',
    editorial: [
      'This is the luxury tier of our calendars: twenty-four doors, each opening onto a piece from Lovehoney, Womanizer, We-Vibe or Arcwave.',
      'Four brands in one box, with rechargeable pieces in the mix.',
    ],
    fitFor: 'Anyone who wants four brands in one box, from first-timers to collectors.',
    features: kv([
      'Format: 24-day advent calendar',
      'Brands: Lovehoney, Womanizer, We-Vibe, Arcwave',
      'Edition: Luxury 2026',
      'Reveal: One item per day',
      'Power: Rechargeable pieces',
    ]),
    closer: 'Four brands, twenty-four nights, nobody rushing. Take all of December.',
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
    a: "A plain box with a plain label: no logos, no product names. The return address reads XD Inc. and your statement reads XDIPX. It's nobody's business but yours.",
  },
  {
    q: 'When should I order to start on December 1?',
    a: 'Order by November 24 and standard shipping gets it to you before door one. That is also the last day of the advent price. Expedited options are available at checkout.',
  },
  {
    q: "Can I see what's inside before I buy?",
    a: "Every door is a surprise, so what's inside stays wrapped. You can see the brands, the number of doors and the value of what's inside, right here on this page.",
  },
  {
    q: 'Can I return it?',
    a: "Yes, unopened calendars can go back within 30 days. Once a door is open, that piece can't be returned, for hygiene reasons.",
  },
]

export interface AdventIdea {
  key: AdventKey
  /** Short label where the template had a name and city. */
  label: string
  title: string
  body: string[]
  /** AI-generated (fal, 2026-10-26) illustration of the idea, on the Sanity CDN. Not a customer. */
  image: { src: string; alt: string }
}

const CDN = 'https://cdn.sanity.io/images/0nlwk8cf/production/'

export const ADVENT_COUPLE_IDEAS: AdventIdea[] = [
  {
    key: 'couples-24',
    label: 'The standing date',
    image: { src: CDN + '3ee9f160f76351e91f38f6b55704b0ad0cacc0a5-1024x768.jpg', alt: 'A couple in their thirties laughing together on a sofa on a December evening' },
    title: 'Start it as a joke gift. By door three, it is the plan.',
    body: [
      "Wrap it as a gag gift and let the joke last as long as it lasts. Somewhere around door three the lights come down, and whoever picked tonight's door gets to open it.",
      "One night in, nine o'clock is the only holiday plan either of you cares about.",
    ],
  },
  {
    key: 'luxury-24',
    label: 'Two full calendars',
    image: { src: CDN + 'efb8ca6344caa0481379c90ca6742029691364f6-1024x768.jpg', alt: 'Two men in their forties hugging and laughing while they cook dinner' },
    title: 'Skip the Christmas presents. Make this the present.',
    body: [
      'Two careers, two packed calendars, almost no overlap. Door by door, this becomes the one appointment neither of you moves, twenty-four nights running.',
      'Skip the gift that goes back to the store. One box between the two of you, valued above what you pay, is better math.',
    ],
  },
  {
    key: 'indulge-12',
    label: 'A full house',
    image: { src: CDN + 'e826458295a3ac779551898a308f976f412b3893-1024x768.jpg', alt: 'A couple sharing cocoa and a laugh on the living room rug after bedtime' },
    title: 'Two kids, one bedtime, one door.',
    body: [
      'Twelve nights fits around a full house. Open the door once the house goes quiet, and let the whole day lean toward it.',
      "Text each other a guess about tonight's door at two in the afternoon. The reply becomes the part of the day you look forward to.",
    ],
  },
  {
    key: 'romance-7',
    label: 'Long stretches apart',
    image: { src: CDN + '67cfea666787e6aabcab98fd033681a180935fed-1024x768.jpg', alt: 'A couple in their sixties sharing a welcome-home hug beside a suitcase' },
    title: 'On the road all fall? Make the seven-day your welcome-home week.',
    body: [
      'Save it for the week one of you gets home before the holidays. One door a night, seven nights, to make up for every hotel room.',
      "Door one the night you're both home, door seven by the weekend after.",
    ],
  },
  {
    key: 'womanizer-24',
    label: 'The slow build',
    image: { src: CDN + 'a9b67295790bb617068ee4f22f0892d1f33b1a10-1024x768.jpg', alt: 'Two women cuddled under a knit blanket on a window seat, laughing' },
    title: 'Twenty-three nights of teasing. Door 24 becomes its own holiday.',
    body: [
      'Take the first twenty-three doors at your own pace, keep each night playful and unhurried, and agree that nobody peeks ahead.',
      'Door 24 lands on Christmas Eve, so it gets its own tradition. Leave dinner early.',
    ],
  },
]

export const ADVENT_SOLO_IDEAS: AdventIdea[] = [
  {
    key: 'luxury-24',
    label: 'Building a collection',
    image: { src: CDN + '2bef40bb0085f46f844ea14626491ff3c44dded3-1024x768.jpg', alt: 'A woman in her forties smiling to herself in an armchair with a mug of tea' },
    title: 'Four brands in one box, for less than the pieces cost one at a time.',
    body: [
      'Twenty-four doors across Lovehoney, Womanizer, We-Vibe and Arcwave. December becomes your month.',
      'Start a collection in a single order, with rechargeable pieces among them.',
    ],
  },
  {
    key: 'womanizer-24',
    label: 'Evenings that are yours',
    image: { src: CDN + '86704a0e7e26304856819f9a765d60f52eb6c5ac-880x768.jpg', alt: 'A woman in her sixties at home with a lit candle and a glass of red wine' },
    title: 'Twenty-four evenings that belong to you, ending on a Womanizer.',
    body: [
      "A candle, a glass of wine, a door to open. Twenty-four evenings with nobody's schedule in them but yours.",
      'Twenty-three doors of your own evenings, then a signature Womanizer.',
    ],
  },
  {
    key: 'indulge-12',
    label: 'Finding what you like',
    image: { src: CDN + '020a325feb6b6b8d993ab52f87d36bc80b3cb4ec-1024x768.jpg', alt: 'A woman in her twenties in pajamas laughing on the sofa with a mug' },
    title: 'Twelve nights of finding out what you like. No wrong answers.',
    body: [
      'Twelve doors do the choosing, and you open them at your own pace.',
      'Think of it as a tasting menu: twelve surprises to sample, for less than the twelve would cost one at a time.',
    ],
  },
]

export function adventRitual(days: number) {
  return [
    { when: 'Door 1', title: 'Lights down.', body: 'One surprise and nothing else on the evening. Door one sets the tone for every night after it.' },
    { when: 'The first weekend', title: 'Same time, new door.', body: 'By the first weekend nobody has to ask what tonight looks like.' },
    { when: 'Halfway', title: 'Let one run long.', body: 'Nothing says the evening has to end when the wrapping does.' },
    { when: 'The last few nights', title: 'Almost there.', body: 'A few doors left. Stretch these nights out.' },
    { when: `Door ${days}`, title: 'The last door.', body: 'Save it for a night with nowhere to be.' },
  ]
}

export const money = (n: number) => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2))
