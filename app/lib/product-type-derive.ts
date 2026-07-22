/**
 * Derive a canonical Shopify product_type from Nalpac feed data.
 *
 * The pricing engine v2 (pricing-apply-v2.server.ts -> resolvePricingConfig)
 * keys group/sub-group/rule resolution on the Shopify product_type field via
 * the pricing_product_type_map table. A product created without a type falls
 * through to the global 50%-margin rule, which is how ~380 imports got
 * unwanted auto-applied price increases on 2026-07-21. Every import path must
 * therefore set product_type at creation time, and the enrich/publish path
 * guards against products going live without one.
 *
 * This module is intentionally pure (no .server suffix, no imports) so the
 * derivation rules are unit-testable. The runtime source of truth for the
 * vocabulary is the pricing_product_type_map table; CANONICAL_PRODUCT_TYPES
 * below is a static snapshot of it, and product-type.server.ts re-validates
 * derived values against the live table before publish.
 */

/** Snapshot of pricing_product_type_map.product_type (86 rows, 2026-07-22).
 *  If a new type is added to the table, add it here too so derivation rules
 *  can target it. Types removed from the table are caught at publish time by
 *  the live-table check in product-type.server.ts. */
export const CANONICAL_PRODUCT_TYPES: readonly string[] = [
  // anal
  'Anal Beads', 'Anal Plug', 'Anal Toy', 'Anal Training Kit', 'Prostate Massager', 'Vibrating Anal Toy',
  // arousal_performance
  'Arousal Gel', 'Desensitizer', 'Enhancer', 'Oral Enhancer',
  // cock_rings
  'Cock Ring',
  // couples
  'Couples Toy', 'Couples Vibrator',
  // dildos
  'Dildo', 'Fantasy Dildo', 'Realistic Dildo', 'Silicone Dildo', 'Strap-On Dildo',
  // discontinued
  'Discontinued',
  // extenders_supplements
  'Enhancement Supplement', 'Penis Extender', 'Penis Sleeve', 'Supplement / Pill',
  // external_clitoral
  'Bullet Vibrator', 'Clitoral Vibrator', 'Suction Vibrator', 'Vibrator',
  // fetish_wear
  'Body Harness', 'Cage / Chastity', 'Fetish Wear', 'Fetishwear', 'Mask',
  // gift_card
  'Gift Card',
  // harnesses
  'Strap-On Harness',
  // hosiery
  'Hosiery',
  // hygiene_care
  'Bath & Body', 'Body Care', 'Douche / Enema', 'Intimate Hygiene', 'Toy Cleaner', 'Wipe / Hygiene',
  // impact_sensory
  'Ball Gag', 'Blindfold', 'Electrostim Kit', 'Gag', 'Paddle',
  // internal
  'G-Spot Vibrator', 'Rabbit Vibrator',
  // lingerie
  'Apparel', 'Babydoll / Chemise', 'Bodystocking', 'Bodysuit', 'Bra & Panty Set', 'Dress',
  'Lingerie Set', 'Panty', 'Pasties',
  // lubricants
  'Lubricant', 'Vaginal Moisturizer',
  // mens
  "Men's Underwear",
  // novelty_games
  'Adult Game', 'Erotic Books', 'Novelty Gift',
  // oils_fragrance
  'Massage Candle', 'Massage Oil', 'Pheromone', 'Pheromone Fragrance',
  // other_accessory
  'Accessory', 'Sex Furniture',
  // protection
  'Condom',
  // pumps
  'Enhancement Pump', 'Penis Pump', 'Pussy Pump',
  // restraints_collars
  'Bondage Kit', 'Collar', 'Restraints',
  // sex_machines
  'Sex Machine',
  // stimulators
  'Kegel Exerciser', 'Kegel Trainer', 'Nipple Clamps', 'Nipple Toy',
  // strokers
  'Sex Doll', 'Stroker',
  // vibrating_dildos
  'Thrusting Vibrator', 'Vibrating Dildo',
  // wands
  'Wand Massager',
]

const CANONICAL_SET = new Set(CANONICAL_PRODUCT_TYPES)

/** Normalize a category or alias for comparison: lowercase, collapse anything
 *  non-alphanumeric to single spaces. Makes matching robust to the feed's
 *  apostrophe/quote encoding quirks ("COUPLES' VIBRATORS"), hyphens, and case. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Priority-ordered category rules. For each rule (top to bottom), if ANY of the
 * product's normalized categories equals one of the rule's aliases, that rule's
 * type wins. Order encodes specificity: e.g. "Vibrating Cockrings" must beat
 * the couples-vibrator categories it co-occurs with, and stroker categories
 * must beat the generic "Non-Realistic" dildo modifier.
 *
 * Pure modifier categories (Strap-on Compatible, Remote, Colored, Large, sale
 * tags, program tags like abs-altitude-2025) are deliberately absent — they
 * never determine a type on their own.
 */
const CATEGORY_RULES: ReadonlyArray<{ type: string; aliases: string[] }> = [
  // Gift card first — unambiguous.
  { type: 'Gift Card', aliases: ['gift card', 'gift cards'] },

  // Strokers / masturbators — before dildo rules ("Non-Realistic" co-occurs).
  { type: 'Stroker', aliases: [
    'vagina strokers', 'butt strokers', 'mouth strokers', 'pocket strokers',
    'vibrating masturbators and strokers', 'hands free masturbators and strokers',
    'hands free masturbators', 'celebrity molded masturbators and strokers',
    'masturbators', 'masturbators and strokers', 'disposable strokers',
    'vibrating strokers', 'body molds',
  ] },
  { type: 'Sex Doll', aliases: ['dolls'] },

  // Machines before generic vibrator rules ("Rotating and Thrusting" co-occurs).
  { type: 'Sex Machine', aliases: ['sex machines'] },

  // Electrostim before rabbit/anal (co-occurs with both).
  { type: 'Electrostim Kit', aliases: ['electrostim'] },

  // Cock rings — before couples categories they co-occur with.
  { type: 'Cock Ring', aliases: [
    'vibrating cockrings', 'cockring sets', 'cock rings',
    'straps and adjustable cockrings', 'cock and ball slings', 'ball stretchers',
    'slings',
    // "Classic" is Nalpac's Cockrings > Classic subcategory — it never
    // co-occurs with non-ring categories in the live feed data.
    'classic',
  ] },

  // Anal — specific before generic.
  { type: 'Prostate Massager', aliases: ['prostate toys', 'prostate'] },
  { type: 'Anal Beads', aliases: ['beads and balls', 'anal beads'] },
  { type: 'Vibrating Anal Toy', aliases: ['vibrating anal toys'] },
  { type: 'Anal Toy', aliases: ['asslocks'] },
  { type: 'Anal Plug', aliases: ['plugs and probes', 'tails'] },

  // Kegel before bullets ("Bullets and Eggs,Kegel Toys,Remote" is a kegel egg).
  { type: 'Kegel Exerciser', aliases: ['kegel toys'] },

  // Wands before g-spot (wand attachments get co-tagged g-spot).
  { type: 'Wand Massager', aliases: ['wands'] },

  // Vibrators — specific shapes before the generic bucket.
  { type: 'Rabbit Vibrator', aliases: ['dual action and rabbits'] },
  { type: 'Thrusting Vibrator', aliases: ['rotating and thrusting vibrators'] },
  { type: 'Suction Vibrator', aliases: ['air pulse and suction', 'air pulsation toys'] },
  { type: 'G-Spot Vibrator', aliases: ['g spot and classic slimline', 'g spot vibrators'] },
  { type: 'Clitoral Vibrator', aliases: ['finger and clit', 'clit and vulva'] },
  { type: 'Bullet Vibrator', aliases: ['bullets and eggs'] },
  { type: 'Couples Vibrator', aliases: ['couples and wearable', 'couples vibrators', 'top couples toys'] },

  // Dildos — vibrating > strapless/double > fantasy > realistic > silicone > generic.
  { type: 'Vibrating Dildo', aliases: ['vibrating dildos and dongs', 'realistic vibrators'] },
  { type: 'Strap-On Dildo', aliases: ['strapless strap ons and double dildos'] },
  { type: 'Fantasy Dildo', aliases: ['fantasy dildos'] },
  { type: 'Realistic Dildo', aliases: ['realistic', 'celebrity molded dildos and dongs', 'dual density', 'triple density'] },
  { type: 'Silicone Dildo', aliases: ['silicone dildos and dongs'] },
  { type: 'Dildo', aliases: ['non realistic', 'non phallic', 'glass and metal', 'jelly', 'ejaculating', 'packers', 'packing'] },

  // Remaining generic vibrator buckets — after every specific shape.
  { type: 'Vibrator', aliases: ['vibrator kits', 'vibrators and massagers', 'humping and grinding toys'] },

  // Strap-on harnesses (bare "Strap-on" category; "Strap-on Compatible" is a
  // modifier and intentionally NOT an alias here).
  { type: 'Strap-On Harness', aliases: ['strap on'] },

  // Male enhancement.
  { type: 'Penis Sleeve', aliases: ['sleeves'] },
  { type: 'Penis Extender', aliases: ['penis extenders', 'vibrating penis extenders'] },
  { type: 'Penis Pump', aliases: ['penis'] },
  { type: 'Supplement / Pill', aliases: ['pills', 'shots honeys and nectars', 'gummies and edibles'] },
  { type: 'Enhancer', aliases: ['male arousal'] },

  // Bondage / fetish — before apparel (fetish wear co-occurs with costumes).
  { type: 'Restraints', aliases: ['restraints'] },
  { type: 'Collar', aliases: ['collars and leashes'] },
  { type: 'Paddle', aliases: ['paddles whips and ticklers'] },
  { type: 'Gag', aliases: ['gags'] },
  { type: 'Blindfold', aliases: ['blindfolds'] },
  { type: 'Mask', aliases: ['masks'] },
  { type: 'Cage / Chastity', aliases: ['chastity', 'cages'] },
  { type: 'Body Harness', aliases: ['body harnesses'] },
  { type: 'Fetish Wear', aliases: ['fetish and roleplay'] },
  { type: 'Bondage Kit', aliases: ['bondage accessories'] },
  { type: 'Sex Furniture', aliases: ['swings slings and door jams', 'positioning aids'] },

  // Lubes & topicals — actives before carrier bases.
  { type: 'Desensitizer', aliases: ['desensitizers and relaxers'] },
  { type: 'Arousal Gel', aliases: ['arousal gels creams and balms', 'female arousal'] },
  { type: 'Oral Enhancer', aliases: ['oral'] },
  { type: 'Lubricant', aliases: [
    'water based', 'silicone based', 'hybrid', 'oil based', 'flavored', 'natural',
    'anal lubes', 'warming cooling and stimulating', 'lubricants',
    'lubricant sets and kits', 'masturbation creams',
  ] },
  { type: 'Massage Candle', aliases: ['candles', 'drip candles'] },
  { type: 'Massage Oil', aliases: ['massage', 'cbd products'] },
  { type: 'Pheromone Fragrance', aliases: ['perfumes colognes and pheromone fragrances'] },

  // Lingerie & apparel — specific garments before the generic bucket.
  { type: 'Lingerie Set', aliases: ['lingerie sets'] },
  { type: 'Bra & Panty Set', aliases: ['bra and panty sets'] },
  { type: 'Bodysuit', aliases: ['bodysuits and teddies'] },
  { type: 'Babydoll / Chemise', aliases: ['babydolls and chemises'] },
  { type: 'Bodystocking', aliases: ['bodystockings'] },
  { type: 'Dress', aliases: ['dresses'] },
  { type: 'Panty', aliases: ['panties'] },
  { type: 'Pasties', aliases: ['pasties'] },
  { type: 'Hosiery', aliases: ['hosiery', 'socks'] },
  { type: "Men's Underwear", aliases: ['men s underwear'] },
  { type: 'Apparel', aliases: [
    'apparel', 'costumes', 'corsets and bustiers', 'lingerie plus queen size',
    'lingerie hanging', 'sleepwear and pj s',
  ] },

  // Stimulators.
  { type: 'Nipple Toy', aliases: ['nipples', 'nipple'] },

  // Hygiene & care.
  { type: 'Toy Cleaner', aliases: ['toy cleaners'] },
  { type: 'Douche / Enema', aliases: ['douches and enemas'] },
  { type: 'Wipe / Hygiene', aliases: ['cleansers and body wipes'] },
  { type: 'Intimate Hygiene', aliases: ['hygiene'] },
  { type: 'Body Care', aliases: ['body care', 'aftercare', 'wellness'] },

  // Protection — Nalpac files condoms under brand-name categories.
  { type: 'Condom', aliases: ['condoms', 'trojan', 'lifestyles', 'magnum', 'trustex', 'glyde'] },

  // Novelty & games.
  { type: 'Adult Game', aliases: ['games', 'games and party supplies'] },
  { type: 'Erotic Books', aliases: ['books', 'coloring books'] },
  { type: 'Novelty Gift', aliases: [
    'novelty gifts', 'candy and edible novelties', 'party supplies',
    'pins and keychains', 'tiaras sashes and hats', 'plushies and pillows',
    'romance and accessories', 'gift sets and kits',
  ] },

  // Accessory catch-alls — last so anything more specific wins.
  { type: 'Accessory', aliases: [
    'accessories', 'accessories and attachments', 'batteries and chargers',
    'toy storage', 'pump accessories', 'masturbator and stroker accessories',
    'lubricant applicators', 'o rings and cushions', 'bedroom accessories',
  ] },
]

/**
 * Title-keyword fallback, used only when no category rule matched. Ordered by
 * specificity; all patterns are word-bounded to avoid substring surprises
 * ("gag" in "engage"). Matched against the normalized title.
 */
const TITLE_RULES: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  { type: 'Gift Card',        pattern: /\bgift card\b/ },
  { type: 'Wand Massager',    pattern: /\bwand\b/ },
  { type: 'Rabbit Vibrator',  pattern: /\brabbit\b/ },
  { type: 'Suction Vibrator', pattern: /\b(air pulse|suction)\b/ },
  { type: 'Bullet Vibrator',  pattern: /\bbullet\b/ },
  { type: 'Anal Beads',       pattern: /\banal beads?\b/ },
  { type: 'Prostate Massager', pattern: /\bprostate\b/ },
  { type: 'Anal Plug',        pattern: /\bplug\b/ },
  { type: 'Penis Sleeve',     pattern: /\b(penis|cock) sleeve\b/ },
  { type: 'Stroker',          pattern: /\b(stroker|masturbator)\b/ },
  { type: 'Cock Ring',        pattern: /\b(cock ?ring|c ring|love ring)\b/ },
  { type: 'Strap-On Harness', pattern: /\bharness\b/ },
  { type: 'Babydoll / Chemise', pattern: /\b(babydoll|chemise)\b/ },
  { type: 'Sex Doll',         pattern: /\bdoll\b/ },
  { type: 'Sex Machine',      pattern: /\b(sex|thrusting) machine\b/ },
  { type: 'Vibrating Dildo',  pattern: /\bvibrating (dildo|dong)\b/ },
  { type: 'Dildo',            pattern: /\b(dildo|dong)\b/ },
  { type: 'Kegel Exerciser',  pattern: /\bkegel\b/ },
  { type: 'Nipple Clamps',    pattern: /\bnipple clamps?\b/ },
  { type: 'Nipple Toy',       pattern: /\bnipple\b/ },
  { type: 'Penis Pump',       pattern: /\bpump\b/ },
  { type: 'Massage Oil',      pattern: /\bmassage oil\b/ },
  { type: 'Massage Candle',   pattern: /\bcandle\b/ },
  { type: 'Lubricant',        pattern: /\b(lube|lubricant)\b/ },
  { type: 'Condom',           pattern: /\bcondoms?\b/ },
  { type: 'Toy Cleaner',      pattern: /\b(toy )?cleaner\b/ },
  { type: 'Douche / Enema',   pattern: /\b(douche|enema)\b/ },
  { type: 'Pheromone Fragrance', pattern: /\bpheromone\b/ },
  { type: 'Blindfold',        pattern: /\bblindfold\b/ },
  { type: 'Paddle',           pattern: /\b(paddle|flogger|crop|whip)\b/ },
  { type: 'Gag',              pattern: /\bgag\b/ },
  { type: 'Collar',           pattern: /\bcollar\b/ },
  { type: 'Restraints',       pattern: /\b(restraint|cuffs?|hogtie)\b/ },
  { type: 'Bodystocking',     pattern: /\bbodystocking\b/ },
  { type: 'Bodysuit',         pattern: /\b(bodysuit|teddy)\b/ },
  { type: 'Panty',            pattern: /\b(panty|panties|thong)\b/ },
  { type: 'Hosiery',          pattern: /\b(hosiery|stockings?|pantyhose)\b/ },
  { type: 'Adult Game',       pattern: /\bgame\b/ },
  // Generic vibrator last among toys — nearly every toy title mentions "vibe"
  // when it vibrates, so this must not shadow the shapes above.
  { type: 'Vibrator',         pattern: /\b(vibrator|vibe|massager)\b/ },
]

export interface DeriveProductTypeInput {
  /** Nalpac Sub-Category values. Elements may themselves be comma-joined
   *  (some feed rows arrive that way); they are split before matching. */
  categories: readonly string[]
  title: string
}

export interface DeriveProductTypeResult {
  productType: string | null
  matchedBy: 'category' | 'title' | null
}

/** Derive the canonical product_type for a product, or null when nothing in
 *  the categories or title resolves. Callers log the null case — a product
 *  without a type prices on the global fallback rule. */
export function deriveProductType(input: DeriveProductTypeInput): DeriveProductTypeResult {
  const cats = new Set(
    input.categories
      .flatMap(c => c.split(','))
      .map(norm)
      .filter(Boolean),
  )

  if (cats.size > 0) {
    for (const rule of CATEGORY_RULES) {
      if (rule.aliases.some(a => cats.has(a))) {
        return { productType: rule.type, matchedBy: 'category' }
      }
    }
  }

  const title = norm(input.title)
  if (title) {
    for (const rule of TITLE_RULES) {
      if (rule.pattern.test(title)) {
        return { productType: rule.type, matchedBy: 'title' }
      }
    }
  }

  return { productType: null, matchedBy: null }
}

/** True when `type` is in the static canonical vocabulary snapshot. */
export function isCanonicalProductType(type: string): boolean {
  return CANONICAL_SET.has(type)
}

/** Every type the rules can emit — exported for the drift test that asserts
 *  all rule outputs are canonical. */
export function allRuleOutputTypes(): string[] {
  return [...new Set([...CATEGORY_RULES.map(r => r.type), ...TITLE_RULES.map(r => r.type)])]
}
