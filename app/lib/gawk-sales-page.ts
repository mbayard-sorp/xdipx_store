/**
 * The hand-designed sales page at curious.xdipx.com/gawk-gawk-3000. The layout
 * and words live in code (app/components/funnel/GawkSalesView.tsx), the way the
 * advent page does; the Sanity `salesPage` document still decides whether the
 * page is live, its SEO fields and its add-on screens. Price, compare-at, stock
 * and the variant come from Shopify in the route loader.
 *
 * Owner decisions behind this copy are in docs/store-team/sales-pages.md.
 */

import { showDiscountBadge } from '~/lib/discount-badge'

export const GAWK_SALES_SLUG = 'gawk-gawk-3000'

const CDN = 'https://cdn.sanity.io/images/0nlwk8cf/production/'

export const GAWK_IMAGES = {
  hero: CDN + '34927e82a0568a4e55dd099f5be00df8134b7c21-1440x2560.jpg',
  final: CDN + '304241c1002e450392451fbbab618eaa2e9c365f-1440x2560.jpg',
  picture: CDN + '81ee3f54ae6ce5c0a4e1ad79762600f97b8782be-2400x1600.jpg',
  head: CDN + 'b1867bc0f155dfc6cabbe7d4b71dba647c3ce692-2240x1680.jpg',
  grab: CDN + 'b57bb8d703badb4a3a7978be9ab6eb0452344cfd-2560x1440.jpg',
  watching: CDN + 'b6c23a7f897d969455c32cdadf1b22a8f64cbbcd-2400x1600.jpg',
  viral: CDN + 'cba9083143dd540cecd7244b1d0082fb455097f3-3040x1216.jpg',
  inHand: CDN + '3551573b084f4aacb68df482f6c3a9830d4e0d34-500x889.jpg',
  packshot: CDN + 'd4326df3a6893294946df8aed99914b47dcec503-500x500.jpg',
  detail: CDN + 'b19a3a97be488f77fea15004e19d8674126e73b1-500x500.jpg',
  demoFull: CDN + '27a27530daefef1281366bc8fff61fc268616e6d-1440x2560.jpg',
  demoFist: CDN + 'd48f149cfb358779750cef6a2cfe0229cae3f012-1920x1920.jpg',
  demoLube: CDN + '95297f8920500ccef97b301bdbeac542e941104e-1920x1920.jpg',
  spin: CDN + '3b8d0d024869958a39bdd241e2ee2f0f2f960a41-2240x1680.jpg',
  math: CDN + 'd902333a11a887477bfce44b3bbfacb0ce4a27c3-1718x2148.jpg',
  box: CDN + 'ef3f789decbd869df6bb353e3c17009fb2335545-3040x1216.jpg',
  ps: CDN + '242f04911c8059e5ec2d137cc11aa4ec1148139d-1920x1920.jpg',
} as const

export interface GawkOffer {
  /** "20% OFF" */
  label: string
  was: number
  save: number
}

/**
 * A discount only ever comes from a real Shopify compare-at price. `compareAt`
 * must already have passed the MAP gate (null when MAP forbids showing it).
 * Below the store's badge floor, or with no compare-at, there is no offer and
 * the page sells on the price.
 */
export function gawkOffer(price: number, compareAt: number | null): GawkOffer | null {
  if (!compareAt || compareAt <= price) return null
  const pct = Math.round((1 - price / compareAt) * 100)
  if (!showDiscountBadge(pct)) return null
  return { label: `${pct}% OFF`, was: compareAt, save: Math.round((compareAt - price) * 100) / 100 }
}

/**
 * The other Male Roses this page steps up to, in the order they show. Specs come
 * from each product's `custom.original_description` metafield (the manufacturer's
 * words). Rose 3's source gives both 7 and 10 vibration frequencies, so it carries
 * no count. Price and photo come from Shopify in the loader.
 */
export interface GawkUpgrade {
  handle: string
  name: string
  tag: string
  /** Where the page leads: the top of the line gets the hero card and the loud frame. */
  featured: boolean
  headline: string
  pitch: string
  adds: string[]
  cta: string
}

export const GAWK_UPGRADES: GawkUpgrade[] = [
  {
    handle: 'the-male-rose-pro-triple-action-combo-with-thrusting-rotating-and-vibrating',
    name: 'Male Rose Pro',
    tag: 'The step up',
    featured: false,
    headline: 'The swirl, plus the bob.',
    pitch: 'It slides up and down your cock while it spins and hums. 94 nubs line the cup, so every stroke drags.',
    adds: ['9 thrusting modes, on top of 9 spin and 9 vibration', '94 pleasure nubs inside a mouth-shaped opening', 'Digital display, so you can find your setting again', 'Cup pops off and works as a hand stroker too'],
    cta: 'Give me the Pro →',
  },
  {
    handle: 'the-male-rose-3',
    name: 'Male Rose 3',
    tag: 'Top of the line',
    featured: true,
    headline: 'Three motors. Nothing left for you to do.',
    pitch: 'Three separate motors, so it spins, thrusts and vibrates all at once. The cup is clear, so you get to watch it take you.',
    adds: ['Thrusts up and down and spins a full 360°', 'See-through cup, lips on the tip', 'Tongue-like ridges inside the canal', 'Whisper quiet at 40 dB, 50 minutes a charge'],
    cta: 'Give me the 3 →',
  },
  {
    handle: 'the-male-rose-2-dual-motor-10-vibration-modes-5-suction-patterns',
    name: 'Male Rose 2',
    tag: 'If you want suction',
    featured: false,
    headline: 'Trade the spin for the pull.',
    pitch: "No rotation here, just a mouth that won't let go. Five suction patterns and ten vibrations, with one button that goes straight to the finish.",
    adds: ['5 suction patterns, 10 vibration modes', 'Dual motors', 'One-button climax mode', 'Flushes clean without taking it apart'],
    cta: 'Give me the 2 →',
  },
]

export const GAWK_UPGRADE_HANDLES = GAWK_UPGRADES.map(u => u.handle)

/** The side-by-side under the upgrade cards, columns in the order Gawk, Pro, 3, 2. */
export const GAWK_COMPARE_COLUMNS = ['Gawk', 'Pro', 'Rose 3', 'Rose 2']
export const GAWK_COMPARE_ROWS: { label: string; has: [boolean, boolean, boolean, boolean] }[] = [
  { label: '360° spin', has: [true, true, true, false] },
  { label: 'Thrusting', has: [false, true, true, false] },
  { label: 'Vibration', has: [true, true, true, true] },
  { label: 'Suction', has: [false, false, false, true] },
  { label: 'Clear cup', has: [false, false, true, false] },
  { label: 'Digital display', has: [false, true, false, false] },
]

/**
 * What stepping up costs over the page's own product, from live Shopify prices.
 * Null when there's nothing to pitch: it isn't actually more, or a price is
 * missing. An upgrade with no gap doesn't show.
 */
export function gawkUpgradeGap(price: number, upgradePrice: number | null | undefined): number | null {
  if (!price || !upgradePrice || upgradePrice <= price) return null
  return Math.round((upgradePrice - price) * 100) / 100
}

export const GAWK_TICKER = [
  'Went viral',
  'Free shipping',
  '360° rotation',
  '5 speeds',
  '10 vibes',
  'Soft lips',
  'Quiet motor',
  'USB charge',
  'Plain box',
  'Billed as XDIPX',
]

export const GAWK_STATS = [
  { big: '360°', title: 'It spins around you', body: 'A full turn, five speeds. Your hand stays still. The lips do the work.' },
  { big: '10', title: 'Ways to vibrate', body: 'Pulse, wave, steady hum. Stack them on the spin and find the one that finishes you.' },
  { big: 'Lips', italic: true, title: 'Soft at the opening', body: 'Realistic texture inside. It feels like a mouth from the first second.' },
  { big: 'Shh', title: 'Quiet motor', body: "Use it with the door closed and no one's the wiser." },
]

export const GAWK_BEATS = [
  { n: '0:00', t: 'Lips first.', d: 'Soft and slick at the opening. You slide in and it already feels like head.' },
  { n: '0:10', t: 'Then it starts to turn.', d: "A full 360° around your cock. You don't move. It does." },
  { n: '0:30', t: 'Vibration underneath.', d: 'Ten modes. Stack them on the spin until your grip tightens.' },
  { n: '∞', t: "It doesn't stop.", d: 'No tired jaw. No breaks. Edge, ease off, go again. It finishes when you do.' },
]

export const GAWK_PATH = [
  { label: 'Step 1', title: 'It went viral.', body: 'One look at the name and one try was all it took.' },
  { label: 'Step 2', title: 'You order yours.', body: 'A plain box, free shipping, and four letters on your statement.' },
  { label: 'Step 3', title: "It's at your door.", em: 'Then you find out.', body: 'Charge it, add lube, start on the lowest speed.' },
]

export const GAWK_VERSUS = [
  { k: 'Motion', us: '360° spin, 5 speeds', them: 'Same old up and down' },
  { k: 'Vibration', us: '10 modes', them: 'None' },
  { k: 'Feel', us: 'Soft lips, textured cup', them: 'Palm' },
  { k: 'Effort', us: 'Press a button', them: 'All you' },
  { k: 'Stamina', us: 'Goes till you cum', them: 'Cramps' },
  { k: 'Cleanup', us: 'Cup pops off, rinse', them: 'Tissues' },
]

export const GAWK_REASONS = [
  { t: 'It feels like a mouth.', d: 'Soft lips at the opening and a realistic textured cup inside. From the first push it feels like head, not a toy.' },
  { t: "It moves so you don't have to.", d: 'A full 360° rotation at five speeds. The lips circle your cock while you lie back.' },
  { t: 'Ten vibration modes.', d: 'Steady, pulsing, waves. Layer them over the spin and find the combo that gets you every time.' },
  { t: "It's quiet.", d: 'A quiet motor, so the only sound in the room is the video and your breathing.' },
  { t: "It's always ready.", d: 'USB rechargeable. No batteries to hunt for. Charge it, stash it, grab it when the mood hits.' },
  { t: 'Cleanup takes a minute.', d: 'The cup pops off the handle. Rinse it, dry it, snap it back on. Done.' },
]

export const GAWK_SPECS = [
  { k: 'Rotation', v: '360°, 5 speeds' },
  { k: 'Vibration', v: '10 modes' },
  { k: 'Cup', v: 'Textured, soft lips' },
  { k: 'Sleeve', v: 'Stretchy, textured' },
  { k: 'Handle', v: 'Extended grip' },
  { k: 'Motor', v: 'Quiet' },
  { k: 'Power', v: 'USB rechargeable' },
  { k: 'Water', v: 'Splashproof' },
]

export const GAWK_ACTION = [
  { img: 'demoFull', title: 'Lips over the head.', body: 'The soft opening slides down and seals around the tip. That first second is the reason for the name.' },
  { img: 'demoFist', title: 'Takes the whole shaft.', body: 'Stretchy textured sleeve swallows you deep while the cup spins. You see every ridge working.' },
  { img: 'demoLube', title: 'And then you finish.', body: 'Water-based lube in, mess out. The cup pops off so cleanup takes a minute.' },
] as const

export const GAWK_ANATOMY = [
  { k: 'The lips', v: "Soft, realistic opening. The first thing you feel, and the reason it's called what it's called." },
  { k: 'The cup', v: "Clear, textured and detachable. You can see exactly what's about to wrap around you." },
  { k: 'The sleeve', v: 'Stretchy and textured inside. It gives with every stroke, deep and slow or short and quick.' },
  { k: 'The motor', v: 'Spins the cup 360° at five speeds and drives ten vibration modes. Quiet.' },
  { k: 'The handle', v: 'Long, black, solid in your grip, so you stay in control.' },
  { k: 'The controls', v: 'Rose-gold buttons right under your thumb. Change speed without looking away from the screen.' },
]

export const GAWK_STEPS = [
  { n: '01', t: 'Charge it', d: 'USB. Plug it in before you need it.' },
  { n: '02', t: 'Lube up', d: 'Water-based, generous, in the cup and on you.' },
  { n: '03', t: 'Start low', d: 'The spin is intense. Lowest speed first.' },
  { n: '04', t: 'Climb', d: 'Raise the speed, switch vibes, stop where your breath catches.' },
  { n: '05', t: 'Rinse', d: 'Cup detaches. Clean, dry, ready for tomorrow.' },
]

export const GAWK_BOX = [
  { t: 'Gawk Gawk 3000 stroker', d: 'Handle, quiet motor, rose-gold controls.' },
  { t: 'Soft-lips textured cup', d: 'Detachable, with the stretchy sleeve inside.' },
  { t: 'Free discreet shipping', d: 'Plain box, plain label, return address XD Inc.' },
  { t: 'XDIPX billing', d: 'Four letters on your statement. Nothing else.' },
  { t: '30-day returns', d: 'Unopened, it can come back. Something wrong, we make it right.' },
]

/** First entry opens on load. Shipping and returns state the real policy. */
export const GAWK_FAQS = [
  { q: 'Does it really feel like a mouth?', a: 'Soft lips at the opening, a realistic textured cup inside, and it turns a full 360° around you. Add plenty of water-based lube and judge for yourself.' },
  { q: 'Is shipping really free?', a: 'Yes, on Standard US shipping, and checkout takes it off for you. Plain box, discreet. Hawaii, Alaska and Puerto Rico ship at $14.99, and the rate shows at checkout before you pay.' },
  { q: 'Will it fit me?', a: 'The sleeve is stretchy and gives with every stroke, so it moves with you, deep and slow or short and quick.' },
  { q: 'How does it arrive? What shows on my card?', a: 'Plain box, plain label. The return address reads XD Inc. and your statement reads XDIPX. Nothing else.' },
  { q: 'How loud is it?', a: "The motor is quiet. There is no decibel rating listed, so we won't put a number on it." },
  { q: 'Which lube?', a: 'Water-based, and be generous. You can add one on the next screen.' },
  { q: 'Where do I start?', a: 'Lowest speed. The rotation is intense. Climb from there.' },
  { q: 'How do I clean it?', a: "The cup detaches. Rinse it, let it dry, snap it back on. It's splashproof, not waterproof, so keep the handle out of the shower." },
  { q: 'How do I charge it?', a: 'USB. Plug it in before you want it.' },
  { q: "What if I don't like it?", a: "Unopened, it can come back within 30 days. Once it's been used, hygiene rules apply. If something's wrong with it, email hello@xdipx.com and we make it right." },
]
