// Vision-gate hard check on generated social imagery (ticket #6763).
// Every seam is injected: no network, no Anthropic client, no database.
import { describe, it, expect, vi } from 'vitest'
import {
  runVisionGate,
  runVisionGateOnImage,
  recordVisionVerdict,
  regateAsset,
  getVisionVerdictByUrl,
  generateWithVisionGate,
  isValidVerdictShape,
  enforceEnumeratedAnatomy,
  backAnatomyReadsAsDefect,
  badHandDigitCounts,
  VISION_CHECK_NAMES,
  VISION_SYSTEM_PROMPT,
  VISION_VERDICT_TOOL_NAME,
  VisionParseError,
  type VisionVerdict,
  type VisionGateDeps,
} from './social-vision-gate.server'
import { logMessageUsage } from './token-log.server'

// Ticket #13176: `defaultDeps.callVision` (the real Anthropic-calling
// implementation, unreachable from every other test in this file because
// they all inject a fake `callVision`) is exercised directly here with the
// SDK mocked, to prove the forced-tool-call wiring itself, not just the
// injected-seam retry logic above it.
const h = vi.hoisted(() => ({ mockCreate: vi.fn(), captureException: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: h.mockCreate }
  },
}))
vi.mock('./token-log.server', () => ({ logMessageUsage: vi.fn() }))
// Avoids pulling in the real @sentry/node (and its @opentelemetry/api
// dependency) for every test in this file, same idiom as
// category-healthcheck.server.test.ts.
vi.mock('./sentry.server', () => ({ Sentry: { captureException: h.captureException } }))

const CLEAN_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'clean, nothing anomalous',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

const ANATOMY_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'fail',
    handAnatomy: 'fail',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'fail',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'the cast member has three arms',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

const NIPPLE_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'fail',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'nipple visible through wet fabric, top edge of frame',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

const GENITALIA_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'fail',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'genitalia visible, crop ran wider than requested',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// Ticket #10477, the two calibration directions of `anusNotVisible`.
//
// The licensed frame (docs/store-team/instagram-campaigns.md section 3.2c, at
// ceiling tier) is bare buttocks with the gluteal cleft visible and a plug
// resting along the cleft under its own weight. It must PASS. Over-firing on
// any bare rear deletes the campaign's ceiling frame, which is exactly why
// this is its own check and not a widening of `genitaliaAbsent`, whose
// "no product in contact with genitalia" clause the licensed frame would
// otherwise trip.
const LICENSED_PLUG_FRAME_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'bare buttocks, gluteal cleft reads as a line, plug lying along the cleft under its own weight, no anus visible or outlined',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// The failing direction: the pose parts the buttocks and the anus reads.
const PARTED_ANUS_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'fail',
    adultUnambiguous: 'pass',
  },
  notes: 'buttocks spread by the pose, anus visible and outlined at the base of the cleft',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

const AGE_AMBIGUOUS_FAIL_RESPONSE = {
  pass: false,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'fail',
  },
  notes: 'faceless torso crop, no reliable adult age markers visible',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

const BRANDED_TEXT_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'clean, product wordmark visible on the paddle handle',
  legibleText: 'TANTUS',
  skinMarks: '',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// Ticket #11477, the incident that prompted the check: a bead strand laid
// along a lower back generated unbriefed marks the vision gate's original
// eight checks had no way to notice, because none of them concerns skin
// condition at all.
const SKIN_MARKS_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'clean, otherwise compliant bead-strand frame',
  legibleText: '',
  skinMarks: 'faint pink-red streaks and blotches across the lower back and flank',
  productPhysics: 'not_applicable',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// Ticket #11460, the three DONE WHEN cases for productPhysics. All three are
// otherwise-clean frames (every safety check passes) so the only thing under
// test is the new report field and, in the third case, that scale never
// contaminates it.

// Case 1: unsupported. A product adhered to a vertical surface (a shin) with
// no hand anywhere in the frame — nothing explains why it is not falling,
// exactly the row-308 incident this ticket cites.
const UNSUPPORTED_PRODUCT_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'product adhered to the side of a shin, vertical surface, no hand in frame',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'unsupported',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// Case 2: supported by grip. Fingers visibly wrapped around the product.
const GRIPPED_PRODUCT_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'hand gripping the product, fingers wrapped fully around the shaft',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'supported',
  handDigitCounts: [],
  backAnatomyRead: '',
}

// Case 3: supported, exaggerated scale. Proves no proportion/scale reject
// crept in: the product renders much larger than its real-world size, but the
// grip is proper, so this must still read "supported".
const EXAGGERATED_SCALE_GRIPPED_RESPONSE = {
  pass: true,
  checks: {
    limbCount: 'pass',
    handAnatomy: 'pass',
    faceBodyIntegrity: 'pass',
    extraOrMergedLimbs: 'pass',
    nippleOccluded: 'pass',
    genitaliaAbsent: 'pass',
    anusNotVisible: 'pass',
    adultUnambiguous: 'pass',
  },
  notes: 'product rendered at an exaggerated, larger-than-real-life scale, but hand fully wraps around it with a proper grip',
  legibleText: '',
  skinMarks: '',
  productPhysics: 'supported',
  handDigitCounts: [],
  backAnatomyRead: '',
}

function deps(over: Partial<VisionGateDeps> = {}): VisionGateDeps {
  return {
    fetchImageBase64: vi.fn(async () => ({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })),
    callVision: vi.fn(async () => CLEAN_RESPONSE),
    updateVerdict: vi.fn(async () => {}),
    lookupVerdictByUrl: vi.fn(async () => null),
    ...over,
  }
}

describe('isValidVerdictShape', () => {
  it('accepts a well-formed verdict', () => {
    expect(isValidVerdictShape(CLEAN_RESPONSE)).toBe(true)
  })

  it('rejects a missing check', () => {
    const { limbCount: _limbCount, ...rest } = CLEAN_RESPONSE.checks
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, checks: rest })).toBe(false)
  })

  it('rejects a non-boolean pass', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, pass: 'yes' })).toBe(false)
  })

  it('rejects an invalid check value', () => {
    expect(isValidVerdictShape({
      ...CLEAN_RESPONSE,
      checks: { ...CLEAN_RESPONSE.checks, handAnatomy: 'maybe' },
    })).toBe(false)
  })

  it('rejects null and non-objects', () => {
    expect(isValidVerdictShape(null)).toBe(false)
    expect(isValidVerdictShape('pass')).toBe(false)
  })

  // Ticket #10279: legibleText is a report field, not a check, but the shape
  // validator still requires it as a string so a malformed response fails
  // closed the same way a missing check would.
  it('rejects a missing legibleText', () => {
    const { legibleText: _legibleText, ...rest } = CLEAN_RESPONSE
    expect(isValidVerdictShape(rest)).toBe(false)
  })

  it('rejects a non-string legibleText', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, legibleText: null })).toBe(false)
  })

  it('accepts an empty-string legibleText (checked, nothing found)', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, legibleText: '' })).toBe(true)
  })

  // Ticket #11477: skinMarks is a report field, same contract as legibleText.
  it('rejects a missing skinMarks', () => {
    const { skinMarks: _skinMarks, ...rest } = CLEAN_RESPONSE
    expect(isValidVerdictShape(rest)).toBe(false)
  })

  it('rejects a non-string skinMarks', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, skinMarks: null })).toBe(false)
  })

  it('accepts an empty-string skinMarks (checked, nothing found)', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, skinMarks: '' })).toBe(true)
  })

  // Ticket #11460: productPhysics is a second report field, same convention
  // as legibleText — required as one of the three enum values, never a
  // gate on `pass`.
  it('rejects a missing productPhysics', () => {
    const { productPhysics: _productPhysics, ...rest } = CLEAN_RESPONSE
    expect(isValidVerdictShape(rest)).toBe(false)
  })

  it('rejects an invalid productPhysics value', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, productPhysics: 'floating' })).toBe(false)
  })

  it('accepts each of the three productPhysics values', () => {
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, productPhysics: 'supported' })).toBe(true)
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, productPhysics: 'unsupported' })).toBe(true)
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, productPhysics: 'not_applicable' })).toBe(true)
  })

  it('lists the four doctrine hard checks plus the four imagery-ceiling checks', () => {
    expect(VISION_CHECK_NAMES).toEqual([
      'limbCount',
      'handAnatomy',
      'faceBodyIntegrity',
      'extraOrMergedLimbs',
      'nippleOccluded',
      'genitaliaAbsent',
      'anusNotVisible',
      'adultUnambiguous',
    ])
  })

  // Ticket #10477. getVisionVerdictByUrl returns the stored blob with no shape
  // validation, but a LIVE response that omits the new key is malformed and
  // must fail closed rather than read as a silent pass on the check nobody
  // answered.
  it('rejects a response missing anusNotVisible', () => {
    const { anusNotVisible: _anusNotVisible, ...rest } = CLEAN_RESPONSE.checks
    expect(isValidVerdictShape({ ...CLEAN_RESPONSE, checks: rest })).toBe(false)
  })
})

// Ticket #10477. The two verdict-flow tests below prove the plumbing carries
// a pass and a fail. What decides the real calibration is the prompt text,
// and its dangerous edit is the quiet one: a later hand tightening "anus" to
// "the anal region" or "the cleft" would fail the licensed ceiling frame
// without failing a single injected-response test. So the wording is asserted
// directly, in both directions.
describe('anusNotVisible prompt calibration', () => {
  it('names the check and counts eight, not seven', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('anusNotVisible')
    expect(VISION_SYSTEM_PROMPT).toContain('Check these eight things')
    expect(VISION_SYSTEM_PROMPT).toContain('all eight checks')
    expect(VISION_SYSTEM_PROMPT).not.toContain('Check these seven things')
  })

  it('licenses the bare rear and the cleft in so many words', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('a bare rear is not a failure')
    expect(VISION_SYSTEM_PROMPT).toContain('the crease between the buttocks is not a failure')
    expect(VISION_SYSTEM_PROMPT).toContain('a product laid along, across or beside the cleft')
    expect(VISION_SYSTEM_PROMPT).toContain('Judge the anus, not the cleft')
  })

  it('still fails the parted, outlined, inserted and sheer cases', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('discernibly outlined')
    expect(VISION_SYSTEM_PROMPT).toContain('parted or spread')
    expect(VISION_SYSTEM_PROMPT).toContain("insertable portion is shown entering or seated in the body")
    expect(VISION_SYSTEM_PROMPT).toContain('through sheer or wet fabric')
  })

  it('leaves genitaliaAbsent alone, so the licensed plug frame is not caught by its contact clause', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('no product is depicted in contact with genitalia')
    // The organ, not the region: the licensed frame shows the region.
    expect(VISION_SYSTEM_PROMPT).not.toContain('analRegionOccluded')
  })
})

// Ticket #13501. social_media_assets 925/928/933/934 all shipped with extra
// hands/arms (owner-rated ai-artifact, "Extra hands and arms"), and the
// pre-publish gate missed the same defect on asset 934's plain look. The
// post-376 re-gate caught the identical composition class only once a
// reviewer was explicitly told to trace each arm shoulder-to-hand, so the
// fix is making that trace the standing instruction on every call, not an
// opt-in a caller has to remember to request. Asserted directly against the
// prompt text, same idiom as the calibration blocks above: this check is
// model-interpreted prose, not deterministic code, so the wording is what
// decides the real behaviour.
describe('limb-tracing anatomy calibration (ticket #13501)', () => {
  it('requires tracing every visible arm from shoulder to terminus, by default, on both limbCount and extraOrMergedLimbs', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('trace it one at a time from its shoulder')
    expect(VISION_SYSTEM_PROMPT).toContain('by default on every image, not only when asked to look harder')
    expect(VISION_SYSTEM_PROMPT).toContain('a hand that overlaps or reads as fused into a forearm it does not belong to')
    expect(VISION_SYSTEM_PROMPT).toContain('ticket #13501')
    expect(VISION_SYSTEM_PROMPT).toContain('not a second independent glance')
  })

  it('does not gate the shoulder-to-hand trace behind any opt-in phrasing', () => {
    expect(VISION_SYSTEM_PROMPT).not.toContain('only trace')
    expect(VISION_SYSTEM_PROMPT).not.toContain('if asked')
    expect(VISION_SYSTEM_PROMPT).not.toContain('when requested')
  })
})

// Ticket #13165, owner all-hands 2026-10-02 ("Only men are allowed to show
// their nipples"). The check is model-interpreted prose, not deterministic
// code, so — same idiom as the anusNotVisible block above — its calibration
// is asserted directly against the prompt text. Reproduces the real failure
// the ticket named: shirtless male cast renders (social_media_assets 707-710,
// 741) failed nippleOccluded 5 of 6 times under the old sex-blind wording.
describe('nippleOccluded prompt calibration (ticket #13165)', () => {
  it('still names and fails a visible female nipple, sheer/wet fabric included (unchanged)', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('a visible or outlined FEMALE nipple or areola fails')
    expect(VISION_SYSTEM_PROMPT).toContain('including when seen through sheer or wet fabric')
  })

  it('explicitly permits and passes a visible male nipple on its own', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('A visible or outlined MALE nipple or areola is explicitly PERMITTED and passes on its own')
    expect(VISION_SYSTEM_PROMPT).toContain('not as exposure')
  })

  it('still fails a product touching or aimed at any nipple regardless of sex', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('ANY product depicted touching, pressed against, or aimed/pointed directly at a nipple, male or female, still FAILS')
  })

  it('fails closed on ambiguous sex rather than resolving to the permissive reading', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('judge it as FEMALE and fail on a visible nipple')
    expect(VISION_SYSTEM_PROMPT).toContain('ambiguity must fail closed')
  })

  it('keeps the key name unchanged so a stored verdict from before this ticket stays readable', () => {
    expect(VISION_CHECK_NAMES).toContain('nippleOccluded')
    expect(VISION_CHECK_NAMES).not.toContain('femaleNippleOccluded')
  })
})

// Ticket #11487, regression case asset 675 (ROMP 2.0 render): the model
// returned legibleText: "" on a frame that actually had garbled, illegible
// pseudo-text molded beneath the product's button, because the old wording
// only asked for text it could cleanly READ. The fix is calibration text, so
// it is asserted directly, the same pattern as the anusNotVisible block above.
describe('legibleText prompt calibration (garbled/illegible marks, ticket #11487)', () => {
  it('tells the model not to return "" just because a mark is not cleanly readable', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('Do not return "" just because you cannot read it cleanly')
    expect(VISION_SYSTEM_PROMPT).toContain('Only return "" when there is truly no text or text-like mark anywhere in the frame')
  })

  it('names the garbled/dot-and-dash pseudo-text failure mode explicitly', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('garbled or partially-formed characters')
    expect(VISION_SYSTEM_PROMPT).toContain('illegible pseudo-text pattern')
    expect(VISION_SYSTEM_PROMPT).toContain('dot-and-dash')
  })

  it('still asks for a transcription first, garbled marks are the fallback instruction', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('Transcribe everything legible into one string')
  })
})

// Ticket #11460. productPhysics is report-only (constraint 2: ship report-
// only first, promote to blocking only after a backtest). Its two failure
// directions are the same shape as anusNotVisible's: missing real support,
// and over-firing on a licensed, deliberately-exaggerated render scale. The
// wording is asserted directly for the same reason — a later edit that
// quietly folds scale into the judgment would not fail a single injected-
// response test, only the prompt text catches it.
describe('productPhysics prompt calibration (ticket #11460)', () => {
  it('names the check as report-only, not a pass/fail check', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('REPORT ONLY, not a check, does not affect "pass": productPhysics')
  })

  it('defines support as a grip or an upward-facing resting surface', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('fingers visibly wrapped around it')
    expect(VISION_SYSTEM_PROMPT).toContain('a palm cupped underneath it bearing its weight from below')
    expect(VISION_SYSTEM_PROMPT).toContain('rests on a surface that faces upward')
  })

  it('names an open flat palm beside a product, and a hand resting on top, as NOT support', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('An open flat palm beside a product is not support')
    expect(VISION_SYSTEM_PROMPT).toContain('a hand resting on top of a product is not support')
  })

  it('explicitly separates scale exaggeration from the support judgment', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('This is NOT a size or proportion check')
    expect(VISION_SYSTEM_PROMPT).toContain('a product rendered at an exaggerated, larger-than-real-life scale is completely normal for this brand')
    expect(VISION_SYSTEM_PROMPT).toContain('scale exaggeration and physical support are unrelated questions')
    expect(VISION_SYSTEM_PROMPT).toContain('Only fake or missing support is the fail condition here, never scale')
  })

  it('always requires the field present, with the not_applicable escape when there is no product-on-body contact', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('answer "not_applicable"')
    expect(VISION_SYSTEM_PROMPT).toContain('"productPhysics" is always present in your response, and is always one of "supported", "unsupported", or "not_applicable"')
  })

  it('does not add a ninth pass/fail check: the eight-check count is unchanged', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('Check these eight things')
    expect(VISION_SYSTEM_PROMPT).toContain('"pass" is true only when all eight checks in "checks" are "pass"')
  })
})

describe('runVisionGate', () => {
  it('passes a clean asset', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.checks!.handAnatomy).toBe('pass')
    expect(verdict.checkedAt).toBeTruthy()
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects an anatomy-fail asset', async () => {
    const d = deps({ callVision: vi.fn(async () => ANATOMY_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/three-arms.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.limbCount).toBe('fail')
    expect(verdict.notes).toContain('three arms')
    // A genuine anatomy read, not a check that failed to run — ticket #8830
    // callers must still bill this one.
    expect(verdict.checkCompleted).toBe(true)
  })

  // Ticket #10268: imagery-ceiling checks. A torso/hip crop with no hands in
  // frame passed every original check trivially; these three catch what the
  // anatomy checks structurally cannot.
  it('rejects a frame with a visible nipple', async () => {
    const d = deps({ callVision: vi.fn(async () => NIPPLE_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.nippleOccluded).toBe('fail')
    expect(verdict.notes).toContain('nipple')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects a frame with visible genitalia', async () => {
    const d = deps({ callVision: vi.fn(async () => GENITALIA_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.genitaliaAbsent).toBe('fail')
    expect(verdict.notes).toContain('genitalia')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('rejects a faceless body crop with ambiguous adult age markers', async () => {
    const d = deps({ callVision: vi.fn(async () => AGE_AMBIGUOUS_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/onskin.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.adultUnambiguous).toBe('fail')
    expect(verdict.notes).toContain('age markers')
    expect(verdict.checkCompleted).toBe(true)
  })

  // Ticket #10477, calibration direction 1: the licensed frame passes. A bare
  // rear is not a failure and the crease between the buttocks is not a
  // failure, so nothing about this frame may block.
  it('passes the licensed plug-along-the-cleft frame (bare buttocks, cleft visible)', async () => {
    const d = deps({ callVision: vi.fn(async () => LICENSED_PLUG_FRAME_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/plug-cleft.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.checks!.anusNotVisible).toBe('pass')
    // The clause that would have deleted this frame had the check been folded
    // into genitaliaAbsent instead of added beside it.
    expect(verdict.checks!.genitaliaAbsent).toBe('pass')
    expect(verdict.checkCompleted).toBe(true)
  })

  // Calibration direction 2: parted, so the organ itself reads.
  it('rejects a frame where the buttocks are parted and the anus reads', async () => {
    const d = deps({ callVision: vi.fn(async () => PARTED_ANUS_FAIL_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/parted.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.anusNotVisible).toBe('fail')
    expect(verdict.notes).toContain('anus')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('fails closed on the anus check when the model response omits it', async () => {
    const { anusNotVisible: _anusNotVisible, ...partial } = LICENSED_PLUG_FRAME_RESPONSE.checks
    const d = deps({ callVision: vi.fn(async () => ({ ...LICENSED_PLUG_FRAME_RESPONSE, checks: partial })) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/partial.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.anusNotVisible).toBe('fail')
    expect(verdict.checkCompleted).toBe(false)
  })

  // Ticket #10279: legibleText is a report field, not a check. A brand mark
  // on a product does not fail the vision gate; it just gets transcribed for
  // the caller to make the policy call on.
  it('transcribes legible text without affecting pass', async () => {
    const d = deps({ callVision: vi.fn(async () => BRANDED_TEXT_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/paddle.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.legibleText).toBe('TANTUS')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('reports an empty legibleText when the check ran and found no text', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.legibleText).toBe('')
  })

  // Ticket #11477: skinMarks is a report field, not a check. An unbriefed
  // mark on skin does not fail the vision gate; it just gets reported for
  // the caller to review, per the ticket's own report-only-first DONE WHEN.
  it('reports an unbriefed skin mark without affecting pass', async () => {
    const d = deps({ callVision: vi.fn(async () => SKIN_MARKS_RESPONSE) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/bead-strand.jpg', d)
    expect(verdict.pass).toBe(true)
    expect(verdict.skinMarks).toBe('faint pink-red streaks and blotches across the lower back and flank')
    expect(verdict.checkCompleted).toBe(true)
  })

  it('reports an empty skinMarks when the check ran and found none', async () => {
    const d = deps()
    const verdict = await runVisionGate('https://cdn.shopify.com/files/clean.jpg', d)
    expect(verdict.skinMarks).toBe('')
  })

  // Ticket #11460, the three DONE WHEN cases. productPhysics never gates
  // `pass`: all three frames are otherwise clean and all three verdicts read
  // pass:true, exactly as report-only requires.
  describe('productPhysics (report only, does not gate pass)', () => {
    it('reads unsupported for a product on a vertical surface with no hand', async () => {
      const d = deps({ callVision: vi.fn(async () => UNSUPPORTED_PRODUCT_RESPONSE) })
      const verdict = await runVisionGate('https://cdn.shopify.com/files/shin-adhered.jpg', d)
      expect(verdict.productPhysics).toBe('unsupported')
      expect(verdict.notes).toContain('no hand in frame')
      // Report-only: an unsupported product does not block the gate.
      expect(verdict.pass).toBe(true)
      expect(verdict.checkCompleted).toBe(true)
    })

    it('reads supported for a product gripped with fingers wrapped around it', async () => {
      const d = deps({ callVision: vi.fn(async () => GRIPPED_PRODUCT_RESPONSE) })
      const verdict = await runVisionGate('https://cdn.shopify.com/files/gripped.jpg', d)
      expect(verdict.productPhysics).toBe('supported')
      expect(verdict.pass).toBe(true)
    })

    it('reads supported for an exaggerated-scale product properly held, proving no proportion reject crept in', async () => {
      const d = deps({ callVision: vi.fn(async () => EXAGGERATED_SCALE_GRIPPED_RESPONSE) })
      const verdict = await runVisionGate('https://cdn.shopify.com/files/exaggerated-scale-held.jpg', d)
      // A large rendered product with a proper grip must NOT be penalized for
      // scale: this is the case that would silently break if a later edit
      // folded a proportion judgment into productPhysics.
      expect(verdict.productPhysics).toBe('supported')
      expect(verdict.pass).toBe(true)
    })

    it('is null when the check never completed (fail-closed, same convention as legibleText)', async () => {
      const d = deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) })
      const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
      expect(verdict.productPhysics).toBeNull()
      expect(verdict.pass).toBe(false)
    })
  })

  it('fails closed when the fetch throws', async () => {
    const d = deps({ fetchImageBase64: vi.fn(async () => { throw new Error('network down') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('network down')
    expect(VISION_CHECK_NAMES.every(n => verdict.checks![n] === 'fail')).toBe(true)
    // Ticket #8830: the check never ran, so a billing caller must not treat
    // this like a genuine judged-and-rejected image.
    expect(verdict.checkCompleted).toBe(false)
    // The legibleText/skinMarks checks never ran either; null distinguishes
    // "did not check" from "checked and found nothing" (empty string).
    expect(verdict.legibleText).toBeNull()
    expect(verdict.skinMarks).toBeNull()
  })

  it('fails closed when the model call throws', async () => {
    const d = deps({ callVision: vi.fn(async () => { throw new Error('anthropic 529') }) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
    expect(verdict.checkCompleted).toBe(false)
  })

  it('fails closed when the model response does not match the expected shape', async () => {
    const d = deps({ callVision: vi.fn(async () => ({ some: 'garbage' })) })
    const verdict = await runVisionGate('https://cdn.shopify.com/files/x.jpg', d)
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('expected verdict shape')
    expect(verdict.checkCompleted).toBe(false)
  })

  it('never throws, even when every dep throws', async () => {
    const d = deps({
      fetchImageBase64: vi.fn(async () => { throw new Error('boom') }),
      callVision: vi.fn(async () => { throw new Error('unreachable') }),
    })
    await expect(runVisionGate('https://cdn.shopify.com/files/x.jpg', d)).resolves.toMatchObject({ pass: false })
  })
})

describe('runVisionGateOnImage', () => {
  it('passes a clean already-decoded image with no fetch involved', async () => {
    const callVision = vi.fn(async () => CLEAN_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision })
    expect(verdict.pass).toBe(true)
    expect(callVision).toHaveBeenCalledWith('ZmFrZQ==', 'image/png')
  })

  it('rejects an extraOrMergedLimbs defect on a local buffer, same as the url path', async () => {
    const callVision = vi.fn(async () => ANATOMY_FAIL_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision })
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.extraOrMergedLimbs).toBe('fail')
    expect(verdict.notes).toContain('three arms')
  })

  it('fails closed when the model call throws, without ever touching fetch', async () => {
    const fetchImageBase64 = vi.fn()
    const callVision = vi.fn(async () => { throw new Error('anthropic 529') })
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/png' }, { callVision, fetchImageBase64 })
    expect(verdict.pass).toBe(false)
    expect(verdict.notes).toContain('anthropic 529')
    expect(fetchImageBase64).not.toHaveBeenCalled()
  })

  // Ticket #11029, end to end: the enumerated fields ride all the way through
  // getOneVerdict into the final verdict object, and a bad count fails the
  // whole gate even when the model's own checks self-graded clean.
  it('carries handOccludedDigits through and passes a gripping hand end to end (ticket #13174)', async () => {
    const callVision = vi.fn(async () => ({ ...CLEAN_RESPONSE, handDigitCounts: [4], handOccludedDigits: [1], backAnatomyRead: '' }))
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })
    expect(verdict.handOccludedDigits).toEqual([1])
    expect(verdict.pass).toBe(true)
    expect(verdict.checks!.handAnatomy).toBe('pass')
  })

  it('carries handDigitCounts/backAnatomyRead through to the final verdict and enforces a bad count', async () => {
    const callVision = vi.fn(async () => ({ ...CLEAN_RESPONSE, handDigitCounts: [6], backAnatomyRead: '' }))
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })
    expect(verdict.handDigitCounts).toEqual([6])
    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.handAnatomy).toBe('fail')
  })
})

// Ticket #11029. bodyscape image test 4 (2026-09-23) found the vision gate
// passing the exact reject class the owner named ('odd looking hands', 'body
// distortion') because the model self-graded handAnatomy/faceBodyIntegrity
// without ever being asked to enumerate what it saw. These reproduce the two
// named incidents from mocked, enumerated model responses (no live model
// call available to re-gate the real library rows from this suite; see the
// PR body for what that means for DONE WHEN items 1-3 on the ticket).
describe('backAnatomyReadsAsDefect (ticket #11029)', () => {
  it('flags a hair/pubic-reading patch on the back', () => {
    expect(backAnatomyReadsAsDefect('a dense dark patch above the cleft resembling pubic hair')).toBe(true)
  })

  it('flags a vulva-like crease reading', () => {
    expect(backAnatomyReadsAsDefect('a crease reading as vulva-like just above the sacrum')).toBe(true)
  })

  it('flags a navel appearing on a back view', () => {
    expect(backAnatomyReadsAsDefect('a navel is visible just above the waistline')).toBe(true)
  })

  it('does not flag a clean back read using the prompt\'s own clean-case example wording', () => {
    expect(backAnatomyReadsAsDefect('smooth skin, no navel visible')).toBe(false)
  })

  it('does not flag a clean back read phrased the other way round', () => {
    expect(backAnatomyReadsAsDefect('the navel is not visible from this angle')).toBe(false)
  })

  it('does not flag an empty read (not a back view, or nothing there)', () => {
    expect(backAnatomyReadsAsDefect('')).toBe(false)
  })

  // Ticket #13175: the clean reads on owner-approved assets 862-865, verbatim
  // in shape, failed faceBodyIntegrity through the override.
  it('does not flag a clean read that negates the pubic-hair patch', () => {
    expect(backAnatomyReadsAsDefect('smooth skin at sacrum/top of gluteal cleft, no navel visible, no pubic-hair-like patch')).toBe(false)
    expect(backAnatomyReadsAsDefect('no visible pubic hair at the cleft')).toBe(false)
    expect(backAnatomyReadsAsDefect('pubic hair is not present on the lower back')).toBe(false)
  })

  it('still flags a described patch even when another clause carries a negation', () => {
    expect(backAnatomyReadsAsDefect('faint pubic-hair-like line above the cleft')).toBe(true)
    expect(backAnatomyReadsAsDefect('no navel visible, a pubic-hair-like patch at the sacrum')).toBe(true)
    expect(backAnatomyReadsAsDefect('no hair but a crease reading as vulva-like')).toBe(true)
  })
})

// Ticket #13160: posted IG rows #354/#355 (from behind, wand across the lower
// back, sheet knotted at the hip) shipped with a line of hair at the top of
// the cleft/sacrum that the old pattern missed, because the model's own
// wording never said "pubic" — it just named the hair and where it was. The
// old pattern only ever caught this class when the model happened to qualify
// it as "pubic"-style; the gap was that qualifier, not the check itself.
describe('backAnatomyReadsAsDefect — bare hair mention (ticket #13160)', () => {
  it('flags a hair mention with no "pubic" qualifier at all (the #354/#355 shape)', () => {
    expect(backAnatomyReadsAsDefect('a line of hair at the top of the cleft')).toBe(true)
    expect(backAnatomyReadsAsDefect('hair visible along the sacrum')).toBe(true)
    expect(backAnatomyReadsAsDefect('a faint stubble line on the lower back')).toBe(true)
  })

  it('flags hairy/hairline/fuzz the same way', () => {
    expect(backAnatomyReadsAsDefect('the skin above the cleft reads hairy')).toBe(true)
    expect(backAnatomyReadsAsDefect('a hairline above the sacrum')).toBe(true)
    expect(backAnatomyReadsAsDefect('light fuzz at the top of the cleft')).toBe(true)
  })

  it('does not flag a clean read that negates hair with no "pubic" qualifier', () => {
    expect(backAnatomyReadsAsDefect('smooth skin, no hair visible above the cleft')).toBe(false)
    expect(backAnatomyReadsAsDefect('no hair or navel visible')).toBe(false)
  })

  it('still flags a bare hair mention when a different clause negates something else', () => {
    expect(backAnatomyReadsAsDefect('no navel visible, a line of hair at the sacrum')).toBe(true)
  })
})

describe('enforceEnumeratedAnatomy (ticket #11029)', () => {
  const CLEAN_ENUMERATED: VisionVerdict = {
    ...CLEAN_RESPONSE,
    checkedAt: '2026-09-27T00:00:00.000Z',
    checkCompleted: true,
  } as VisionVerdict

  it('is a no-op on a clean verdict with normal counts and a clean back read', () => {
    const result = enforceEnumeratedAnatomy({ ...CLEAN_ENUMERATED, handDigitCounts: [5, 5], backAnatomyRead: '' })
    expect(result).toEqual({ ...CLEAN_ENUMERATED, handDigitCounts: [5, 5], backAnatomyRead: '' })
  })

  it('is a no-op when checkCompleted is false (nothing to enforce against)', () => {
    const incomplete: VisionVerdict = { ...CLEAN_ENUMERATED, checkCompleted: false, checks: null, handDigitCounts: null, backAnatomyRead: null }
    expect(enforceEnumeratedAnatomy(incomplete)).toEqual(incomplete)
  })

  // Incident 1: library asset 688 (femmefunn-ultra-wand-mini, cast jade). Four
  // fingers wrapped on the front, a thumb tip past the far edge, and a sixth
  // digit hanging loose behind the handle — the model's own handAnatomy read
  // 'pass'. Enumerating counts (here: one hand, six digits) lets the code
  // force the fail the model's self-grade missed.
  it('forces handAnatomy to fail when a hand reports six digits, even though the model self-graded pass (asset 688 shape)', () => {
    const verdict: VisionVerdict = {
      ...CLEAN_ENUMERATED,
      handDigitCounts: [6],
      backAnatomyRead: '',
      notes: 'hand gripping the wand looks fine',
    }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.pass).toBe(false)
    expect(result.checks!.handAnatomy).toBe('fail')
    expect(result.notes).toContain('enumerated-anatomy override')
    expect(result.notes).toContain('[6]')
  })

  // Ticket #13174: a hand gripping a product hides its thumb behind the
  // handle. Owner-approved assets 848, 850 and 859 (2026-10-02) failed only on
  // a [4] read of a correct gripping hand.
  it('passes a gripping hand that shows four digits and hides the thumb', () => {
    const verdict: VisionVerdict = { ...CLEAN_ENUMERATED, handDigitCounts: [4], handOccludedDigits: [1], backAnatomyRead: '' }
    expect(enforceEnumeratedAnatomy(verdict)).toEqual(verdict)
  })

  it('still fails four visible digits when nothing is reported hidden, or the field is absent', () => {
    const variants: Array<Pick<VisionVerdict, 'handOccludedDigits'>> = [{ handOccludedDigits: [0] }, {}, { handOccludedDigits: null }]
    for (const variant of variants) {
      const result = enforceEnumeratedAnatomy({ ...CLEAN_ENUMERATED, handDigitCounts: [4], ...variant, backAnatomyRead: '' })
      expect(result.pass).toBe(false)
      expect(result.checks!.handAnatomy).toBe('fail')
    }
  })

  it('fails six visible digits whatever is claimed hidden', () => {
    const result = enforceEnumeratedAnatomy({ ...CLEAN_ENUMERATED, handDigitCounts: [6], handOccludedDigits: [0], backAnatomyRead: '' })
    expect(result.pass).toBe(false)
    expect(result.notes).toContain('handOccludedDigits')
  })

  it('judges each hand separately when one grips and one is open', () => {
    const ok: VisionVerdict = { ...CLEAN_ENUMERATED, handDigitCounts: [5, 4], handOccludedDigits: [0, 1], backAnatomyRead: '' }
    expect(enforceEnumeratedAnatomy(ok)).toEqual(ok)
    const bad = enforceEnumeratedAnatomy({ ...CLEAN_ENUMERATED, handDigitCounts: [5, 3], handOccludedDigits: [0, 1], backAnatomyRead: '' })
    expect(bad.checks!.handAnatomy).toBe('fail')
  })

  it('asks the model for digits with the thumb included, and for hidden digits separately', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('thumb included')
    expect(VISION_SYSTEM_PROMPT).toContain('"handOccludedDigits"')
    expect(VISION_SYSTEM_PROMPT).not.toContain('count its fingers')
  })

  it('ignores a malformed hidden-digit array and falls back to the five-visible rule', () => {
    expect(badHandDigitCounts([4], [1, 0])).toEqual([4])
    expect(badHandDigitCounts([4], [-1])).toEqual([4])
    expect(badHandDigitCounts([4, 5], [1, 0])).toEqual([])
    expect(badHandDigitCounts([], [])).toEqual([])
  })

  it('forces handAnatomy to fail when any one of multiple hands has a bad count', () => {
    const verdict: VisionVerdict = { ...CLEAN_ENUMERATED, handDigitCounts: [5, 4], backAnatomyRead: '' }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.pass).toBe(false)
    expect(result.checks!.handAnatomy).toBe('fail')
  })

  // Incident 2: library asset 690 (zola-rechargeable-silicone-mini-wand, cast
  // sofia). The top of the gluteal cleft above the sheet rendered as a dense
  // pubic-style hair patch with a vulva-like crease, on the back — the
  // model's own faceBodyIntegrity read 'pass'.
  it('forces faceBodyIntegrity to fail when backAnatomyRead reads as a genital-like patch, even though the model self-graded pass (asset 690 shape)', () => {
    const verdict: VisionVerdict = {
      ...CLEAN_ENUMERATED,
      handDigitCounts: [],
      backAnatomyRead: 'a dense pubic-style hair patch with a vulva-like crease above the cleft',
    }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.pass).toBe(false)
    expect(result.checks!.faceBodyIntegrity).toBe('fail')
    expect(result.notes).toContain('enumerated-anatomy override')
  })

  it('forces faceBodyIntegrity to fail when a navel is reported on a back-view frame', () => {
    const verdict: VisionVerdict = { ...CLEAN_ENUMERATED, handDigitCounts: [], backAnatomyRead: 'a navel is clearly visible' }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.pass).toBe(false)
    expect(result.checks!.faceBodyIntegrity).toBe('fail')
  })

  // Ticket #13160, the posted #354/#355 shape: a bare hair mention with no
  // "pubic" qualifier, which is exactly the wording that shipped undetected.
  it('forces faceBodyIntegrity to fail on a bare hair mention with no "pubic" qualifier (the #354/#355 shape)', () => {
    const verdict: VisionVerdict = {
      ...CLEAN_ENUMERATED,
      handDigitCounts: [],
      backAnatomyRead: 'a line of hair at the top of the cleft and the sacrum',
    }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.pass).toBe(false)
    expect(result.checks!.faceBodyIntegrity).toBe('fail')
    expect(result.notes).toContain('cleft/sacrum hair')
  })

  it('applies both overrides together and does not clobber an already-failing check', () => {
    const verdict: VisionVerdict = {
      ...CLEAN_ENUMERATED,
      checks: { ...CLEAN_ENUMERATED.checks!, faceBodyIntegrity: 'fail' },
      handDigitCounts: [6],
      backAnatomyRead: 'pubic-like patch',
      pass: false,
    }
    const result = enforceEnumeratedAnatomy(verdict)
    expect(result.checks!.handAnatomy).toBe('fail')
    expect(result.checks!.faceBodyIntegrity).toBe('fail')
    // Only the hand override needed to fire new; faceBodyIntegrity was
    // already failing, so it is not named again in the override note.
    expect(result.notes).toContain('handDigitCounts')
  })

  // DONE WHEN item 3: 691 and 689 (same shoot, same product family, clean
  // shots) must still pass — normal five-fingered counts and no back-view
  // defect must never trip the new enforcement.
  it('does not fire on the clean sibling shots (689/691 shape: normal counts, no back view)', () => {
    const verdict: VisionVerdict = { ...CLEAN_ENUMERATED, handDigitCounts: [5], backAnatomyRead: '' }
    expect(enforceEnumeratedAnatomy(verdict)).toEqual(verdict)
  })
})

// Ticket #11468, P0. Owner found two production verdicts that read pass:true
// on nippleOccluded/genitaliaAbsent while `notes` confidently described a
// frame that did not match the actual pixels (asset 675: "no nipples...
// visible" against a visible nipple; asset 698: "wearing underwear" against
// a bare hip). A single hallucinated read graded against its own description
// is exactly what one model call cannot self-catch, so a clean exposure read
// now requires a second, independent call to agree before `pass:true` ships.
describe('exposure-check confirmation pass (ticket #11468)', () => {
  it('does not call a second time when the first read already fails an exposure check (no false-pass risk to confirm)', async () => {
    const callVision = vi.fn(async () => NIPPLE_FAIL_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })
    expect(callVision).toHaveBeenCalledTimes(1)
    expect(verdict.pass).toBe(false)
  })

  it('confirms a clean read and passes when both independent calls agree', async () => {
    const callVision = vi.fn(async () => CLEAN_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })
    expect(callVision).toHaveBeenCalledTimes(2)
    expect(verdict.pass).toBe(true)
  })

  it('fails closed on nippleOccluded when the confirmation call disagrees with a clean first read', async () => {
    const callVision = vi.fn()
      .mockResolvedValueOnce(CLEAN_RESPONSE)
      .mockResolvedValueOnce({ ...CLEAN_RESPONSE, checks: { ...CLEAN_RESPONSE.checks, nippleOccluded: 'fail' }, notes: 'visible nipple, left breast, partially shadowed' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    expect(callVision).toHaveBeenCalledTimes(2)
    expect(verdict.pass).toBe(false)
    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.checks!.nippleOccluded).toBe('fail')
    // Unrelated checks are untouched by a disagreement scoped to exposure.
    expect(verdict.checks!.handAnatomy).toBe('pass')
    expect(verdict.notes).toContain('visible nipple, left breast')
    expect(verdict.notes).toContain('clean, nothing anomalous')
    errorSpy.mockRestore()
  })

  it('fails closed on multiple exposure checks when the confirmation call disagrees on more than one', async () => {
    const callVision = vi.fn()
      .mockResolvedValueOnce(CLEAN_RESPONSE)
      .mockResolvedValueOnce({
        ...CLEAN_RESPONSE,
        checks: { ...CLEAN_RESPONSE.checks, nippleOccluded: 'fail', genitaliaAbsent: 'fail' },
        notes: 'bare chest and exposed genitalia',
      })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    expect(verdict.pass).toBe(false)
    expect(verdict.checks!.nippleOccluded).toBe('fail')
    expect(verdict.checks!.genitaliaAbsent).toBe('fail')
    expect(verdict.checks!.anusNotVisible).toBe('pass')
  })

  it('fails closed when the confirmation call itself cannot produce a verdict, rather than trusting the single first read', async () => {
    const callVision = vi.fn()
      .mockResolvedValueOnce(CLEAN_RESPONSE)
      .mockRejectedValue(new Error('anthropic 529'))

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    expect(verdict.pass).toBe(false)
    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.checks!.nippleOccluded).toBe('fail')
    expect(verdict.checks!.genitaliaAbsent).toBe('fail')
    expect(verdict.checks!.anusNotVisible).toBe('fail')
    expect(verdict.notes).toContain('could not complete')
  })

  it('does not run a confirmation pass on the licensed plug-along-the-cleft frame when both reads agree', async () => {
    const callVision = vi.fn(async () => LICENSED_PLUG_FRAME_RESPONSE)
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })
    expect(callVision).toHaveBeenCalledTimes(2)
    expect(verdict.pass).toBe(true)
    expect(verdict.checks!.anusNotVisible).toBe('pass')
  })
})

// Ticket #10990/#11004. A prose reply from the model is a formatting slip,
// not a real refusal, and must not read as a genuine anatomy fail.
describe('JSON parse failure retry', () => {
  it('retries once with a stricter, lower-temperature call and succeeds', async () => {
    const rawProse = 'I need to look closer at this image before I can answer.'
    const callVision = vi.fn(async (_b64: string, _mt: string, opts?: { strict?: boolean }) => {
      if (!opts?.strict) throw new VisionParseError('Unexpected token I is not valid JSON', rawProse)
      return CLEAN_RESPONSE
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    // CLEAN_RESPONSE passes all three exposure checks, so the independent
    // confirmation pass (ticket #11468) runs too — a second full
    // getOneVerdict, itself subject to the same parse-failure retry this mock
    // always triggers on a non-strict call: 2 calls for the first read, 2 more
    // for the confirmation read.
    expect(callVision).toHaveBeenCalledTimes(4)
    expect(callVision).toHaveBeenNthCalledWith(1, 'ZmFrZQ==', 'image/jpeg')
    expect(callVision).toHaveBeenNthCalledWith(2, 'ZmFrZQ==', 'image/jpeg', { strict: true })
    expect(callVision).toHaveBeenNthCalledWith(4, 'ZmFrZQ==', 'image/jpeg', { strict: true })
    expect(verdict.pass).toBe(true)
    expect(verdict.checkCompleted).toBe(true)
    // Part (c) of the fix: the raw model text is logged, not swallowed.
    expect(errorSpy.mock.calls.some(call => String(call[1]?.rawText ?? call.join(' ')).includes(rawProse))).toBe(true)
    errorSpy.mockRestore()
  })

  it('returns checkCompleted:false with checks left null (not "fail") when the retry also fails to parse', async () => {
    const callVision = vi.fn(async () => {
      throw new VisionParseError('Unexpected token I is not valid JSON', 'I need to think about this differently.')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    expect(callVision).toHaveBeenCalledTimes(2)
    expect(verdict.checkCompleted).toBe(false)
    expect(verdict.checks).toBeNull()
    expect(verdict.pass).toBe(false)
    // Distinct from a genuine anatomy fail: no check reads 'fail' because none
    // of them were ever answered.
    expect(verdict.checks).not.toEqual(expect.objectContaining({ limbCount: 'fail' }))
    errorSpy.mockRestore()
  })

  it('does not retry a non-parse failure (network/model error stays a single attempt)', async () => {
    const callVision = vi.fn(async () => { throw new Error('anthropic 529') })
    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, { callVision })

    expect(callVision).toHaveBeenCalledTimes(1)
    expect(verdict.checkCompleted).toBe(false)
    // Ticket #11889: a transport/auth failure never reached a model response
    // to judge, so `checks` reports null (not judged) rather than the
    // all-'fail' shape a genuine anatomy read would produce.
    expect(verdict.checks).toBeNull()
    expect(verdict.pass).toBe(false)
  })
})

describe('recordVisionVerdict', () => {
  it('persists the verdict via the injected writer', async () => {
    const update = vi.fn(async () => {})
    await recordVisionVerdict(42, { ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z', checkCompleted: true } as VisionVerdict, { updateVerdict: update })
    expect(update).toHaveBeenCalledWith(42, expect.objectContaining({ pass: true }))
  })

  it('never throws when the writer fails (non-fatal by contract)', async () => {
    const update = vi.fn(async () => { throw new Error('neon down') })
    await expect(
      recordVisionVerdict(42, { ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z', checkCompleted: true } as VisionVerdict, { updateVerdict: update }),
    ).resolves.toBeUndefined()
  })
})

describe('regateAsset (ticket #10511)', () => {
  it('fetches, judges, and records against the given asset id', async () => {
    const update = vi.fn(async () => {})
    const fetchImageBase64 = vi.fn(async () => ({ data: 'abc', mediaType: 'image/jpeg' }))
    const callVision = vi.fn(async () => CLEAN_RESPONSE)
    const verdict = await regateAsset(238, 'https://cdn.shopify.com/files/onskin.jpg', {
      fetchImageBase64, callVision, updateVerdict: update,
    })
    expect(verdict.pass).toBe(true)
    expect(fetchImageBase64).toHaveBeenCalledWith('https://cdn.shopify.com/files/onskin.jpg')
    expect(update).toHaveBeenCalledWith(238, expect.objectContaining({ pass: true }))
  })

  it('records a genuine fail in full rather than only reporting it (cannot launder a bad frame)', async () => {
    const update = vi.fn(async () => {})
    const fetchImageBase64 = vi.fn(async () => ({ data: 'abc', mediaType: 'image/jpeg' }))
    const callVision = vi.fn(async () => ({
      ...CLEAN_RESPONSE,
      pass: false,
      checks: { ...CLEAN_RESPONSE.checks, anusNotVisible: 'fail' },
    }))
    const verdict = await regateAsset(182, 'https://cdn.shopify.com/files/x.jpg', {
      fetchImageBase64, callVision, updateVerdict: update,
    })
    expect(verdict.pass).toBe(false)
    expect(update).toHaveBeenCalledWith(182, expect.objectContaining({ pass: false }))
  })
})

describe('getVisionVerdictByUrl', () => {
  it('strips the query string before looking up', async () => {
    const lookup = vi.fn(async () => ({ ...CLEAN_RESPONSE, checkedAt: '2026-08-31T00:00:00Z', checkCompleted: true }) as VisionVerdict)
    await getVisionVerdictByUrl('https://cdn.shopify.com/files/x.jpg?v=123', { lookupVerdictByUrl: lookup })
    expect(lookup).toHaveBeenCalledWith('https://cdn.shopify.com/files/x.jpg')
  })

  it('returns null on an empty url without calling the lookup', async () => {
    const lookup = vi.fn(async () => null)
    const result = await getVisionVerdictByUrl('', { lookupVerdictByUrl: lookup })
    expect(result).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('treats a lookup failure as missing, not a throw', async () => {
    const lookup = vi.fn(async () => { throw new Error('neon down') })
    const result = await getVisionVerdictByUrl('https://cdn.shopify.com/files/x.jpg', { lookupVerdictByUrl: lookup })
    expect(result).toBeNull()
  })
})

describe('generateWithVisionGate', () => {
  it('returns the first attempt when it passes', async () => {
    const generate = vi.fn(async () => ({ url: 'https://cdn/x1.jpg', assetId: 1 }))
    const runGate = vi.fn(async () => ({ pass: true, checks: {}, notes: '', checkedAt: 't' }) as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result).toEqual({ url: 'https://cdn/x1.jpg', assetId: 1, verdict: expect.objectContaining({ pass: true }), attempts: 1 })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects a failing verdict and regenerates once, then passes', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ url: 'https://cdn/fail.jpg', assetId: 1 })
      .mockResolvedValueOnce({ url: 'https://cdn/pass.jpg', assetId: 2 })
    const runGate = vi.fn()
      .mockResolvedValueOnce({ pass: false, checks: {}, notes: 'three arms', checkedAt: 't1' } as unknown as VisionVerdict)
      .mockResolvedValueOnce({ pass: true, checks: {}, notes: 'clean', checkedAt: 't2' } as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result.url).toBe('https://cdn/pass.jpg')
    expect(result.assetId).toBe(2)
    expect(result.attempts).toBe(2)
    expect(generate).toHaveBeenCalledTimes(2)
    // Both attempts' verdicts get recorded, including the rejected one, so
    // the rejected row still carries its failing verdict for provenance.
    expect(recordVerdict).toHaveBeenCalledTimes(2)
    expect(recordVerdict).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ pass: false }))
    expect(recordVerdict).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ pass: true }))
  })

  it('exhausts the two-attempt budget and returns no url when every attempt fails', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ url: 'https://cdn/fail1.jpg', assetId: 1 })
      .mockResolvedValueOnce({ url: 'https://cdn/fail2.jpg', assetId: 2 })
    const failing = { pass: false, checks: {}, notes: 'still bad', checkedAt: 't' } as unknown as VisionVerdict
    const runGate = vi.fn(async () => failing)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result.url).toBeNull()
    expect(result.attempts).toBe(2)
    expect(result.verdict).toEqual(failing)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('stops immediately on a true generation miss, without retrying', async () => {
    const generate = vi.fn(async () => null)
    const runGate = vi.fn()
    const recordVerdict = vi.fn()
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict })
    expect(result).toEqual({ url: null, assetId: null, verdict: null, attempts: 1 })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(runGate).not.toHaveBeenCalled()
  })

  it('respects a custom maxAttempts', async () => {
    const generate = vi.fn(async () => ({ url: 'https://cdn/x.jpg', assetId: 1 }))
    const runGate = vi.fn(async () => ({ pass: false, checks: {}, notes: '', checkedAt: 't' }) as unknown as VisionVerdict)
    const recordVerdict = vi.fn(async () => {})
    const result = await generateWithVisionGate({ generate, runGate, recordVerdict, maxAttempts: 1 })
    expect(result.attempts).toBe(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(result.url).toBeNull()
  })
})

describe('defaultDeps.callVision — forced tool call (ticket #13176)', () => {
  it('parses a tool_use response into a verdict, calling the model with a forced tool_choice', async () => {
    h.mockCreate.mockReset()
    h.mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_1', name: VISION_VERDICT_TOOL_NAME, input: CLEAN_RESPONSE }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    })

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })

    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.pass).toBe(true)
    const firstCallArgs = h.mockCreate.mock.calls[0]?.[0] as { tools?: Array<{ name: string }>; tool_choice?: unknown }
    expect(firstCallArgs.tool_choice).toEqual({ type: 'tool', name: VISION_VERDICT_TOOL_NAME })
    expect(firstCallArgs.tools?.[0]?.name).toBe(VISION_VERDICT_TOOL_NAME)
  })

  it('falls back to the free-text strict retry when the model answers in prose instead of calling the forced tool', async () => {
    h.mockCreate.mockReset()
    h.mockCreate
      // First (forced-tool) attempt: the model answers in prose anyway — the
      // exact 2026-10-02 failure mode (ticket body: "I need to...") that the
      // forced tool_choice exists to make structurally impossible, kept here
      // as the defensive path in case a provider ever refuses the tool.
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'I need to look more closely before I can answer.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      // Strict retry: free-text JSON, no tool involved.
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CLEAN_RESPONSE) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      // Exposure-confirmation second read (ticket #11468): clean tool_use.
      .mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_2', name: VISION_VERDICT_TOOL_NAME, input: CLEAN_RESPONSE }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      })

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })

    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.pass).toBe(true)
    const firstCallArgs = h.mockCreate.mock.calls[0]?.[0] as { tools?: unknown; tool_choice?: unknown }
    expect(firstCallArgs.tool_choice).toEqual({ type: 'tool', name: VISION_VERDICT_TOOL_NAME })
    const retryCallArgs = h.mockCreate.mock.calls[1]?.[0] as { tools?: unknown; tool_choice?: unknown }
    expect(retryCallArgs.tools).toBeUndefined()
    expect(retryCallArgs.tool_choice).toBeUndefined()
  })

  // Ticket #13362: a forced tool call can return a tool_use block that is
  // itself a truncated partial input (stop_reason:'max_tokens') on a frame
  // whose verdict needed more than the old 400-token budget (two hands plus
  // legible packaging). Before this ticket, getOneVerdict's retry only ever
  // ran on a thrown VisionParseError, and a truncated-but-present tool_use
  // block never threw — it went straight to isValidVerdictShape and failed
  // closed with no retry at all. This asserts the retry now runs instead.
  it('retries the strict free-text leg when the forced tool call is truncated at max_tokens', async () => {
    h.mockCreate.mockReset()
    h.mockCreate
      // Forced-tool attempt: only `pass` and `checks` made it out before the
      // token budget ran out — the exact shape reported live against run
      // 1227's two-hands product hero.
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'toolu_1', name: VISION_VERDICT_TOOL_NAME, input: { pass: true, checks: CLEAN_RESPONSE.checks } }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 1024 },
      })
      // Strict retry: full, untruncated free-text JSON.
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CLEAN_RESPONSE) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      // Exposure-confirmation second read (ticket #11468): clean tool_use.
      .mockResolvedValue({
        content: [{ type: 'tool_use', id: 'toolu_2', name: VISION_VERDICT_TOOL_NAME, input: CLEAN_RESPONSE }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })

    expect(verdict.checkCompleted).toBe(true)
    expect(verdict.pass).toBe(true)
    expect(h.mockCreate).toHaveBeenCalledTimes(3)
    const firstCallArgs = h.mockCreate.mock.calls[0]?.[0] as { max_tokens: number }
    expect(firstCallArgs.max_tokens).toBeGreaterThanOrEqual(1024)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('retrying once with a stricter prompt'),
      expect.objectContaining({ message: expect.stringContaining('stop_reason=max_tokens') }),
    )
    errorSpy.mockRestore()
  })

  // Ticket #13526 (split 1-of-3 off #13398): the correlation id a caller
  // passes through runVisionGateOnImage must reach logMessageUsage, via the
  // real (non-overridden) defaultDeps.callVision, so an api_token_log row can
  // be traced back to the run that produced it.
  it('forwards refId through to logMessageUsage (#13526)', async () => {
    h.mockCreate.mockReset()
    h.mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_refid', name: VISION_VERDICT_TOOL_NAME, input: CLEAN_RESPONSE }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    vi.mocked(logMessageUsage).mockClear()

    await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' }, undefined, 'run-123')

    expect(logMessageUsage).toHaveBeenCalledWith(
      'social-vision-gate',
      expect.any(String),
      'social-vision-gate/callVision',
      expect.anything(),
      'run-123',
    )
  })

  it('passes refId as undefined when the caller gives none (#13526)', async () => {
    h.mockCreate.mockReset()
    h.mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'toolu_norefid', name: VISION_VERDICT_TOOL_NAME, input: CLEAN_RESPONSE }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    vi.mocked(logMessageUsage).mockClear()

    await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })

    expect(logMessageUsage).toHaveBeenCalledWith(
      'social-vision-gate',
      expect.any(String),
      'social-vision-gate/callVision',
      expect.anything(),
      undefined,
    )
  })

  // The second half of the same DONE WHEN: when the strict retry is ALSO
  // truncated, the failure must still reach Sentry, and the report must
  // name the stop reason rather than reading as an ordinary malformed-JSON
  // parse error.
  it('reaches Sentry naming the stop reason when the strict retry is also truncated', async () => {
    h.mockCreate.mockReset()
    h.captureException.mockReset()
    h.mockCreate
      // Forced-tool attempt: truncated, as above.
      .mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'toolu_1', name: VISION_VERDICT_TOOL_NAME, input: { pass: true, checks: CLEAN_RESPONSE.checks } }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 1024 },
      })
      // Strict free-text retry: also cut off before the closing brace.
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(CLEAN_RESPONSE).slice(0, 40) }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 1024 },
      })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const verdict = await runVisionGateOnImage({ data: 'ZmFrZQ==', mediaType: 'image/jpeg' })

    expect(verdict.checkCompleted).toBe(false)
    expect(h.captureException).toHaveBeenCalledTimes(1)
    const captured = h.captureException.mock.calls[0]?.[0] as Error
    expect(captured.message).toContain('stop_reason=max_tokens')
    vi.restoreAllMocks()
  })
})
