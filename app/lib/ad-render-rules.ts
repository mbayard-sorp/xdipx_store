/**
 * Pure rules for the Ad Studio render lane (Ad Studio v2 PR-C). No imports of
 * server modules, no I/O: the lane ceiling, the concept registry, the plate
 * prompt, slogan rotation, slogan fitting, gate aggregation and the export
 * payload skeleton all live here so they are unit-tested directly and the
 * Creatives tab can import the gate vocabulary.
 *
 * Sources: docs/ads-policy.md (Meta M2 object-first never on skin, adult
 * networks bounded only by the nudity definition, Snapchat non-graphic),
 * docs/store-team/ad-creative-concept-bank-2026-10-03.md section 6 (prompt
 * spec) and section 5 item 1 (text lives in a layout layer, never in the
 * generated pixels), docs/store-team/instagram-campaigns.md 3.2a and 3.2c.
 */
import { getAdFormat, type AdFormat } from '~/lib/ad-formats'

// ---------------------------------------------------------------------------
// Lanes and ceilings
// ---------------------------------------------------------------------------

/**
 * Lanes whose imagery is object-first archetype B only. Meta is the strict one
 * (M2: never in use, never on or against bare skin), Snapchat is non-graphic,
 * newsletter sponsorships are paid, and Search has no image at all.
 */
export const OBJECT_ONLY_LANES: readonly string[] = ['meta', 'snap', 'newsletter', 'google', 'microsoft']

/** Lanes that may use the on-skin and bodyscape axes (adult at the nudity definition, owned at 3.2a). */
export const ON_SKIN_LANES: readonly string[] = ['adult', 'owned']

export class AdLaneCeilingError extends Error {
  readonly lane: string
  constructor(lane: string, message: string) {
    super(message)
    this.name = 'AdLaneCeilingError'
    this.lane = lane
  }
}

export interface SceneAxesLite {
  cropScale?: string
  bodyZone?: string
  contactMode?: string
  sceneLocation?: string
}

export type PlateArchetype = 'B' | 'on-skin'
export type PlateGround = 'coral-soft' | 'plum-soft' | 'plaster'

export interface PlatePlan {
  archetype: PlateArchetype
  /** True when the frame carries a body zone or on-skin contact. */
  onSkin: boolean
  ground: PlateGround
  /** At most one hand over fabric (paid variant of Hands Only, The Gift, Second Spring). */
  allowHand: boolean
  /** Present only for an on-skin plan. */
  sceneAxes: SceneAxesLite | null
  /** Negatives appended to the prompt. Paid lanes carry the standard set, on-skin lanes add the 3.2a stop list. */
  negatives: string[]
}

/**
 * Throws when a plate plan breaks the lane's ceiling. Called by planPlate and
 * again by the renderer just before spend, so a plan built by any other path
 * is still checked.
 */
export function assertLaneCeiling(lane: string, plan: Pick<PlatePlan, 'archetype' | 'onSkin' | 'sceneAxes'>): void {
  if (!OBJECT_ONLY_LANES.includes(lane)) return
  const zone = plan.sceneAxes?.bodyZone
  const hasZone = typeof zone === 'string' && zone !== 'none'
  const contact = plan.sceneAxes?.contactMode
  const hasContact = typeof contact === 'string' && contact !== 'none'
  if (plan.archetype !== 'B' || plan.onSkin || hasZone || hasContact) {
    const why = lane === 'meta'
      ? 'Meta M2 is object-first: never in use, never on or against bare skin'
      : `the ${lane} lane is object-first archetype B only`
    throw new AdLaneCeilingError(lane, `${why} (docs/ads-policy.md). On-skin axes are refused for ${lane}.`)
  }
}

// ---------------------------------------------------------------------------
// Concept registry (concept bank section 2 and 6.2)
// ---------------------------------------------------------------------------

export type LayoutTemplate = 'plain-plate' | 'type-card' | 'banner-strip' | 'spec-diptych'
export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = ['plain-plate', 'type-card', 'banner-strip', 'spec-diptych']

export interface ConceptSpec {
  slug: string
  /** Mono kicker set on the card. */
  kicker: string
  /** Template for non-banner formats. banner-strip is chosen automatically for wide-short formats unless this is type-card. */
  layout: LayoutTemplate
  /** True when the concept is typographic and renders no plate at all. */
  typographicOnly: boolean
  /** Subject and composition (concept bank 6.2). */
  subject: string
  /** Lens and light. */
  lens: string
  /** When the body axis applies: always, only on owned, or never. */
  skin: 'always' | 'owned-only' | 'never'
  /** Hands-only family: a paid lane may show at most one hand. */
  handOk: boolean
  /** Axes briefed when the concept goes on skin. */
  skinAxes?: SceneAxesLite
  extraNegatives: string[]
}

const OBJECT_SUBJECT = 'The product alone, filling the frame, one curve and one seam in sharp focus.'

export const CONCEPTS: Readonly<Record<string, ConceptSpec>> = {
  'sculpture-hall': {
    slug: 'sculpture-hall', kicker: 'Sculpture hall', layout: 'plain-plate', typographicOnly: false,
    subject: 'One product filling the frame past its edges, one curve and one seam in sharp focus.',
    lens: '100mm macro, f/4, hard side light at 9am',
    skin: 'never', handOk: false, extraNegatives: ['no second object', 'no body'],
  },
  'body-map': {
    slug: 'body-map', kicker: 'Body map', layout: 'plain-plate', typographicOnly: false,
    subject: 'One body zone, the product resting under its own weight on bare skin, one closet piece closing a frame edge.',
    lens: '85mm, f/2.2, window light at a named hour, camera along the body plane',
    skin: 'always', handOk: false,
    skinAxes: { cropScale: 'close', bodyZone: 'hip-hollow', contactMode: 'resting', sceneLocation: 'bedroom-loft' },
    extraNegatives: ['no face unless briefed'],
  },
  'say-it-plain': {
    slug: 'say-it-plain', kicker: 'Say it plain', layout: 'type-card', typographicOnly: true,
    subject: '', lens: '', skin: 'never', handOk: false, extraNegatives: [],
  },
  'orchard': {
    slug: 'orchard', kicker: 'Orchard', layout: 'plain-plate', typographicOnly: false,
    subject: 'One fig, orchid or honey pull, a single concept, off-axis, with the product beside it.',
    lens: '100mm macro, f/5.6, raking 8am light',
    skin: 'never', handOk: false, extraNegatives: ['no bowl', 'no plate', 'no second fruit'],
  },
  'morning-after': {
    slug: 'morning-after', kicker: 'The morning after', layout: 'plain-plate', typographicOnly: false,
    subject: 'The product mid-interruption: cable still plugged in, lid beside the bottle, a robe belt on the floor.',
    lens: '35mm, f/2.8, low sun at 8am or 4pm',
    skin: 'never', handOk: false, extraNegatives: ['no tableware of any kind', 'no person in frame'],
  },
  'hands-only': {
    slug: 'hands-only', kicker: 'Hands only', layout: 'plain-plate', typographicOnly: false,
    subject: 'Two adult hands, different skin tones, one offering the product, one reaching.',
    lens: '50mm, f/2.8, hard window shadow across both',
    skin: 'never', handOk: true, extraNegatives: ['no third hand', 'no face', 'hands anatomically correct'],
  },
  'statement-reads-xdipx': {
    slug: 'statement-reads-xdipx', kicker: 'Statement reads XDIPX', layout: 'plain-plate', typographicOnly: false,
    subject: 'A plain box shot like jewellery, lid lifted one centimetre.',
    lens: '85mm, f/4, single hard key',
    skin: 'never', handOk: false, extraNegatives: ['no logo', 'no label', 'no tape print', 'no text on the box'],
  },
  'frequency': {
    slug: 'frequency', kicker: 'Frequency', layout: 'plain-plate', typographicOnly: false,
    subject: 'Water beads standing on the product head mid-jump, ripple rings in a thin water film.',
    lens: '100mm macro, 1/8000 freeze look, backlit',
    skin: 'never', handOk: false, extraNegatives: ['no lube texture', 'no bowl or glass', 'no body'],
  },
  'for-him-plainly': {
    slug: 'for-him-plainly', kicker: 'For him, plainly', layout: 'plain-plate', typographicOnly: false,
    subject: 'An adult man, bare chest, forearm or lower back, the product in hand or resting on the back.',
    lens: '85mm, f/2.2, morning side light',
    skin: 'always', handOk: false,
    skinAxes: { cropScale: 'close', bodyZone: 'forearm', contactMode: 'self-held', sceneLocation: 'bedroom-loft' },
    extraNegatives: ['product never at the groin', 'cleft closed by pose'],
  },
  'the-gift': {
    slug: 'the-gift', kicker: 'The gift', layout: 'plain-plate', typographicOnly: false,
    subject: 'The product half unwrapped, tissue pulled back, a blank tag.',
    lens: '50mm, f/2.8, soft daylight with a hard edge',
    skin: 'never', handOk: true, extraNegatives: ['no writing on the tag', 'no holiday cliches'],
  },
  'overheard-at-the-counter': {
    slug: 'overheard-at-the-counter', kicker: 'At the xdipx counter', layout: 'type-card', typographicOnly: true,
    subject: '', lens: '', skin: 'never', handOk: false, extraNegatives: [],
  },
  'ask-emma': {
    slug: 'ask-emma', kicker: 'Ask Emma', layout: 'type-card', typographicOnly: true,
    subject: '', lens: '', skin: 'never', handOk: false, extraNegatives: [],
  },
  'spec-sheet': {
    slug: 'spec-sheet', kicker: 'Spec sheet', layout: 'spec-diptych', typographicOnly: false,
    subject: 'The product alone on its tint, for compositing into the template.',
    lens: '85mm, f/5.6, even high-key with one shadow edge',
    skin: 'never', handOk: false, extraNegatives: ['no text', 'no props'],
  },
  'second-spring': {
    slug: 'second-spring', kicker: 'Second spring', layout: 'plain-plate', typographicOnly: false,
    subject: "An adult woman's hand, age shown plainly, holding the moisturizer or a kegel weight.",
    lens: '50mm, f/2.8, morning window light',
    skin: 'owned-only', handOk: true,
    skinAxes: { cropScale: 'close', bodyZone: 'stomach', contactMode: 'resting', sceneLocation: 'bedroom-loft' },
    extraNegatives: ['no wit', 'no scale exaggeration', 'no clinical props'],
  },
}

const DEFAULT_CONCEPT: ConceptSpec = {
  slug: 'default', kicker: 'xdipx', layout: 'plain-plate', typographicOnly: false,
  subject: OBJECT_SUBJECT, lens: '100mm macro, f/4, hard side light at 9am',
  skin: 'never', handOk: false, extraNegatives: [],
}

export function getConcept(slug: string): ConceptSpec {
  return CONCEPTS[slug] ?? { ...DEFAULT_CONCEPT, slug }
}

/**
 * Whether a concept at a lane and register renders a plate. Statement Reads
 * XDIPX is a type card at register 3-4 (no product in frame, the Meta carve-out
 * line) and a plain-box plate at 6-7 and above.
 */
export function conceptUsesPlate(concept: ConceptSpec, tier: string): boolean {
  if (concept.typographicOnly) return false
  if (concept.slug === 'statement-reads-xdipx' && (tier === '3-4' || tier === '4-5')) return false
  return true
}

/** Whether this concept is on skin at this lane. */
export function conceptIsOnSkin(concept: ConceptSpec, lane: string): boolean {
  if (concept.skin === 'always') return true
  if (concept.skin === 'owned-only') return lane === 'owned'
  return false
}

// ---------------------------------------------------------------------------
// Plate plan and prompt (concept bank 6.1)
// ---------------------------------------------------------------------------

/** Standard negatives, every prompt (6.1). */
export const STANDARD_NEGATIVES: readonly string[] = [
  'no watermark', 'no caption', 'no invented text', 'no letters', 'no barcode', 'no shipping label',
  'no ingredient panel', 'no retail carton', 'no handwriting on any prop surface', 'no mugs', 'no cups', 'no bowls',
  'no candles', 'no napkins', 'no styled tables', 'no candlelight', 'no dark room',
]

/** The 3.2a stop list, added on every frame with a body (6.1, as of 2026-10-03). */
export const ON_SKIN_NEGATIVES: readonly string[] = [
  'no visible or outlined female nipple, areola edge or sheer fabric over it',
  'no visible or outlined labia, penis or anus',
  'no hand on genitals over or under clothing',
  'no product against genitalia or on any nipple',
  'no fluid near genitalia',
  'no depicted sex act',
  'no pubic hair above a lingerie line',
  'no bulky knit, towel or draped bedding on the body',
  'no unbriefed marks, redness or bruising',
  'no youthful or age-ambiguous face or body',
]

export interface PlanInput {
  lane: string
  registerTier: string
  conceptSlug: string
  ideaId: number
}

/** Ground rotation: coral-soft or plum-soft by idea id, so a set does not look like one colour. */
export function pickGround(ideaId: number): PlateGround {
  return ideaId % 2 === 0 ? 'coral-soft' : 'plum-soft'
}

const HOURS = ['9am', '8am', '4pm', 'noon'] as const
export function pickHour(ideaId: number): string {
  return HOURS[Math.abs(ideaId) % HOURS.length]!
}

/**
 * Build the plate plan for a creative. Throws AdLaneCeilingError when the
 * concept would go on skin at an object-only lane, before anything is spent.
 */
export function planPlate(input: PlanInput): PlatePlan {
  const concept = getConcept(input.conceptSlug)
  const onSkin = conceptIsOnSkin(concept, input.lane)
  const plan: PlatePlan = onSkin
    ? {
        archetype: 'on-skin',
        onSkin: true,
        ground: 'plaster',
        allowHand: false,
        sceneAxes: concept.skinAxes ?? { cropScale: 'close', bodyZone: 'forearm', contactMode: 'resting', sceneLocation: 'bedroom-loft' },
        negatives: [...STANDARD_NEGATIVES, ...ON_SKIN_NEGATIVES, ...concept.extraNegatives],
      }
    : {
        archetype: 'B',
        onSkin: false,
        ground: pickGround(input.ideaId),
        allowHand: concept.handOk,
        sceneAxes: null,
        negatives: [...STANDARD_NEGATIVES, ...concept.extraNegatives],
      }
  assertLaneCeiling(input.lane, plan)
  if (plan.onSkin && !ON_SKIN_LANES.includes(input.lane)) {
    throw new AdLaneCeilingError(input.lane, `On-skin frames are allowed only on ${ON_SKIN_LANES.join(' and ')} (docs/ads-policy.md creative rules).`)
  }
  return plan
}

const GROUND_WORDS: Record<PlateGround, string> = {
  'coral-soft': 'coral-soft (#FFE6DD) raw plaster wall',
  'plum-soft': 'plum-soft (#F3E8FB) raw plaster wall',
  plaster: 'bright white plaster',
}

export interface PromptInput {
  plan: PlatePlan
  conceptSlug: string
  ideaId: number
  productTitle: string
  format: AdFormat
}

/**
 * The plate prompt (concept bank 6.1 and 6.2). The plate never contains text:
 * the slogan is composited in the layout layer. A clear quiet area is requested
 * on one side so the template has room.
 */
export function buildPlatePrompt(input: PromptInput): string {
  const concept = getConcept(input.conceptSlug)
  const { plan, format } = input
  const subject = concept.subject || OBJECT_SUBJECT
  const lens = concept.lens || '100mm macro, f/4, hard side light at 9am'
  const quiet = format.family === 'wide' || format.family === 'banner'
    ? 'Keep the left 45 percent of the frame a calm, empty field.'
    : format.family === 'story'
      ? 'Keep the lower 35 percent of the frame a calm, empty field.'
      : 'Keep the lower 30 percent of the frame a calm, empty field.'
  const parts: string[] = []
  if (plan.archetype === 'B') {
    parts.push(
      `Archetype B object-first product plate for a wellness advertisement. The product is exactly the one in the reference image (${input.productTitle}): same shape, colour and finish, shown at its true size.`,
      subject,
      `Ground: ${GROUND_WORDS[plan.ground]}, a flat even field.`,
      `${lens}. High-key daylight at ${pickHour(input.ideaId)}, a hard directional edge so the shadow has shape.`,
      plan.allowHand
        ? 'At most one adult hand in frame, holding or offering the product over fabric, nothing else of a body.'
        : 'No body, no skin, no hands.',
    )
  } else {
    const ax = plan.sceneAxes ?? {}
    parts.push(
      `On-skin bodyscape frame for an owned or adult surface. The product is exactly the one in the reference image (${input.productTitle}): same shape, colour and finish.`,
      subject,
      `Crop ${ax.cropScale ?? 'close'}, zone ${ax.bodyZone ?? 'forearm'}, contact ${ax.contactMode ?? 'resting'}. No ground: the hour of the light and one sheet or surface edge carry the world.`,
      `${lens}. High-key daylight at ${pickHour(input.ideaId)}, a hard directional edge.`,
      'Adult subject, age shown plainly.',
    )
  }
  parts.push(quiet)
  parts.push(`Negatives: ${plan.negatives.join(', ')}. The image must contain no text of any kind.`)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Slogan rotation
// ---------------------------------------------------------------------------

export function normaliseSlogan(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface PickSloganInput {
  headlines: readonly string[]
  /** Slogans used by other ideas' creatives in the last 30 days. Never reused. */
  usedElsewhere: ReadonlySet<string>
  /** 0-based position of this creative within its idea, drives rotation. */
  index: number
  /** Prefer a headline that fits; falls back to the shortest when none does. */
  maxChars?: number
}

/**
 * Pick a slogan from an idea's headlines. Headlines used by another idea's
 * creative inside the 30 day window are excluded (compared normalised). The
 * remaining ones rotate by creative index, so an idea's sizes use different
 * lines until the fresh headlines run out, then wrap. Returns null when every
 * headline is spent, so the creative is skipped with a reason instead of
 * reusing a retired line.
 */
export function pickSlogan(input: PickSloganInput): string | null {
  const seen = new Set<string>()
  const fresh = input.headlines
    .map(h => h.trim())
    .filter(h => {
      if (!h) return false
      const key = normaliseSlogan(h)
      if (seen.has(key) || input.usedElsewhere.has(key)) return false
      seen.add(key)
      return true
    })
  if (fresh.length === 0) return null
  const fits = input.maxChars ? fresh.filter(h => h.length <= input.maxChars!) : fresh
  const pool = fits.length > 0 ? fits : [fresh.slice().sort((a, b) => a.length - b.length)[0]!]
  return pool[Math.abs(input.index) % pool.length]!
}

// ---------------------------------------------------------------------------
// Slogan fitting (legibility)
// ---------------------------------------------------------------------------

export interface FitInput {
  text: string
  boxWidth: number
  boxHeight: number
  maxFont: number
  minFont: number
  maxLines: number
  /** Average glyph advance as a fraction of font size. Newsreader runs near 0.46. */
  glyphRatio?: number
  lineHeight?: number
}

export interface FitResult {
  fontSize: number
  lines: number
  /** True when even the minimum font overflows the box. The text gate blocks on it. */
  truncated: boolean
}

/** Wrap by words at a font size, using an average glyph advance. Pure estimate, tested. */
export function wrapLines(text: string, boxWidth: number, fontSize: number, glyphRatio = 0.46): number {
  const charsPerLine = Math.max(1, Math.floor(boxWidth / (fontSize * glyphRatio)))
  const words = text.trim().split(/\s+/).filter(Boolean)
  let lines = 1
  let cur = 0
  for (const w of words) {
    const len = w.length
    if (cur === 0) { cur = len; if (len > charsPerLine) lines += Math.ceil(len / charsPerLine) - 1; continue }
    if (cur + 1 + len <= charsPerLine) cur += 1 + len
    else { lines += 1; cur = len; if (len > charsPerLine) lines += Math.ceil(len / charsPerLine) - 1 }
  }
  return lines
}

/** Largest font size in [minFont, maxFont] whose wrapped text fits the box. */
export function fitSlogan(input: FitInput): FitResult {
  const glyph = input.glyphRatio ?? 0.46
  const lh = input.lineHeight ?? 1.08
  for (let size = Math.floor(input.maxFont); size >= Math.ceil(input.minFont); size--) {
    const lines = wrapLines(input.text, input.boxWidth, size, glyph)
    if (lines <= input.maxLines && lines * size * lh <= input.boxHeight) {
      return { fontSize: size, lines, truncated: false }
    }
  }
  const lines = wrapLines(input.text, input.boxWidth, input.minFont, glyph)
  return { fontSize: Math.ceil(input.minFont), lines: Math.min(lines, input.maxLines), truncated: true }
}

// ---------------------------------------------------------------------------
// Layout choice
// ---------------------------------------------------------------------------

/** Wide-short formats take the strip. 300x100 is 3:1, 728x90 about 8:1, 900x250 3.6:1. */
export function isStripFormat(format: Pick<AdFormat, 'width' | 'height'>): boolean {
  return format.width / format.height >= 2.8
}

export function chooseLayout(concept: ConceptSpec, format: AdFormat, usesPlate: boolean): LayoutTemplate {
  if (!usesPlate) return 'type-card'
  if (concept.layout === 'type-card') return 'type-card'
  if (isStripFormat(format)) return 'banner-strip'
  return concept.layout
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export const GATE_ORDER = ['vision', 'product', 'voice', 'policy', 'text'] as const
export type GateName = typeof GATE_ORDER[number]
export type GateState = 'pass' | 'revise' | 'block' | 'not_run'

export interface GateResult {
  state: GateState
  /** One line, shown when the chip expands. */
  reason: string
  /** Provider or model request id, when one exists. */
  requestId?: string | null
}

export type GatesJson = Record<GateName, GateResult>

export function notRun(reason: string): GateResult {
  return { state: 'not_run', reason }
}

/** Status for the creative row: any block blocks, everything else is a draft for the owner. */
export function aggregateGates(gates: GatesJson): 'blocked' | 'draft' {
  return GATE_ORDER.some(n => gates[n]?.state === 'block') ? 'blocked' : 'draft'
}

export function emptyGates(reason = 'Not run'): GatesJson {
  return { vision: notRun(reason), product: notRun(reason), voice: notRun(reason), policy: notRun(reason), text: notRun(reason) }
}

export function isGatesJson(v: unknown): v is GatesJson {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return GATE_ORDER.every(n => {
    const g = o[n] as Record<string, unknown> | undefined
    return !!g && typeof g['state'] === 'string' && typeof g['reason'] === 'string'
  })
}

// ---------------------------------------------------------------------------
// Export payload skeleton (PR-E fills the rest)
// ---------------------------------------------------------------------------

export interface ExportPayloadSkeleton {
  lane: string
  format: string
  slogan: string | null
  headlines: string[]
  destination_url: string | null
}

export function buildExportPayload(input: {
  lane: string
  format: string
  slogan: string | null
  headlines: readonly string[]
  destinationUrl: string | null
}): ExportPayloadSkeleton {
  return {
    lane: input.lane,
    format: input.format,
    slogan: input.slogan,
    headlines: [...input.headlines],
    destination_url: input.destinationUrl,
  }
}

/** Decide the format record for a stored id, throwing on an unknown one. */
export function requireFormat(id: string): AdFormat {
  const f = getAdFormat(id)
  if (!f) throw new Error(`Unknown ad format "${id}"`)
  return f
}
