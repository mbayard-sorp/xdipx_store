/**
 * Emma orchestrator — Sonnet tool-use loop that decides which content
 * generators to run for an imported product and returns a consolidated
 * write payload for `pushProductToShopify`.
 *
 * The model picks tools (always-on + conditional) and each tool stores its
 * output on the shared state. A terminal `finish` tool marks completion and
 * the orchestrator returns whatever has accumulated. The model is NOT asked
 * to re-emit the full payload in `finish` — that wastes tokens and is fragile.
 *
 * Modeled on `generateRails` at app/lib/claude.server.ts:1281 (8-turn cap,
 * tool-use threading via tool_use / tool_result message pairs).
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  generateCopy,
  generateEmmaTake,
  generateCareInstructions,
  generateSensationDialV2,
  generateEmmaHero,
  inferProductTypeDial,
  generateAskEmmaTags,
  generateIvrExperience,
  generateIvrUseCase,
  generateIvrFeatures,
  generateIvrVoiceSummary,
  type AskEmmaAxis,
  type IvrExperience,
} from '~/lib/claude.server'
import { getDialRegistry, appendDialLabel, type DialRegistry } from '~/lib/dial-registry.server'
import { getAskEmmaVocabulary, type AskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'
import { generateMoodImage } from '~/lib/imagen.server'
import { uploadMoodImageToShopifyFiles } from '~/lib/shopify.server'
import type {
  Deal, EmmaHeroCopy, ProductTypeDial, SensationDialV2,
} from '~/types'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TURNS = 24

// ─── Public types ────────────────────────────────────────────────────────────

export type DealCategory = 'for-him' | 'for-her' | 'both' | 'couples'

export interface OrchestratorProductInput {
  title:        string
  brand:        string
  description:  string
  categories:   string[]
  dealPrice:    number
  msrp:         number
}

export interface OrchestratorInput {
  product:  OrchestratorProductInput
  /** Pre-computed by the caller. The orchestrator wires it through to generators. */
  seoTitle: string
  /** Inferred deal category — narrow Deal-shaped union. */
  category: DealCategory
}

export interface ProductWrites {
  productTypeDial:    ProductTypeDial
  tagline:            string
  featureBullets:     string[]
  worksForHim?:       string
  worksForHer?:       string
  boxContents?:       string[]
  specifications?:    string
  seoMetaDescription: string
  descriptionHtml:    string         // Emma's take, written to product.body_html
  careInstructions?:  string[]
  sensationDialV2?:   SensationDialV2
  moodTags:           string[]
  audienceTags:       string[]
  mattersTags:        string[]
  emmaHero?:          EmmaHeroCopy
  moodImageUrl?:      string         // Shopify CDN URL after Files-API upload
  // IVR / voice surfaces — purpose-built for chat / IVR / SMS where descriptionHtml can't render.
  ivrExperience?:     IvrExperience
  ivrUseCase?:        string[]
  ivrFeatures?:       string[]
  ivrVoiceSummary?:   string
}

export interface ToolCallTrace {
  name:         string
  durationMs:   number
  inputTokens:  number
  outputTokens: number
  ok:           boolean
  error?:       string
}

export interface OrchestratorTelemetry {
  totalInputTokens:  number
  totalOutputTokens: number
  totalTokens:       number
  durationMs:        number
  turns:             number
  toolCalls:         ToolCallTrace[]
}

export interface OrchestratorResult {
  writes:    ProductWrites
  telemetry: OrchestratorTelemetry
}

// ─── Internal state ──────────────────────────────────────────────────────────

interface OrchestratorState {
  input:        OrchestratorInput
  dialRegistry: DialRegistry
  vocab:        AskEmmaVocabulary
  writes:       Partial<ProductWrites>
  telemetry:    OrchestratorTelemetry
  finished:     boolean
}

function makeDealContext(state: OrchestratorState): Pick<
  Deal,
  'seoTitle' | 'tagline' | 'fullStory' | 'brand' | 'category' | 'specifications' | 'dealPrice' | 'msrp'
> & { productTypeDial?: ProductTypeDial; mapRestricted: boolean } {
  // Deal-shaped object for downstream generators; populated as tools run.
  return {
    seoTitle:        state.input.seoTitle,
    tagline:         state.writes.tagline ?? '',
    fullStory:       state.writes.descriptionHtml ?? '',
    brand:           state.input.product.brand,
    category:        state.input.category,
    ...(state.writes.productTypeDial ? { productTypeDial: state.writes.productTypeDial } : {}),
    specifications:  state.writes.specifications ?? '',
    dealPrice:       state.input.product.dealPrice,
    msrp:            state.input.product.msrp,
    mapRestricted:   false,
  }
}

// ─── Tool definitions (sent to the model) ────────────────────────────────────

const TOOLS = [
  {
    name: 'classifyProductTypeDial',
    description: 'Classify the product into one of: air-pulsation, vibrator, wand, lube, wear. Always call this FIRST so other tools have the right type.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateTagline',
    description: 'Generate the product tagline (one short, witty line). Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateFeatureBullets',
    description: 'Generate 6–10 short feature bullets. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateSpecifications',
    description: 'Generate the specifications HTML for the Specs tab. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateSeoMeta',
    description: 'Generate the SEO meta description. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateEmmaTake',
    description: "Generate Emma's first-person take (becomes Shopify body_html / Emma's take tab). Always call this.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateCareInstructions',
    description: 'Generate 3–5 short care bullets. Call this for product types where care matters: vibrator, wand, air-pulsation, wear. SKIP for lube unless the lube has a real care/storage note.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateSensationDialV2',
    description: 'Generate the 5–6 dimension sensation dial scored 1–5. Always call this AFTER classifyProductTypeDial.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateBoxContents',
    description: 'Generate "what is in the box" bullets. Call this for hardware (vibrator, wand, air-pulsation). SKIP for lube. SKIP for wear unless the wear product has packaging contents worth listing.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateMoodTags',
    description: 'Generate slugified mood tags from the controlled vocabulary. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateAudienceTags',
    description: 'Generate slugified audience tags (me / us / gift) from the controlled vocabulary. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateMattersTags',
    description: 'Generate slugified "what matters" tags (quiet, soft-touch, travel-size, etc.) from the controlled vocabulary. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateEmmaHero',
    description: 'Generate the Emma hero block (eyebrow / headline / body / aside). Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateMoodImage',
    description: 'Generate ONE PDP hero mood image and upload to Shopify Files. Always call this. Returns a CDN URL stored on the writes payload.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateIvrExperience',
    description: 'Pick ONE experience level the product fits best (first-time / curious / experienced / advanced / any). Used by Emma chat/IVR/SMS to match buyer intent. Always call this AFTER classifyProductTypeDial and generateEmmaTake (so context is rich).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateIvrUseCase',
    description: 'Pick 1–3 voice-friendly use-case slugs (date-night / travel / everyday / discovery / gift / celebration). Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateIvrFeatures',
    description: 'Pick 2–4 voice-mentionable feature slugs (app-controlled / waterproof / quiet / etc.) that Emma can speak aloud when filtering. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateIvrVoiceSummary',
    description: 'Write a 1–2 sentence Emma-voice summary designed to be read aloud over phone/chat/SMS. Plain text, no markup. Always call this LAST among IVR tools (it benefits from richer context).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'finish',
    description: 'Call this last — when every applicable tool above has been called. Takes no arguments; orchestrator returns the consolidated writes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
] as const

// ─── Tool execution ──────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  state: OrchestratorState,
): Promise<{ ok: boolean; summary: string }> {
  const { product } = state.input
  const dealCtx = makeDealContext(state)

  switch (name) {
    case 'classifyProductTypeDial': {
      const t = await inferProductTypeDial({
        title:       product.title,
        brand:       product.brand,
        description: product.description,
        categories:  product.categories,
      })
      state.writes.productTypeDial = t
      return { ok: true, summary: `productTypeDial=${t}` }
    }

    case 'generateTagline': {
      const r = await generateCopy({ type: 'tagline', product })
      const arr = r.content as string[]
      const first = Array.isArray(arr) ? arr[0] : (arr as unknown as string)
      state.writes.tagline = (first ?? '').trim()
      return { ok: true, summary: `tagline len=${state.writes.tagline.length}` }
    }

    case 'generateFeatureBullets': {
      const r = await generateCopy({ type: 'bullets', product })
      const bullets = (r.content as string[]) ?? []
      state.writes.featureBullets = bullets
      return { ok: bullets.length > 0, summary: `bullets=${bullets.length}` }
    }

    case 'generateSpecifications': {
      const r = await generateCopy({ type: 'specifications', product })
      state.writes.specifications = (r.content as string) ?? ''
      return { ok: !!state.writes.specifications, summary: `specs len=${state.writes.specifications.length}` }
    }

    case 'generateSeoMeta': {
      const r = await generateCopy({ type: 'seo_meta', product })
      state.writes.seoMetaDescription = (r.content as string) ?? ''
      return { ok: !!state.writes.seoMetaDescription, summary: `seoMeta len=${state.writes.seoMetaDescription.length}` }
    }

    case 'generateEmmaTake': {
      const html = await generateEmmaTake({ deal: dealCtx })
      state.writes.descriptionHtml = html
      return { ok: !!html, summary: `emmaTake len=${html.length}` }
    }

    case 'generateCareInstructions': {
      try {
        const bullets = await generateCareInstructions({ deal: dealCtx })
        state.writes.careInstructions = bullets
        return { ok: true, summary: `care=${bullets.length}` }
      } catch (err) {
        // Care is optional — let the model continue.
        return { ok: false, summary: `care skipped: ${err instanceof Error ? err.message : 'error'}` }
      }
    }

    case 'generateSensationDialV2': {
      const type: ProductTypeDial = state.writes.productTypeDial ?? 'vibrator'
      const preferredLabels = state.dialRegistry[type] ?? []
      const dial = await generateSensationDialV2({
        deal: { ...dealCtx, productTypeDial: type },
        preferredLabels,
      })
      state.writes.sensationDialV2 = dial
      // Emma can propose a new dial label when none of the preferred ones fit.
      // Persist proposals back to the registry so the next product of this type
      // sees them — closes the learning loop. Idempotent (appendDialLabel
      // no-ops on case-insensitive duplicates). Best-effort: a Sanity blip
      // shouldn't fail the dial write.
      const proposed = dial.items.filter(i => i.proposed && typeof i.label === 'string')
      let appended = 0
      for (const item of proposed) {
        try {
          const next = await appendDialLabel(type, item.label)
          if (next.length !== (state.dialRegistry[type]?.length ?? 0)) {
            state.dialRegistry[type] = next
            appended++
          }
        } catch (err) {
          console.warn(`[emma-orchestrator] appendDialLabel(${type}, "${item.label}") failed:`, err instanceof Error ? err.message : err)
        }
      }
      return { ok: true, summary: `dial items=${dial.items.length}${appended > 0 ? ` appended=${appended}` : ''}` }
    }

    case 'generateBoxContents': {
      const r = await generateCopy({ type: 'box_contents', product })
      const bc = (r.content as string[]) ?? []
      if (bc.length > 0) state.writes.boxContents = bc
      return { ok: true, summary: `boxContents=${bc.length}` }
    }

    case 'generateMoodTags':
    case 'generateAudienceTags':
    case 'generateMattersTags': {
      const axis: AskEmmaAxis =
        name === 'generateMoodTags'     ? 'mood'
        : name === 'generateAudienceTags' ? 'audience'
        : 'matters'
      const tags = await generateAskEmmaTags({
        deal: dealCtx,
        axis,
        preferredLabels: state.vocab[axis],
      })
      if (axis === 'mood')          state.writes.moodTags     = tags
      else if (axis === 'audience') state.writes.audienceTags = tags
      else                          state.writes.mattersTags  = tags
      return { ok: true, summary: `${axis}Tags=${tags.length}` }
    }

    case 'generateEmmaHero': {
      const hero = await generateEmmaHero({
        deal: {
          seoTitle:      dealCtx.seoTitle,
          tagline:       dealCtx.tagline,
          fullStory:     dealCtx.fullStory,
          brand:         dealCtx.brand,
          category:      dealCtx.category,
          dealPrice:     dealCtx.dealPrice,
          msrp:          dealCtx.msrp,
          mapRestricted: dealCtx.mapRestricted,
        },
      })
      state.writes.emmaHero = hero
      return { ok: true, summary: `emmaHero variant=${hero.variant}` }
    }

    case 'generateMoodImage': {
      if (process.env.EMMA_SKIP_IMAGE === '1') {
        return { ok: true, summary: 'moodImage skipped (EMMA_SKIP_IMAGE=1)' }
      }
      try {
        const buffers = await generateMoodImage({
          categories: product.categories,
          count:      1,
        })
        const buf = buffers[0]
        if (!buf) return { ok: false, summary: 'no image buffer returned' }
        const slug = product.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
        const url = await uploadMoodImageToShopifyFiles(buf, `mood-${slug}-${Date.now()}.jpg`)
        state.writes.moodImageUrl = url
        return { ok: true, summary: `moodImage url=${url.slice(0, 80)}` }
      } catch (err) {
        // Image generation is best-effort — don't kill the import.
        return { ok: false, summary: `moodImage skipped: ${err instanceof Error ? err.message : 'error'}` }
      }
    }

    case 'generateIvrExperience': {
      const lvl = await generateIvrExperience({ deal: dealCtx })
      state.writes.ivrExperience = lvl
      return { ok: true, summary: `ivrExperience=${lvl}` }
    }

    case 'generateIvrUseCase': {
      const tags = await generateIvrUseCase({ deal: dealCtx })
      state.writes.ivrUseCase = tags
      return { ok: true, summary: `ivrUseCase=${tags.length}` }
    }

    case 'generateIvrFeatures': {
      const tags = await generateIvrFeatures({ deal: dealCtx })
      state.writes.ivrFeatures = tags
      return { ok: true, summary: `ivrFeatures=${tags.length}` }
    }

    case 'generateIvrVoiceSummary': {
      const summary = await generateIvrVoiceSummary({ deal: dealCtx })
      state.writes.ivrVoiceSummary = summary
      return { ok: !!summary, summary: `ivrVoiceSummary len=${summary.length}` }
    }

    case 'finish': {
      state.finished = true
      return { ok: true, summary: 'orchestrator complete' }
    }

    default:
      return { ok: false, summary: `unknown tool: ${name}` }
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

const SYSTEM = `You are Emma's content brain for xdipx.com — an editorially-curated sexual-wellness storefront. Given one product, you decide which content generators to run to fully populate its PDP and Emma's voice surfaces (chat / IVR / SMS), then call them via tools.

Required for every product: classifyProductTypeDial (FIRST), generateTagline, generateFeatureBullets, generateSpecifications, generateSeoMeta, generateEmmaTake, generateSensationDialV2, generateMoodTags, generateAudienceTags, generateMattersTags, generateEmmaHero, generateMoodImage, generateIvrExperience, generateIvrUseCase, generateIvrFeatures, generateIvrVoiceSummary.

Conditional:
- generateCareInstructions: skip for lube unless the lube has a real care/storage note.
- generateBoxContents: skip for lube; usually skip for wear.

Order rules:
- classifyProductTypeDial FIRST (other tools depend on its result).
- generateSensationDialV2 must run AFTER classifyProductTypeDial.
- generateIvrExperience / UseCase / Features / VoiceSummary should run AFTER generateEmmaTake so they have richer context.
- Call generateIvrVoiceSummary LAST among the IVR tools.

When every applicable tool above has been called, call \`finish\` with no arguments. Do NOT re-emit content — the orchestrator already has it.

Be efficient. Each tool is a single call. Do NOT call the same tool twice.`

export async function generateProductContent(input: OrchestratorInput): Promise<OrchestratorResult> {
  const t0 = Date.now()
  const [dialRegistry, vocab] = await Promise.all([
    getDialRegistry(),
    getAskEmmaVocabulary(),
  ])

  const state: OrchestratorState = {
    input,
    dialRegistry,
    vocab,
    writes: {},
    telemetry: {
      totalInputTokens:  0,
      totalOutputTokens: 0,
      totalTokens:       0,
      durationMs:        0,
      turns:             0,
      toolCalls:         [],
    },
    finished: false,
  }

  const userPrompt = `Generate the full PDP content for this product:

Title: ${input.product.title}
Brand: ${input.product.brand}
Categories: ${input.product.categories.join(', ') || '(none)'}
Description (truncated): ${input.product.description.slice(0, 800)}

SEO title (already set, for context): ${input.seoTitle}
Pricing context (do not echo): deal $${input.product.dealPrice} / msrp $${input.product.msrp}

Start with classifyProductTypeDial, then run every other applicable tool exactly once, then call finish.`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: userPrompt }]

  const calledTools = new Set<string>()

  while (state.telemetry.turns < MAX_TURNS && !state.finished) {
    state.telemetry.turns++

    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system:     SYSTEM,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools:      TOOLS as any,
      messages,
    })

    state.telemetry.totalInputTokens  += response.usage.input_tokens
    state.telemetry.totalOutputTokens += response.usage.output_tokens

    messages.push({ role: 'assistant', content: response.content })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUses = response.content.filter((b: any) => b.type === 'tool_use') as
      Array<{ id: string; name: string; input: unknown }>

    if (toolUses.length === 0) {
      // Model stopped without calling finish; treat as done.
      break
    }

    const toolResults = await Promise.all(
      toolUses.map(async tu => {
        if (calledTools.has(tu.name)) {
          return {
            type:        'tool_result' as const,
            tool_use_id: tu.id,
            content:     JSON.stringify({ ok: false, summary: `${tu.name} already called — skipping duplicate` }),
          }
        }
        calledTools.add(tu.name)

        const start = Date.now()
        let ok = false
        let summary = ''
        let errorMsg: string | undefined
        try {
          const r = await executeTool(tu.name, state)
          ok = r.ok
          summary = r.summary
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err)
          summary = `tool error: ${errorMsg}`
        }
        state.telemetry.toolCalls.push({
          name:         tu.name,
          durationMs:   Date.now() - start,
          inputTokens:  0,
          outputTokens: 0,
          ok,
          ...(errorMsg ? { error: errorMsg } : {}),
        })
        return {
          type:        'tool_result' as const,
          tool_use_id: tu.id,
          content:     JSON.stringify({ ok, summary }),
          ...(errorMsg ? { is_error: true } : {}),
        }
      }),
    )

    messages.push({ role: 'user', content: toolResults })

    if (state.finished) break
    if (response.stop_reason === 'end_turn') break
  }

  state.telemetry.totalTokens = state.telemetry.totalInputTokens + state.telemetry.totalOutputTokens
  state.telemetry.durationMs  = Date.now() - t0

  // Validate the writes payload contains the always-required fields. If a
  // required field is missing, fall back to an empty default so the import
  // doesn't completely fail.
  const writes: ProductWrites = {
    productTypeDial:    state.writes.productTypeDial    ?? 'vibrator',
    tagline:            state.writes.tagline            ?? `${input.product.brand} ${input.product.title} — at xdipx.`,
    featureBullets:     state.writes.featureBullets     ?? [],
    seoMetaDescription: state.writes.seoMetaDescription ?? '',
    descriptionHtml:    state.writes.descriptionHtml    ?? '',
    moodTags:           state.writes.moodTags           ?? [],
    audienceTags:       state.writes.audienceTags       ?? [],
    mattersTags:        state.writes.mattersTags        ?? [],
    ...(state.writes.boxContents     !== undefined ? { boxContents:      state.writes.boxContents }     : {}),
    ...(state.writes.specifications  !== undefined ? { specifications:   state.writes.specifications }  : {}),
    ...(state.writes.careInstructions!== undefined ? { careInstructions: state.writes.careInstructions } : {}),
    ...(state.writes.sensationDialV2 !== undefined ? { sensationDialV2:  state.writes.sensationDialV2 } : {}),
    ...(state.writes.emmaHero        !== undefined ? { emmaHero:         state.writes.emmaHero }        : {}),
    ...(state.writes.moodImageUrl    !== undefined ? { moodImageUrl:     state.writes.moodImageUrl }    : {}),
    ...(state.writes.ivrExperience   !== undefined ? { ivrExperience:    state.writes.ivrExperience   } : {}),
    ...(state.writes.ivrUseCase      !== undefined ? { ivrUseCase:       state.writes.ivrUseCase      } : {}),
    ...(state.writes.ivrFeatures     !== undefined ? { ivrFeatures:      state.writes.ivrFeatures     } : {}),
    ...(state.writes.ivrVoiceSummary !== undefined ? { ivrVoiceSummary:  state.writes.ivrVoiceSummary } : {}),
  }

  return { writes, telemetry: state.telemetry }
}
