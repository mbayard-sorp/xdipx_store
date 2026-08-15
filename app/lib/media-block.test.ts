// Unit tests for the generation-failure classifier.
//
// The payloads below are the REAL bodies captured from fal during the 2026-08-10
// bake-off, not invented ones. The distinction the classifier has to get right is
// refusal vs outage: a refusal means route the surface to a different model, an
// outage means retry, and counting them together is what made the problem
// invisible in the first place.
import { describe, it, expect } from 'vitest'
import {
  classifyProviderResponse,
  classifyMediaFailure,
  isContentBlock,
  encodeBlockRef,
  decodeBlockRef,
} from './media-block'

// Captured verbatim: nano-banana/edit refusing an ordinary catalog vibrator.
const NANO_BANANA_422 =
  '{"detail":[{"loc":["body","prompt"],"msg":"The content could not be processed because it ' +
  'contained material flagged by a content checker.","type":"content_policy_violation"}]}'

// Captured verbatim: seedream 4.5 refusing the Shopify packshot on the way IN,
// with enable_safety_checker already false.
const SEEDREAM_422 =
  '{"detail":[{"loc":["body","image"],"msg":"The content could not be processed because it ' +
  'contained material flagged by a content checker.","type":"content_policy_violation"}]}'

describe('classifyProviderResponse', () => {
  it('classifies a prompt-side refusal and names the surface', () => {
    const f = classifyProviderResponse(422, NANO_BANANA_422)
    expect(f).toEqual({ reason: 'content_policy', surface: 'prompt' })
    expect(isContentBlock(f)).toBe(true)
  })

  it('classifies an image-side refusal and names the surface', () => {
    // This is the distinction that killed seedream as an option: the refusal was
    // on our product PHOTO, so no prompt rewrite could ever have recovered it.
    expect(classifyProviderResponse(422, SEEDREAM_422)).toEqual({
      reason: 'content_policy', surface: 'image',
    })
  })

  it('does not count an outage as a refusal', () => {
    expect(classifyProviderResponse(500, 'internal server error').reason).toBe('server')
    expect(classifyProviderResponse(503, 'upstream unavailable').reason).toBe('server')
    expect(classifyProviderResponse(429, 'slow down').reason).toBe('rate_limit')
    expect(classifyProviderResponse(401, 'bad key').reason).toBe('auth')
    expect(classifyProviderResponse(504, 'gateway timeout').reason).toBe('timeout')
  })

  it('treats an unrecognized 422 as a refusal rather than unknown', () => {
    // Providers reword these without notice; every 422 seen in the bake-off was
    // a refusal, so defaulting the other way would undercount the metric.
    expect(classifyProviderResponse(422, '{"detail":"nope"}').reason).toBe('content_policy')
  })

  it('survives a non-JSON or empty body without throwing', () => {
    expect(classifyProviderResponse(500, '').reason).toBe('server')
    expect(classifyProviderResponse(418, '<html>teapot</html>').reason).toBe('unknown')
  })
})

describe('classifyMediaFailure', () => {
  it('recognizes Gemini prose refusals, which carry no status code', () => {
    expect(classifyMediaFailure(new Error('Image blocked by safety filters')).reason)
      .toBe('content_policy')
    expect(classifyMediaFailure(new Error(
      'Gemini returned no image data (finishReason: IMAGE_SAFETY). Prompt may have been filtered.',
    ))).toEqual({ reason: 'content_policy', surface: 'prompt' })
  })

  it('sees through the Imagen wrapper message to the underlying refusal', () => {
    const err = new Error('All image generations failed: Image blocked by safety filters')
    expect(classifyMediaFailure(err).reason).toBe('content_policy')
  })

  it('classifies a thrown fal error string from its embedded status and body', () => {
    const err = new Error(`fal.ai fal-ai/nano-banana/edit error: 422 ${NANO_BANANA_422}`)
    expect(classifyMediaFailure(err)).toEqual({ reason: 'content_policy', surface: 'prompt' })
  })

  it('separates config and transport failures from refusals', () => {
    expect(classifyMediaFailure(new Error('FAL_KEY env var is required')).reason).toBe('auth')
    expect(classifyMediaFailure(new Error('The operation was aborted')).reason).toBe('timeout')
    expect(classifyMediaFailure(new Error('fetch failed')).reason).toBe('unknown')
    expect(classifyMediaFailure(undefined).reason).toBe('unknown')
  })
})

describe('block ref encoding', () => {
  it('round-trips through the ref_id column', () => {
    for (const f of [
      { reason: 'content_policy' as const, surface: 'prompt' as const },
      { reason: 'content_policy' as const, surface: 'image' as const },
      { reason: 'server' as const, surface: null },
    ]) {
      expect(decodeBlockRef(encodeBlockRef(f))).toEqual(f)
    }
  })

  it('degrades to unknown on a missing or malformed ref', () => {
    expect(decodeBlockRef(null)).toEqual({ reason: 'unknown', surface: null })
    expect(decodeBlockRef('')).toEqual({ reason: 'unknown', surface: null })
  })

  it('stays inside the ref_id column width', () => {
    expect(encodeBlockRef({ reason: 'content_policy', surface: 'prompt' }).length)
      .toBeLessThanOrEqual(64)
  })
})
