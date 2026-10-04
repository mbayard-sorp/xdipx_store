/**
 * The copy and policy side of the render gate chain (Ad Studio v2 PR-C), plus
 * the mapping from the image gates' verdicts onto the five chip results.
 *
 * Honest scope of the voice gate: this is a deterministic lint against the
 * charter's mechanical rules (no em dashes, no "sexy", no countdowns, no
 * invented proof, no lived experience, the statement reads XDIPX) and the
 * social caption lexicon. The independent LLM voice review (emma-empathy-
 * reviewer) is the routine's job when it files the idea; ideas arrive here
 * already reviewed, and this lint is the fail-closed backstop at render time.
 */
import { CAPTION_LEXICON, classifyLegibleText, type LegibleTextClass } from '~/lib/social-publish-gate.server'
import { EXPOSURE_CHECK_NAMES, type VisionVerdict } from '~/lib/social-vision-gate.server'
import { hasFidelityDrift, type ProductFidelityVerdict } from '~/lib/social-product-fidelity.server'
import { OBJECT_ONLY_LANES, type GateResult, type PlatePlan } from '~/lib/ad-render-rules'

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

interface Rule { label: string; re: RegExp; level: 'block' | 'revise' }

const VOICE_RULES: readonly Rule[] = [
  { label: 'em or en dash', re: /[\u2014\u2013]/, level: 'block' },
  { label: '"sexy"', re: /\bsexy\b/i, level: 'block' },
  { label: '"buy now"', re: /\bbuy now\b/i, level: 'block' },
  { label: 'urgency or countdown', re: /\b(hurry|last chance|ends? (tonight|today|soon)|while supplies last|limited time|only \d+ left|act now|final (hours?|minutes?)|\d+\s?(hours?|minutes?) left)\b/i, level: 'block' },
  { label: 'lived experience (Emma is an AI guide)', re: /\b(i|we)(’|')?(ve| have)? (tried|tested|own|owned|used)\b/i, level: 'block' },
  { label: 'invented proof number', re: /\b\d[\d,.]*\s?(\+|k)?\s*(five[- ]star|5[- ]star)?\s*(reviews?|ratings?|customers|orders|happy)\b/i, level: 'block' },
  { label: 'unverified superlative', re: /\b(best[- ]selling|#1|number one|voted|award[- ]winning)\b/i, level: 'revise' },
  { label: 'billing descriptor other than XDIPX', re: /\bdipcom\b/i, level: 'block' },
]

/** Words that are never pleasure-outcome or act claims on a register 3-4 surface (Meta M3). */
const PLEASURE_CLAIMS = /\b(orgasms?|o's|get off|climax(es)?|come hard|cumming|best sex|sex toys?)\b/i

/** Category words that never appear in a Meta slogan (M5: renamed display titles carry none). */
const META_CATEGORY_WORDS = /\b(sex toys?|vibrators?|dildos?|clitoral|clit|g-?spot|orgasms?|masturbat\w*|arousal|erotic|sexual|pleasure|bullet|rabbit|wand)\b/i

export interface VoiceInput {
  lane: string
  strings: readonly string[]
}

/** Deterministic voice lint over the slogan and headlines. */
export function voiceGate(input: VoiceInput): GateResult {
  const blocks: string[] = []
  const revises: string[] = []
  const strictLexicon = input.lane !== 'adult' && input.lane !== 'owned'
  for (const s of input.strings) {
    if (!s) continue
    for (const r of VOICE_RULES) {
      if (r.re.test(s)) (r.level === 'block' ? blocks : revises).push(`${r.label} in "${clip(s)}"`)
    }
    // Crude slang is never allowed. The rest of the lexicon applies off the owned and adult surfaces.
    for (const t of CAPTION_LEXICON) {
      if (!t.blocks) continue
      if (!strictLexicon && t.tier !== 'crude-slang') continue
      if (t.re.test(s)) blocks.push(`${t.label} (${t.tier}) in "${clip(s)}"`)
    }
  }
  if (blocks.length) return { state: 'block', reason: blocks.slice(0, 3).join('; ') }
  if (revises.length) return { state: 'revise', reason: revises.slice(0, 3).join('; ') }
  return { state: 'pass', reason: 'Charter lint clean: no dashes, urgency, invented proof or crude terms.' }
}

function clip(s: string): string {
  return s.length > 48 ? `${s.slice(0, 45)}...` : s
}

// ---------------------------------------------------------------------------
// Policy (per lane, docs/ads-policy.md)
// ---------------------------------------------------------------------------

export interface PolicyInput {
  lane: string
  registerTier: string
  slogan: string | null
  headlines: readonly string[]
  body: readonly string[]
  destinationUrl: string | null
  plan: Pick<PlatePlan, 'archetype' | 'onSkin' | 'sceneAxes'> | null
  /** The plate's vision verdict, when a plate exists. */
  vision: VisionVerdict | null
  format: string
}

const RSA_HEADLINE_MAX = 30
const RSA_DESCRIPTION_MAX = 90

export function destinationOkForMeta(url: string | null): boolean {
  if (!url) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.hostname === 'curious.xdipx.com') return true
  return (u.hostname === 'xdipx.com' || u.hostname === 'www.xdipx.com') && /^\/products\/[^/]+/.test(u.pathname)
}

/** Lane rules as a yes/no check that names the gate it failed (ads-policy.md Meta M1 to M7 and the matrix). */
export function policyGate(input: PolicyInput): GateResult {
  const { lane } = input
  const copy = [input.slogan ?? '', ...input.headlines].filter(Boolean)

  if (OBJECT_ONLY_LANES.includes(lane) && input.plan && (input.plan.onSkin || input.plan.archetype !== 'B')) {
    return { state: 'block', reason: `${lane} lane is object-first: an on-skin frame is never allowed (M2).` }
  }

  if (lane === 'meta') {
    if (input.registerTier !== '3-4') return { state: 'block', reason: `Meta copy runs at register 3-4, this idea is ${input.registerTier} (M3).` }
    const claim = copy.find(s => PLEASURE_CLAIMS.test(s))
    if (claim) return { state: 'block', reason: `Pleasure or category claim in "${clip(claim)}" (M3).` }
    if (input.slogan && META_CATEGORY_WORDS.test(input.slogan)) {
      return { state: 'block', reason: `Category word in the slogan "${clip(input.slogan)}" (M5).` }
    }
    if (!destinationOkForMeta(input.destinationUrl)) {
      return { state: 'revise', reason: 'Destination is not the bridge host or a PDP (M1). Fix before any export.' }
    }
    return { state: 'pass', reason: 'Meta M1 to M3 and M5: object-first, register 3-4, no category word, PDP or bridge destination.' }
  }

  if (lane === 'google' || lane === 'microsoft') {
    const long = input.headlines.filter(h => h.length > RSA_HEADLINE_MAX)
    const longBody = input.body.filter(b => b.length > RSA_DESCRIPTION_MAX)
    if (long.length || longBody.length) {
      return {
        state: 'revise',
        reason: `${long.length} headline(s) over ${RSA_HEADLINE_MAX} chars, ${longBody.length} description(s) over ${RSA_DESCRIPTION_MAX}. Search text only.`,
      }
    }
    return { state: 'pass', reason: 'Search text only: headlines within 30 characters, no image.' }
  }

  if (lane === 'snap') {
    const graphic = copy.find(s => CAPTION_LEXICON.some(t => t.blocks && t.re.test(s)))
    if (graphic) return { state: 'block', reason: `Graphic language in "${clip(graphic)}". Snapchat needs non-graphic copy.` }
    if (input.vision && !input.vision.pass) return { state: 'block', reason: 'Vision gate failed: Snapchat needs non-graphic imagery with no nudity.' }
    return { state: 'pass', reason: 'Snapchat: non-graphic object or typographic creative, 18+.' }
  }

  if (lane === 'adult') {
    if (input.vision && input.vision.checks) {
      const failed = EXPOSURE_CHECK_NAMES.filter(n => input.vision!.checks![n] === 'fail')
      if (failed.length) return { state: 'block', reason: `Nudity stop list: ${failed.join(', ')}. No visible female nipples, labia, penis or anus.` }
    } else if (input.vision && !input.vision.pass) {
      return { state: 'block', reason: 'Vision gate did not clear the nudity stop list.' }
    }
    if (!input.destinationUrl || !/utm_content=/.test(input.destinationUrl)) {
      return { state: 'block', reason: 'Adult networks need utm_content on every URL. A banner without it is not exported.' }
    }
    return { state: 'pass', reason: 'Adult network: the nudity definition is the only imagery ceiling, and it holds. UTMs present.' }
  }

  if (lane === 'newsletter') {
    return { state: 'pass', reason: 'Sponsored read: object-first imagery, disclosure required at send.' }
  }

  return { state: 'pass', reason: 'Owned channel: charter register 9 and the 3.2a ceiling.' }
}

// ---------------------------------------------------------------------------
// Image gate mapping
// ---------------------------------------------------------------------------

export function visionGateResult(v: VisionVerdict | null): GateResult {
  if (!v) return { state: 'not_run', reason: 'No generated image on this creative.' }
  if (!v.checkCompleted) return { state: 'block', reason: `Vision gate did not complete: ${v.notes.slice(0, 120)}` }
  if (!v.pass) return { state: 'block', reason: v.notes.slice(0, 160) || 'Vision gate failed.' }
  return { state: 'pass', reason: v.notes.slice(0, 160) || 'Anatomy and imagery ceiling clear.' }
}

export function fidelityGateResult(v: ProductFidelityVerdict | null): GateResult {
  if (!v) return { state: 'not_run', reason: 'No product in frame on this creative.' }
  if (!v.checkCompleted) return { state: 'block', reason: `Product-fidelity check did not complete: ${v.notes.slice(0, 120)}` }
  if (!hasFidelityDrift(v)) return { state: 'pass', reason: v.notes.slice(0, 160) || 'Silhouette, colour and finish match the real photo.' }
  const drifted = (['silhouette', 'colour', 'finish', 'brandMark'] as const).filter(k => v[k] === 'drift')
  const hard = v.silhouette === 'drift' || drifted.length >= 2
  return { state: hard ? 'block' : 'revise', reason: `Drift on ${drifted.join(', ')}. ${v.notes.slice(0, 120)}` }
}

export interface TextGateInput {
  /** What the vision gate transcribed from the PLATE (which must carry no text). */
  plateLegibleText: string | null | undefined
  hasPlate: boolean
  /** Slogan fit from the compositor. */
  fit: { fontSize: number; truncated: boolean; minFont: number } | null
}

/**
 * Text gate: the generated plate never carries text (a brand mark on the
 * product we stock is the one allowance, same as the publish gate), and the
 * composited slogan fits at a legible size.
 */
export function textGateResult(input: TextGateInput): GateResult {
  if (input.hasPlate) {
    const cls: LegibleTextClass = classifyLegibleText(input.plateLegibleText)
    if (cls === 'packaging' || cls === 'caption-or-watermark' || cls === 'unclassified') {
      return { state: 'block', reason: `Baked-in text on the plate (${cls}): "${clip(String(input.plateLegibleText ?? ''))}". Text lives in the layout layer.` }
    }
  }
  if (input.fit) {
    if (input.fit.truncated) return { state: 'block', reason: 'The slogan does not fit this size at a legible type size.' }
    if (input.fit.fontSize < input.fit.minFont + 1) return { state: 'revise', reason: `Slogan set at the minimum ${input.fit.fontSize}px. Check it at 1:1.` }
    return { state: 'pass', reason: `Plate carries no text, slogan set at ${input.fit.fontSize}px.` }
  }
  return { state: 'pass', reason: 'No composited slogan to fit.' }
}
