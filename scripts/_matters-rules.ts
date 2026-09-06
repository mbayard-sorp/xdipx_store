/**
 * Deterministic "What Matters" chip rules for the xdipx v2 backfill (step 5.5).
 *
 * Source of truth: docs/what-matters-backfill-scope.md §"Rule-first pass",
 * with the Co-Work-amended Easy-to-clean rule.
 *
 * This file encodes M-BEG-1 through M-LAT-1 (one rule ID per chip) so tags
 * can be applied deterministically before any subagent / Claude call.
 * Pure functions, no I/O. No imports from app/ except the type file.
 *
 * Tag values emitted are EXACTLY the MATTERS_V2 sentence-case strings.
 * Verify against app/types/discovery.ts before editing the literals here.
 */

// Only import the type-level vocabulary for the allow-list comment — the actual
// string literals are inlined so this file stays importable from scripts/
// without touching the app/ module graph at runtime.

// ── Vocabulary (must match MATTERS_V2 in app/types/discovery.ts) ────────────
// 'Beginner-friendly' | 'Whisper-quiet' | 'Waterproof' | 'Travel-ready' |
// 'Discreet' | 'Hands-free' | 'Remote-controlled' | 'Plus-size friendly' |
// 'Easy to clean' | 'Rechargeable' | 'Soft-touch' | 'Latex-free'

export interface RuleInput {
  /** Shopify standard product type, e.g. "Vibrator", "Anal Plug" */
  productType:       string | null
  /** Shopify product tags (raw, mixed-case) */
  tags:              string[]
  /** Lowercased product title */
  title:             string
  /** Lowercased plain-text descriptionHtml excerpt (first ~800 chars) */
  bodyExcerpt:       string
  /** Lowercased custom.original_description metafield text (Nalpac spec dump) */
  nalpacDescription: string
  /** Vendor name as set in Shopify */
  vendor:            string
  /** Lowercased collection handles the product belongs to */
  collections:       string[]
  /**
   * Non-porous materials parsed from spec sheets / nalpacDescription upstream.
   * Canonical lowercase values: 'silicone', 'glass', 'borosilicate',
   * 'stainless-steel', 'ceramic', 'abs', 'tpe', 'rubber', 'latex',
   * 'pvc', 'metal' (generic — not sufficient for Easy-to-clean).
   */
  materials:         string[]
  /** Parsed from spec/description upstream. null = unknown. */
  waterproof:        boolean | null
  /** Parsed from spec/description upstream. null = unknown. */
  rechargeable:      boolean | null
  /** True if the toy has detachable / removable parts. null = unknown. */
  detachableParts:   boolean | null
  /** True if the product has no motor at all (lube, plug, dildo, etc.). null = unknown. */
  nonElectric:       boolean | null
  /** Overall length in inches from spec sheet. null = unknown. */
  lengthIn:          number | null
  /** Current xdipx.matters_tags values (lowercased) — used for cross-rule checks. */
  currentMatters:    string[]
  /** Current xdipx.audience_tags values (lowercased) — used for Plus-size check. */
  currentAudience:   string[]
}

export interface RuleHit {
  /** Stable rule ID for rationale CSV, e.g. "M-BEG-1". */
  id:      string
  /** The MATTERS_V2 chip string(s) added by this hit. */
  addsTags: string[]
  /** Human-readable rationale — the signal that fired the rule. */
  note:    string
}

export interface RuleResult {
  /**
   * De-duplicated MATTERS_V2 chip values to write to Shopify metafield.
   * Ordered alphabetically for stable diffing.
   */
  finalMatters: string[]
  /** All rule hits that fired, in evaluation order. */
  hits:         RuleHit[]
  /**
   * True when the rule engine cannot confidently classify the product.
   * Threshold: no material signal AND no spec booleans AND no keyword
   * matches across title + bodyExcerpt + nalpacDescription.
   * Products on the ambiguous tail get queued for the Claude subagent pass.
   */
  needsClaude:  boolean
}

// ── Internal constants ───────────────────────────────────────────────────────

/**
 * Product types that are inherently non-electric (no motor housing to trap
 * water) — contributes to the Easy-to-clean nonElectric branch when the
 * upstream spec parser didn't set the boolean explicitly.
 */
const NON_ELECTRIC_TYPES = new Set([
  'dildo', 'realistic dildo', 'silicone dildo', 'fantasy dildo', 'glass dildo',
  'anal plug', 'anal beads', 'anal training kit', 'butt plug',
  'lubricant', 'lube', 'massage oil', 'toy cleaner',
  'nipple clamp', 'restraint', 'blindfold', 'collar',
  'gag', 'paddle', 'flogger', 'crop',
])

/**
 * Product types treated as inherently discreet form factors (Discreet rule
 * M-DIS-1b) even when description copy doesn't say so.
 */
const DISCREET_TYPES = new Set([
  'lipstick-vibe', 'lipstick vibe', 'bullet', 'bullet vibrator',
])

/**
 * Non-porous, body-safe materials that satisfy the Easy-to-clean material
 * gate. Critically:
 *   - 'silicone', 'glass', 'borosilicate', 'stainless-steel', 'ceramic', 'abs'
 *     are all genuinely non-porous.
 *   - 'metal' is NOT in this set because it can catch low-grade chrome-plated
 *     alloys that are not truly non-porous.
 *   - 'tpe', 'rubber', 'latex', 'pvc' are NOT included — they are porous.
 *
 * Porosity, not surface texture, drives cleanability. Textured silicone toys
 * (ribbed, beaded) are still easy to clean because bacteria don't colonise
 * silicone texture the way they colonise jelly-rubber microchannels. Excluding
 * textured products would wrongly drop beaded vibrators and ribbed plugs that
 * ARE easy to clean. The actual failure mode for non-porous toys is
 * non-submersibility: a vibrator with a non-waterproof motor housing can't go
 * under the tap.
 */
const ETC_MATERIALS = new Set([
  'silicone', 'glass', 'borosilicate', 'stainless-steel', 'ceramic', 'abs',
])

// ── Helper ───────────────────────────────────────────────────────────────────

function addTag(
  out: Set<string>,
  hits: RuleHit[],
  id: string,
  tag: string,
  note: string,
): void {
  out.add(tag)
  hits.push({ id, addsTags: [tag], note })
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Apply all v2 deterministic "What Matters" rules.
 * Pure: same input always returns same output.
 * Rules are order-independent (each reads only `input`, not previous hits).
 */
export function applyMattersRules(input: RuleInput): RuleResult {
  const matters = new Set<string>()
  const hits: RuleHit[] = []

  const pt        = (input.productType ?? '').trim().toLowerCase()
  const titleLc   = input.title.toLowerCase()
  const bodyLc    = input.bodyExcerpt.toLowerCase()
  const nalpacLc  = input.nalpacDescription.toLowerCase()
  // Combined search corpus — title + current description + Nalpac spec
  const corpus    = `${titleLc} ${bodyLc} ${nalpacLc}`
  const tagsLc    = new Set(input.tags.map(t => t.toLowerCase()))
  const matsLc    = new Set(input.materials.map(m => m.toLowerCase()))
  const audLc     = new Set(input.currentAudience.map(a => a.toLowerCase()))

  // ── M-BEG-1  Beginner-friendly ────────────────────────────────────────────
  const beginnerTypeMatch = ['first-time vibrator', 'beginner-kit', 'starter'].includes(pt)
  const beginnerTagMatch  = [...tagsLc].some(t => /starter|intro|beginner/i.test(t))
  const beginnerCorpus    = /beginner|first[- ]time|intro/i.test(corpus)
  if (beginnerTypeMatch || beginnerTagMatch || beginnerCorpus) {
    addTag(matters, hits, 'M-BEG-1', 'Beginner-friendly',
      beginnerTypeMatch ? `productType=${pt}` :
      beginnerTagMatch  ? 'tag matches /starter|intro|beginner/' :
                          'corpus matches /beginner|first-time|intro/')
  }

  // ── M-WQ-1   Whisper-quiet ────────────────────────────────────────────────
  if (/whisper[- ]quiet|silent|<\s*30\s*db/i.test(corpus)) {
    addTag(matters, hits, 'M-WQ-1', 'Whisper-quiet',
      'corpus matches /whisper-quiet|silent|<30db/')
  }

  // ── M-WP-1   Waterproof ───────────────────────────────────────────────────
  const waterproofBoolean = input.waterproof === true
  const waterproofCorpus  = /waterproof|ipx7|submersible|bath[- ]safe/i.test(corpus)
  if (waterproofBoolean || waterproofCorpus) {
    addTag(matters, hits, 'M-WP-1', 'Waterproof',
      waterproofBoolean ? 'spec boolean waterproof=true' :
                          'corpus matches /waterproof|ipx7|submersible|bath-safe/')
  }

  // ── M-TR-1   Travel-ready ─────────────────────────────────────────────────
  // Both conditions must fire: travel language AND compact length (< 6 in when known).
  // When lengthIn is null (unknown), the length condition is satisfied by default
  // so we don't falsely exclude products whose spec sheet omits dimensions.
  const travelCorpus  = /travel|locking|tsa|carry/i.test(corpus)
  const travelLength  = input.lengthIn === null || input.lengthIn < 6
  if (travelCorpus && travelLength) {
    addTag(matters, hits, 'M-TR-1', 'Travel-ready',
      `corpus matches /travel|locking|tsa|carry/` +
      (input.lengthIn !== null ? ` AND lengthIn=${input.lengthIn}in < 6` : ' (length unknown, not excluding)'))
  }

  // ── M-DIS-1  Discreet ─────────────────────────────────────────────────────
  const discreteCorpus = /discreet|plain packaging|unmarked|matte/i.test(corpus)
  const discreteType   = DISCREET_TYPES.has(pt)
  if (discreteCorpus || discreteType) {
    addTag(matters, hits, 'M-DIS-1', 'Discreet',
      discreteType   ? `productType=${pt} on discreet form-factor list` :
                       'corpus matches /discreet|plain packaging|unmarked|matte/')
  }

  // ── M-HF-1   Hands-free ───────────────────────────────────────────────────
  const handsFreeCorpus = /hands[- ]free|suction[- ]cup|wearable/i.test(corpus)
  const handsFreeTag    = [...tagsLc].some(t => /harness|strap/i.test(t))
  if (handsFreeCorpus || handsFreeTag) {
    addTag(matters, hits, 'M-HF-1', 'Hands-free',
      handsFreeCorpus ? 'corpus matches /hands-free|suction-cup|wearable/' :
                        'tag matches /harness|strap/')
  }

  // ── M-RC-1   Remote-controlled ────────────────────────────────────────────
  const remoteCorpus = /remote|app[- ]controlled|wireless/i.test(corpus)
  const remoteTag    = [...tagsLc].some(t => t === 'app-controlled')
  if (remoteCorpus || remoteTag) {
    addTag(matters, hits, 'M-RC-1', 'Remote-controlled',
      remoteCorpus ? 'corpus matches /remote|app-controlled|wireless/' :
                     'tag=app-controlled')
  }

  // ── M-PS-1   Plus-size friendly ───────────────────────────────────────────
  const plusSizeAudience = [...audLc].some(a => a.includes('plus-size'))
  const plusSizeCorpus   = /inclusive|extended size|xl\+/i.test(corpus)
  if (plusSizeAudience || plusSizeCorpus) {
    addTag(matters, hits, 'M-PS-1', 'Plus-size friendly',
      plusSizeAudience ? 'audience tag includes plus-size' :
                         'corpus matches /inclusive|extended size|XL+/')
  }

  // ── M-EZ-1   Easy to clean ────────────────────────────────────────────────
  //
  // Rule: material ∈ ETC_MATERIALS (non-porous gate)
  //       AND (waterproof OR detachableParts OR nonElectric)
  //
  // The non-porous gate uses strict material literals — see ETC_MATERIALS comment
  // above for why 'metal' and porous materials are excluded.
  //
  // The submersibility branch:
  //   - waterproof=true  → can go under the tap, easiest clean.
  //   - detachableParts  → motor housing separates from body-contact surface.
  //   - nonElectric      → no motor housing at all, fully submersible by definition.
  //     When nonElectric is null, we check NON_ELECTRIC_TYPES as a fallback.
  const hasNonPorousMat = [...matsLc].some(m => ETC_MATERIALS.has(m))
  const isNonElectric   = input.nonElectric === true || (input.nonElectric === null && NON_ELECTRIC_TYPES.has(pt))
  const isWaterproof    = input.waterproof === true || /waterproof|ipx7|submersible|bath[- ]safe/i.test(corpus)
  const hasDetachable   = input.detachableParts === true

  if (hasNonPorousMat && (isWaterproof || hasDetachable || isNonElectric)) {
    const cleanBranch = isWaterproof ? 'waterproof' : hasDetachable ? 'detachable-parts' : 'non-electric'
    addTag(matters, hits, 'M-EZ-1', 'Easy to clean',
      `non-porous material (${[...matsLc].filter(m => ETC_MATERIALS.has(m)).join(',')}) + ${cleanBranch}`)
  }

  // ── M-RCH-1  Rechargeable ─────────────────────────────────────────────────
  // A title that says "Corded" or "Plug-In" is the most reliable power-source
  // signal available and overrides both the corpus regex and the spec boolean:
  // the corpus regex otherwise false-matches a corded/plug-in wand whose copy
  // mentions a USB-charged remote or similar, and a corded product is never
  // rechargeable regardless of what an upstream boolean claims.
  const cordedOrPlugIn      = /\bcorded\b|\bplug[- ]in\b/i.test(titleLc)
  const rechargeableBoolean = !cordedOrPlugIn && input.rechargeable === true
  const rechargeableCorpus  = !cordedOrPlugIn && /rechargeable|usb|magnetic charging/i.test(corpus)
  if (rechargeableBoolean || rechargeableCorpus) {
    addTag(matters, hits, 'M-RCH-1', 'Rechargeable',
      rechargeableBoolean ? 'spec boolean rechargeable=true' :
                            'corpus matches /rechargeable|usb|magnetic charging/')
  }

  // ── M-ST-1   Soft-touch ───────────────────────────────────────────────────
  // Requires silicone or TPE material AND soft/velvety/skin-like language.
  const softMat    = matsLc.has('silicone') || matsLc.has('tpe')
  const softCorpus = /soft|velvety|skin[- ]like/i.test(corpus)
  if (softMat && softCorpus) {
    addTag(matters, hits, 'M-ST-1', 'Soft-touch',
      `material=(${softMat ? [...matsLc].filter(m => m === 'silicone' || m === 'tpe').join(',') : ''}) + corpus matches /soft|velvety|skin-like/`)
  }

  // ── M-LAT-1  Latex-free ───────────────────────────────────────────────────
  //
  // Non-porous materials are all inherently latex-free: silicone, TPE, glass,
  // borosilicate, stainless-steel, ceramic, ABS. Rubber/latex blends are NOT
  // latex-free. When material list is unknown, we don't assume.
  //
  // Explicitly latex-free if corpus says so, regardless of material parsing.
  const latexFreeMats = new Set(['silicone','tpe','glass','borosilicate','stainless-steel','ceramic','abs'])
  const hasLatexFreeMat = [...matsLc].some(m => latexFreeMats.has(m))
  const hasLatexMat     = matsLc.has('rubber') || matsLc.has('latex')
  const latexFreeCorpus = /latex[- ]free|non[- ]latex/i.test(corpus)

  if (latexFreeCorpus || (hasLatexFreeMat && !hasLatexMat)) {
    addTag(matters, hits, 'M-LAT-1', 'Latex-free',
      latexFreeCorpus ? 'corpus explicitly says latex-free' :
                        `material=(${[...matsLc].filter(m => latexFreeMats.has(m)).join(',')}) with no rubber/latex`)
  }

  // ── needsClaude threshold ─────────────────────────────────────────────────
  //
  // If the rules left finalMatters empty, the product is unclassified — it
  // MUST go to Claude. The earlier "thin corpus" heuristic was wrong: a
  // product can have a 500-char description and still hit zero rules (lubes,
  // toy cleaners, edge-case materials, ambiguous descriptions) — those
  // products were silently shipping with no tags. Empty rule output is the
  // signal Claude needs to pick them up.
  //
  // Coverage expectation per Co-Work: ~70-85% of catalog handled by rules.
  // That comes from products with rich spec signal naturally clearing rules
  // with multiple tags. The skeletal/edge-case tail (~15-30%) routes to
  // Claude regardless of corpus length.
  const needsClaude = matters.size === 0

  return {
    finalMatters: [...matters].sort(),
    hits,
    needsClaude,
  }
}
