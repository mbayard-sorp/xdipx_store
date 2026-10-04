/**
 * The approved Search copy bank and keyword plan, as data.
 *
 * Copy: docs/store-team/google-ads-ad-copy.md themes A to E (register 3-4, every
 * line length-checked, no glyphs, no prices). These pad an idea's own headlines
 * up to the 15 an RSA wants. Keywords and negatives: docs/store-team/
 * google-ads-launch-plan.md section 3 (phrase and exact only, never broad).
 * If either doc changes, change this file in the same PR; the test checks lengths.
 */

export type ThemeId = 'materials' | 'beginner' | 'discreet' | 'couples' | 'curated'

export interface CopyTheme {
  id: ThemeId
  headlines: string[]
  descriptions: string[]
  paths: [string, string]
}

export const COPY_THEMES: Readonly<Record<ThemeId, CopyTheme>> = {
  materials: {
    id: 'materials',
    headlines: [
      'Body-Safe Materials Guide', 'Is Silicone Body-Safe?', 'Medical-Grade Silicone', 'What Body-Safe Means',
      'Materials, Named Plainly', 'Silicone, Glass, Steel', 'Non-Porous Toy Materials', "Know What You're Buying",
      'Body-Safe on Every Page', 'Skip the Guesswork', 'Toy Materials 101', 'Choose With Confidence',
      'Silicone vs Glass vs Steel', 'Take a Peek', 'Find Your Fit',
    ],
    descriptions: [
      'Every product page names its materials plainly: silicone, glass, or steel.',
      "Hand-checked before it's listed, not auto-added from a warehouse feed.",
      'No wrong answers. Learn what body-safe actually means before you buy.',
      'Medical-grade silicone, glass, and stainless steel, named on every page.',
    ],
    paths: ['materials', 'guide'],
  },
  beginner: {
    id: 'beginner',
    headlines: [
      'Buying Your First Toy?', 'New to Sex Toys? Start Here', 'Best Beginner Vibrators', 'No Experience Needed',
      'A Guide for First-Timers', 'Beginner-Friendly Picks', 'Start Simple, Start Smart', 'No Wrong Answers Here',
      'Easy, Low-Intimidation Picks', 'Where First-Timers Start', 'Simple Toys, Clearly Explained',
      'Curated for Beginners', 'Find Your First, Easily', 'Take a Peek', 'Find Your Fit',
    ],
    descriptions: [
      'New to sex toys? Start with beginner-friendly picks, plainly explained.',
      'No wrong answers, no experience assumed. Just a guided place to start.',
      'Hand-checked picks for first-timers, not an overwhelming warehouse list.',
      'Beginner guides and body-safe materials, named clearly on every page.',
    ],
    paths: ['beginners', 'guide'],
  },
  discreet: {
    id: 'discreet',
    headlines: [
      'Plain Box, Plain Label', 'Discreet Shipping, Always', 'No Logos, No Labels', 'Statement Reads XDIPX',
      'Privacy, Built In', 'Discreet From Box to Bill', 'Plain Packaging, Every Order',
      'Not a Secret, Just Private', 'Return Address Reads XD Inc.', 'Your Privacy, Respected',
      'Billing Reads XDIPX Only', 'Shipped Plain, Every Time', 'Discreet Packaging, Verified',
      'Take a Peek', 'Find Your Fit',
    ],
    descriptions: [
      "Plain box, plain label. Not a secret, just nobody's business.",
      'Your statement reads XDIPX. Return address reads XD Inc.',
      'No branding on the box. Ordering stays your business, not ours.',
      'Discreet shipping on every order, every time, no exceptions.',
    ],
    paths: ['shipping', 'discreet'],
  },
  couples: {
    id: 'couples',
    headlines: [
      'Toys Made for Couples', 'Explore Together', 'Couples Vibrators, Explained', 'Shared Control, Made Easy',
      'Built for Two', 'Curated Picks for Couples', 'Vibrators for Shared Use', 'Wearable Couples Toys',
      'For Partners, Together', 'No Experience Needed, Together', 'Compare Couples Toys',
      'Body-Safe, Built for Two', 'Hand-Checked Couples Picks', 'Take a Peek', 'Find Your Fit',
    ],
    descriptions: [
      'Hand-checked couples toys, body-safe materials named on every page.',
      'Compare couples vibrators by fit, material, and control style.',
      'No wrong answers. Explore what works for both of you, together.',
      'Discreet shipping, plain packaging, statement reads XDIPX.',
    ],
    paths: ['couples', 'guide'],
  },
  curated: {
    id: 'curated',
    headlines: [
      'Hand-Checked, Not Listed', 'Curated, Not Auto-Listed', 'A Guided Toy Finder', 'Not a 50,000-SKU Warehouse',
      'Every Pick, Reviewed by Hand', "Don't Know Where to Start?", 'Answer 3 Questions, Get Picks',
      'Guided Shopping, No Guesswork', 'Skip the Endless Scroll', 'Curated Picks, Explained',
      'A Smaller, Smarter Catalog', 'Find Your Fit in Minutes', 'Try the Guided Finder', 'Take a Peek', 'Show Me',
    ],
    descriptions: [
      'Hand-checked picks, not an auto-listed warehouse. Answer a few questions.',
      "A guided finder for people who don't know where to start looking.",
      "Every product is reviewed by hand before it's ever listed for sale.",
      "No wrong answers. Tell us what you're looking for, we'll narrow it down.",
    ],
    paths: ['discover', 'guide'],
  },
}

export const THEME_IDS = Object.keys(COPY_THEMES) as ThemeId[]

/** Which theme an idea pads from: audience.theme, else a keyword read of the idea text, else curated. */
export function themeForIdea(args: { audienceTheme?: unknown; text: string }): ThemeId {
  const t = typeof args.audienceTheme === 'string' ? args.audienceTheme : ''
  if ((THEME_IDS as string[]).includes(t)) return t as ThemeId
  const s = args.text.toLowerCase()
  if (/\b(plain box|discreet|privacy|statement reads|billing)\b/.test(s)) return 'discreet'
  if (/\b(couple|partner|together|shared)\b/.test(s)) return 'couples'
  if (/\b(beginner|first[- ]time|first toy|new to)\b/.test(s)) return 'beginner'
  if (/\b(material|silicone|body-safe|glass|steel)\b/.test(s)) return 'materials'
  return 'curated'
}

// ---------------------------------------------------------------------------
// Keywords (launch plan section 3, corrected set) and the shared negative list
// ---------------------------------------------------------------------------

export type MatchType = 'Exact' | 'Phrase'

export interface PlannedKeyword { text: string; match: MatchType }

export interface AdGroupPlan {
  id: string
  name: string
  maxCpcUsd: number
  /** Collection path or PDP the group lands on, relative to the site. */
  landing: string
  keywords: PlannedKeyword[]
}

const ex = (text: string): PlannedKeyword => ({ text, match: 'Exact' })
const ph = (text: string): PlannedKeyword => ({ text, match: 'Phrase' })

export const AD_GROUP_PLANS: Readonly<Record<string, AdGroupPlan>> = {
  A: {
    id: 'A', name: 'lelo-brand', maxCpcUsd: 1.0, landing: '/collections/lelo',
    keywords: [ex('lelo gigi 3'), ex('lelo liv 3'), ex('lelo lily 3'), ex('lelo mia 3'), ex('lelo nea 3'), ex('lelo sona cruise'), ex('lelo mona'), ph('buy lelo'), ph('lelo vibrator')],
  },
  A0: {
    id: 'A0', name: 'magic-wand', maxCpcUsd: 1.4, landing: '/collections/magic-wand',
    keywords: [ex('magic wand original'), ex('magic wand rechargeable'), ex('magic wand hv 260'), ex('magic wand plus'), ex('magic wand mini'), ex('hitachi magic wand'), ph('magic wand massager')],
  },
  B: {
    id: 'B', name: 'wand', maxCpcUsd: 1.2, landing: '/collections/wands',
    keywords: [ex('wand massager'), ex('best wand massager'), ph('rechargeable wand massager'), ph('cordless wand massager')],
  },
  C: {
    id: 'C', name: 'couples', maxCpcUsd: 1.2, landing: '/collections/couples',
    keywords: [ex('couples vibrator'), ex('vibrator for couples'), ph('remote control couples vibrator')],
  },
  D: {
    id: 'D', name: 'lubricant', maxCpcUsd: 0.8, landing: '/collections/lubricants',
    keywords: [ex('water based lubricant'), ex('best water based lube'), ph('sliquid h2o'), ph('system jo lubricant')],
  },
}

/** Ad group guess from the idea's product handles and text when the idea names none. */
export function adGroupForIdea(args: { explicit?: unknown; handles: readonly string[]; text: string }): string | null {
  if (typeof args.explicit === 'string' && AD_GROUP_PLANS[args.explicit]) return args.explicit
  const s = `${args.handles.join(' ')} ${args.text}`.toLowerCase()
  if (/magic-?wand|hitachi/.test(s)) return 'A0'
  if (/lelo/.test(s)) return 'A'
  if (/lube|lubricant|sliquid|\bjo\b|h2o/.test(s)) return 'D'
  if (/couple|partner|remote/.test(s)) return 'C'
  if (/wand/.test(s)) return 'B'
  return null
}

/** Negatives, applied at campaign level before the first impression (launch plan section 3). */
export const NEGATIVE_GROUPS: Readonly<Record<string, string[]>> = {
  'age-ambiguous': ['teen', 'teens', 'teenage', 'young', 'younger', 'minor', 'minors', 'child', 'children', 'kid', 'kids', 'school', 'schoolgirl', 'student', 'barely legal'],
  'porn-intent': ['free', 'porn', 'xxx', 'video', 'videos', 'tube', 'cam', 'cams', 'webcam', 'live', 'stream', 'watch', 'hentai', 'nude', 'nudes', 'naked', 'pics', 'photos', 'gif', 'erotica', 'onlyfans', 'escort', 'hookup', 'dating'],
  diy: ['diy', 'homemade', 'how to make', 'make your own', 'substitute', 'alternative', 'household', '3d print'],
  'research-no-buy': ['what is', 'definition', 'meaning', 'wiki', 'wikipedia', 'reddit', 'quora', 'forum', 'side effects', 'dangerous', 'is it safe', 'study', 'research', 'symptoms', 'therapy', 'doctor', 'prescription'],
  'free-discount': ['freebie', 'giveaway', 'sample', 'coupon', 'promo code', 'voucher', 'cheap', 'cheapest', 'clearance'],
  'marketplace-competitor': ['amazon', 'walmart', 'target', 'ebay', 'aliexpress', 'temu', 'etsy', 'adam and eve', 'lovehoney', 'wholesale', 'bulk', 'dropship', 'distributor', 'near me', 'in store', 'local'],
  'support-non-commercial': ['repair', 'fix', 'manual', 'instructions', 'how to charge', 'warranty', 'return policy', 'refund', 'broken', 'troubleshoot', 'job', 'jobs', 'salary', 'affiliate program'],
}

export const ALL_NEGATIVES: readonly string[] = [...new Set(Object.values(NEGATIVE_GROUPS).flat())]

/** Parse a hand-written keyword: [exact], "phrase". Bare text becomes phrase. Broad is never produced. */
export function parseKeyword(raw: string): PlannedKeyword | null {
  const t = raw.trim()
  if (!t) return null
  const exact = /^\[(.+)\]$/.exec(t)
  if (exact) return ex(exact[1]!.trim().toLowerCase())
  const phrase = /^"(.+)"$/.exec(t)
  if (phrase) return ph(phrase[1]!.trim().toLowerCase())
  return ph(t.replace(/^\+/, '').toLowerCase())
}
