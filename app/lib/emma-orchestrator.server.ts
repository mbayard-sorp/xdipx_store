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
import {
  generateCopy,
  generateProductCopyBundle,
  generateEmmaTake,
  generateCareInstructions,
  generateSensationDialV2,
  generateEmmaHero,
  inferProductTaxonomy,
  generateAskEmmaTagsAll,
  generateIvrAll,
  generateProductFaqs,
  generateProductTitle,
  generatePairingWhy,
  drainToolTokens,
  type ProductFaq,
  type IvrExperience,
} from '~/lib/claude.server'
import { getDialRegistry, getDialTaxonomy, appendDialLabel, type DialRegistry, type DialTaxonomy } from '~/lib/dial-registry.server'
import { getAskEmmaVocabulary, type AskEmmaVocabulary } from '~/lib/ask-emma-vocab.server'
import { generateMoodImage } from '~/lib/imagen.server'
import { uploadMoodImageToShopifyFiles, type PairingCandidate } from '~/lib/shopify.server'
import { getDefaultClient, loadAgentSdk, type LLMClient } from '~/lib/llm-client.server'
import { SONNET } from './models.server'
import type {
  Deal, EmmaHeroCopy, ProductTypeDial, ProductSubtypeDial, SensationDialV2,
} from '~/types'

const MODEL = SONNET
const MAX_TURNS = 24

// ─── Public types ────────────────────────────────────────────────────────────

/** Phase 2 — multi-select audience tagging. The legacy single-value 'both' is
 *  expressed as ['for-him', 'for-her']. */
export type DealCategoryValue = 'for-him' | 'for-her' | 'couples'
export type DealCategory      = DealCategoryValue[]

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
  /** Pairing candidate accessories (from getPairingCandidates) — lets the
   *  proposePairingWhy tool pick 1–3 to recommend with Emma-voice copy.
   *  Optional: when omitted, the tool short-circuits and the orchestrator
   *  produces no pairings. */
  pairingCandidates?: PairingCandidate[]
  /** LLM transport. Defaults to AnthropicSdkClient (production importer).
   *  The backfill script can swap this for ClaudeAgentSdkClient to route
   *  through the user's Max subscription instead of API tokens. */
  llmClient?: LLMClient
}

export interface ProductWrites {
  productTypeDial:    ProductTypeDial
  /** Phase 1 D1 — per-parent subtype (closed list scoped to productTypeDial).
   *  Null when type is `sex-machine` (no subtype) or classification is too
   *  ambiguous to commit. Written to `custom.product_subtype_dial` metafield. */
  productSubtypeDial?: ProductSubtypeDial | null
  /** SEO-augmented title when augmented=true. Equal to input seoTitle when raw was already descriptive. */
  productTitle?:      string
  /** True when the orchestrator augmented the manufacturer's raw title. */
  productTitleAugmented?: boolean
  /** Manufacturer's original title verbatim — written to xdipx.original_title. */
  originalTitle?:     string
  tagline:            string
  worksForHim?:       string
  worksForHer?:       string
  boxContents?:       string[]
  specifications?:    string[]
  seoMetaDescription: string
  descriptionHtml:    string         // Emma's take, written to product.body_html
  careInstructions?:  string[]
  sensationDialV2?:   SensationDialV2
  moodTags:           string[]
  audienceTags:       string[]
  mattersTags:        string[]
  emmaHero?:          EmmaHeroCopy
  moodImageUrl?:      string         // Shopify CDN URL after Files-API upload
  // Pairing — written to xdipx.pairing_why + xdipx.accessory_product_ids on PDP
  accessoryProductIds?: string[]
  pairingWhy?:        Record<string, string>
  // IVR / voice surfaces — purpose-built for chat / IVR / SMS where descriptionHtml can't render.
  ivrExperience?:     IvrExperience
  ivrUseCase?:        string[]
  ivrFeatures?:       string[]
  // PDP FAQs — Sanity-only (productPage.productFaqs[]). Renders visibly + emits FAQPage JSON-LD.
  productFaqs?:       ProductFaq[]
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
  /** Cache writes — paid at 1.25× input price. Counted at first call per cached prefix. */
  totalCacheCreationTokens: number
  /** Cache reads — paid at ~10% of input price (90% off). Counted on every subsequent call within TTL. */
  totalCacheReadTokens:     number
  durationMs:        number
  turns:             number
  toolCalls:         ToolCallTrace[]
}

export interface OrchestratorResult {
  writes:    ProductWrites
  telemetry: OrchestratorTelemetry
}

// ─── Internal state ──────────────────────────────────────────────────────────

export interface OrchestratorState {
  input:        OrchestratorInput
  dialRegistry: DialRegistry
  dialTaxonomy: DialTaxonomy
  vocab:        AskEmmaVocabulary
  writes:       Partial<ProductWrites>
  telemetry:    OrchestratorTelemetry
  finished:     boolean
}

function makeDealContext(state: OrchestratorState): Pick<
  Deal,
  'seoTitle' | 'tagline' | 'fullStory' | 'descriptionHtml' | 'careInstructions' | 'brand' | 'category' | 'specifications' | 'dealPrice' | 'msrp'
> & { productTypeDial?: ProductTypeDial; mapRestricted: boolean } {
  // Deal-shaped object for downstream generators; populated as tools run.
  // Phase 1 rebuild — also threads descriptionHtml (B1) and careInstructions
  // (C3) through so generateProductFaqs (H1) can DIFFERENTIATE its Q&A from
  // those surfaces. When B1/C3 haven't run yet, the H1 context is empty and
  // the prompt degrades gracefully (FAQs produced without differentiation
  // guidance). Tool ordering hint in the orchestrator's user message tries
  // to schedule B1 + C3 before H1.
  return {
    // Use the augmented title once generateProductTitle has run; fall back
    // to the caller-supplied seoTitle until then. This way Emma's Take and
    // friends speak in terms of the final shopper-facing title.
    seoTitle:        state.writes.productTitle ?? state.input.seoTitle,
    tagline:         state.writes.tagline ?? '',
    fullStory:       state.writes.descriptionHtml ?? '',
    ...(state.writes.descriptionHtml  ? { descriptionHtml:  state.writes.descriptionHtml }  : {}),
    ...(state.writes.careInstructions ? { careInstructions: state.writes.careInstructions } : {}),
    brand:           state.input.product.brand,
    category:        state.input.category,
    ...(state.writes.productTypeDial ? { productTypeDial: state.writes.productTypeDial } : {}),
    specifications:  state.writes.specifications ?? [],
    dealPrice:       state.input.product.dealPrice,
    msrp:            state.input.product.msrp,
    mapRestricted:   false,
  }
}

/**
 * Compose a `GenerateCopyRequest['product']` shape from the orchestrator state,
 * threading the dial classification + tags accumulated by earlier tools so the
 * SEO keyword bank's `buildKeywordBlock` can filter approved terms by them.
 *
 * Without this, copy generators receive only the raw input fields and the
 * keyword filter sees empty arrays — falling back to no targeting context.
 */
function enrichProduct(
  state: OrchestratorState,
  product: OrchestratorProductInput,
): {
  title: string
  brand: string
  description: string
  categories: string[]
  dealPrice?: number
  msrp?: number
  productTypeDial?: ProductTypeDial
  moodTags?: string[]
  audienceTags?: string[]
  mattersTags?: string[]
} {
  const enriched: ReturnType<typeof enrichProduct> = {
    title:       state.writes.productTitle ?? product.title,
    brand:       product.brand,
    description: product.description,
    categories:  product.categories,
    dealPrice:   product.dealPrice,
    msrp:        product.msrp,
  }
  if (state.writes.productTypeDial) enriched.productTypeDial = state.writes.productTypeDial
  if (state.writes.moodTags?.length)     enriched.moodTags     = state.writes.moodTags
  if (state.writes.audienceTags?.length) enriched.audienceTags = state.writes.audienceTags
  if (state.writes.mattersTags?.length)  enriched.mattersTags  = state.writes.mattersTags
  return enriched
}

// ─── Tool definitions (sent to the model) ────────────────────────────────────

export const TOOLS = [
  {
    name: 'classifyProductTypeDial',
    description: 'Classify the product into a hierarchical taxonomy — top-level type AND per-parent subtype in one call. Top-level types: vibrator, dildo, anal, bondage, cock-ring, stroker, couples, harness, extender, pump, lube, massage, enhancer, wear, condom, wellness, novelty, book-media, sex-machine. Always call this FIRST so other tools have the right type.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateAskEmmaTagsAll',
    description: 'Generate Title Case Ask Emma tags for ALL THREE axes (mood / audience / matters) in one combined Haiku call. Replaces the three single-axis tools. Always call this. Run BEFORE copy tools so keyword targeting can filter on these tags. Backfill will not invent new vocab; tags are restricted to the curated lists.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateProductTitle',
    description: 'Decide whether to augment the manufacturer title with one SEO descriptor (e.g. "Eclipse 7" → "Eclipse 7 Wand Vibrator"), or leave it alone if it already names the category. Run AFTER classifyProductTypeDial + tag tools so the descriptor matches keyword bank targets. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateProductCopyBundle',
    description: 'Generate the product tagline, SEO meta description, AND "Label: Value" specifications bullets in a SINGLE Haiku call. Replaces the three legacy tools (generateTagline + generateSeoMeta + generateSpecifications) — they shared the same product context and keyword block. Always call this.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateEmmaTake',
    description: "Generate Emma's first-person editorial take (becomes Shopify body_html / Emma's take tab). Catalog-knowledge voice only, never lived-experience claims. Always call this.",
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
  // Phase 1 rebuild — these tools were removed from the import orchestrator's
  // tool list:
  //   - generateEmmaHero (E1/E2): deal-cycle artifact, regenerated per
  //     deal slot rotation. Out of import scope.
  //   - generateMoodImage: image generation is Phase 2+ scope.
  //   - proposePairingWhy (F1/F2): pairings are deal-cycle, curated when
  //     a product enters the homepage deal slot against the freshest
  //     catalog state.
  // The corresponding case branches and underlying generator functions are
  // preserved so the deal-cycle pipeline can call them directly. Import path
  // never schedules them.
  {
    name: 'generateIvrAll',
    description: 'Pick experience levels, use-case slugs, AND feature slugs in a SINGLE Haiku call — replaces the three legacy IVR tools (generateIvrExperience + generateIvrUseCase + generateIvrFeatures). Used by Emma chat/IVR/SMS to match buyer intent and speak features aloud. Always call this AFTER classifyProductTypeDial and generateEmmaTake so context is rich.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'generateProductFaqs',
    description: 'Generate 4–6 FAQ pairs (general / care / usage / compatibility) for the PDP and FAQPage JSON-LD. Always call this AFTER generateEmmaTake — answers benefit from the product story being set. Sanity-only field; no Shopify metafield.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'finish',
    description: 'Call this last — when every applicable tool above has been called. Takes no arguments; orchestrator returns the consolidated writes.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
] as const

// ─── Tool execution ──────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  state: OrchestratorState,
): Promise<{ ok: boolean; summary: string }> {
  const { product } = state.input
  const dealCtx = makeDealContext(state)

  switch (name) {
    case 'classifyProductTypeDial': {
      // Phase 1 D1 — combined type+subtype Haiku classifier. Replaces the
      // legacy 5-bucket inferProductTypeDial. Returns the new top-level
      // ProductTypeDial (19 values) AND the per-parent ProductSubtypeDial
      // in a single call.
      const taxonomy = await inferProductTaxonomy({
        title:       product.title,
        brand:       product.brand,
        description: product.description,
        categories:  product.categories,
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
      })
      state.writes.productTypeDial    = taxonomy.type
      state.writes.productSubtypeDial = taxonomy.subtype
      const summary = taxonomy.subtype
        ? `productTypeDial=${taxonomy.type}/${taxonomy.subtype}`
        : `productTypeDial=${taxonomy.type}`
      return { ok: true, summary }
    }

    case 'generateProductTitle': {
      const dial = state.writes.productTypeDial ?? 'vibrator'
      const titleResult = await generateProductTitle({
        rawTitle:        product.title,
        brand:           product.brand,
        rawDescription:  product.description,
        productTypeDial: dial,
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
      })
      state.writes.productTitle          = titleResult.title
      state.writes.productTitleAugmented = titleResult.augmented
      state.writes.originalTitle         = titleResult.originalTitle
      return {
        ok: true,
        summary: titleResult.augmented
          ? `title augmented: "${titleResult.originalTitle}" → "${titleResult.title}" (${titleResult.reason})`
          : `title preserved: "${titleResult.title}" (${titleResult.reason})`,
      }
    }

    case 'proposePairingWhy': {
      const candidates = state.input.pairingCandidates ?? []
      if (candidates.length === 0) {
        return { ok: true, summary: 'no pairing candidates — skipped' }
      }
      try {
        const dial = state.writes.productTypeDial ?? 'vibrator'
        const result = await generatePairingWhy({
          primary: {
            title:           product.title,
            brand:           product.brand,
            productTypeDial: dial,
            ...(state.writes.tagline ? { tagline: state.writes.tagline } : {}),
            description:     product.description,
          },
          candidates: candidates.map(c => {
            const ci: { productId: string; title: string; brand?: string; productTypeDial?: string; price?: number } = {
              productId: c.productId,
              title:     c.title,
              price:     c.price,
            }
            if (c.brand)           ci.brand           = c.brand
            if (c.productTypeDial) ci.productTypeDial = c.productTypeDial
            return ci
          }),
          ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
        })
        if (result.accessoryProductIds.length > 0) {
          state.writes.accessoryProductIds = result.accessoryProductIds
          state.writes.pairingWhy          = result.pairingWhy
          return { ok: true, summary: `pairings=${result.accessoryProductIds.length}` }
        }
        return { ok: true, summary: 'no pairings strong enough — skipped' }
      } catch (err) {
        return { ok: false, summary: `pairings skipped: ${err instanceof Error ? err.message : 'error'}` }
      }
    }

    case 'generateProductCopyBundle': {
      const bundle = await generateProductCopyBundle({
        product: enrichProduct(state, product),
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
      })
      state.writes.tagline             = bundle.tagline
      state.writes.seoMetaDescription  = bundle.seoMeta
      state.writes.specifications      = bundle.specifications
      return {
        ok: !!bundle.tagline && !!bundle.seoMeta,
        summary: `bundle tagline=${bundle.tagline.length} seoMeta=${bundle.seoMeta.length} specs=${bundle.specifications.length}`,
      }
    }

    case 'generateEmmaTake': {
      const html = await generateEmmaTake({ deal: dealCtx, ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}) })
      state.writes.descriptionHtml = html
      return { ok: !!html, summary: `emmaTake len=${html.length}` }
    }

    case 'generateCareInstructions': {
      try {
        const bullets = await generateCareInstructions({ deal: dealCtx, ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}) })
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
      const taxonomy = state.dialTaxonomy[type] ?? []
      const dial = await generateSensationDialV2({
        deal: { ...dealCtx, productTypeDial: type },
        preferredLabels,
        ...(taxonomy.length > 0 ? { taxonomy } : {}),
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
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
      const r = await generateCopy({ type: 'box_contents', product: enrichProduct(state, product) }, state.input.llmClient)
      const bc = (r.content as string[]) ?? []
      if (bc.length > 0) state.writes.boxContents = bc
      return { ok: true, summary: `boxContents=${bc.length}` }
    }

    case 'generateAskEmmaTagsAll': {
      // Phase 1 D3 — combined-axes call. One Haiku round trip returns all
      // three axes; cheaper than the legacy three single-axis calls. Title
      // Case storage; backfill default disallows AI-proposed new labels.
      const result = await generateAskEmmaTagsAll({
        deal: dealCtx,
        vocabularies: {
          mood:     state.vocab.mood,
          audience: state.vocab.audience,
          matters:  state.vocab.matters,
        },
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
      })
      state.writes.moodTags     = result.moodTags
      state.writes.audienceTags = result.audienceTags
      state.writes.mattersTags  = result.mattersTags
      return {
        ok: true,
        summary: `mood=${result.moodTags.length} audience=${result.audienceTags.length} matters=${result.mattersTags.length}`,
      }
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
        ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}),
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

    case 'generateIvrAll': {
      const ivr = await generateIvrAll({ deal: dealCtx, ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}) })
      state.writes.ivrExperience = ivr.experience
      state.writes.ivrUseCase    = ivr.useCases
      state.writes.ivrFeatures   = ivr.features
      return {
        ok: true,
        summary: `ivr exp=[${ivr.experience.join(',')}] uc=${ivr.useCases.length} feat=${ivr.features.length}`,
      }
    }

    case 'generateProductFaqs': {
      const faqs = await generateProductFaqs({ deal: dealCtx, ...(state.input.llmClient ? { llmClient: state.input.llmClient } : {}) })
      state.writes.productFaqs = faqs
      return { ok: faqs.length > 0, summary: `productFaqs=${faqs.length}` }
    }

    case 'finish': {
      state.finished = true
      return { ok: true, summary: 'orchestrator complete' }
    }

    default:
      return { ok: false, summary: `unknown tool: ${name}` }
  }
}

// ─── Agent SDK orchestration path (--via=claude-code) ────────────────────────

/**
 * Drives the orchestrator via the Agent SDK so the *outer* model decisions
 * (which tool to call, when to finish) bill against the Max subscription
 * instead of the API key. Per-tool content generators inside `executeTool`
 * still hit the Anthropic API directly — routing those would require pushing
 * `generateCopy` etc. through the SDK as well.
 *
 * The SDK manages turns + tool dispatch internally via in-process MCP, so
 * this function exposes each orchestrator tool as an MCP tool whose handler
 * delegates to `executeTool(name, state)`. We just walk the event stream for
 * usage telemetry and stop when `state.finished` flips or the SDK emits a
 * terminal `result` event.
 */
async function runOrchestrationViaSdk(
  state: OrchestratorState,
  userPrompt: string,
): Promise<void> {
  const { query, tool, createSdkMcpServer } = await loadAgentSdk()

  const calledTools = new Set<string>()

  const mcpTools = TOOLS.map(t =>
    tool(
      t.name,
      t.description,
      // Empty Zod raw shape — orchestrator tools take no model-supplied input;
      // they read from `state.input` and write to `state.writes`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      async (_args: unknown, _extra: unknown) => {
        if (calledTools.has(t.name)) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, summary: `${t.name} already called — skipping duplicate` }) }] }
        }
        calledTools.add(t.name)

        const start = Date.now()
        let ok = false
        let summary = ''
        let errorMsg: string | undefined
        // Drain any stale accumulator state before invoking the tool so we only
        // attribute tokens spent inside this tool's executeTool call.
        drainToolTokens()
        try {
          const r = await executeTool(t.name, state)
          ok = r.ok
          summary = r.summary
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err)
          summary = `tool error: ${errorMsg}`
        }
        const toolTokens = drainToolTokens()
        state.telemetry.totalInputTokens         += toolTokens.input
        state.telemetry.totalOutputTokens        += toolTokens.output
        state.telemetry.totalCacheCreationTokens += toolTokens.cacheCreation
        state.telemetry.totalCacheReadTokens     += toolTokens.cacheRead
        state.telemetry.toolCalls.push({
          name:         t.name,
          durationMs:   Date.now() - start,
          inputTokens:  toolTokens.input,
          outputTokens: toolTokens.output,
          ok,
          ...(errorMsg ? { error: errorMsg } : {}),
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok, summary }) }],
          ...(errorMsg ? { isError: true } : {}),
        }
      },
    ),
  )

  const mcpServer = createSdkMcpServer({
    name:    'emma-orchestrator',
    version: '1.0.0',
    tools:   mcpTools,
  })

  // Pre-approve all our MCP tools so the SDK doesn't prompt for permission.
  // SDK convention: `mcp__<servername>__<toolname>`.
  const allowedTools = TOOLS.map(t => `mcp__emma-orchestrator__${t.name}`)

  const stream = query({
    prompt: userPrompt,
    options: {
      systemPrompt: SYSTEM,
      mcpServers:   { 'emma-orchestrator': mcpServer },
      // Disable all built-in Claude Code tools (Bash/Read/Edit/etc.). Only
      // our MCP tools should be available to the model.
      tools:        [],
      allowedTools,
      maxTurns:     MAX_TURNS,
    },
  })

  for await (const event of stream) {
    if (!event || typeof event !== 'object') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any
    if (ev.type === 'assistant' && ev.message?.usage) {
      state.telemetry.totalInputTokens  += Number(ev.message.usage.input_tokens  ?? 0)
      state.telemetry.totalOutputTokens += Number(ev.message.usage.output_tokens ?? 0)
      state.telemetry.turns++
    } else if (ev.type === 'result') {
      // SDK terminates here.
      break
    }
    if (state.finished) break
  }
}

// ─── Shared write assembly (used by sync path + batch runner) ────────────────

/**
 * Assemble a validated ProductWrites from a partial writes accumulator and
 * telemetry. Throws with a clear message when the coverage gates fail so the
 * caller (sync path or batch runner) can surface the error without shipping
 * template strings to Shopify.
 *
 * Extracted from `generateProductContent` so the batch runner (Part C of spec)
 * can reuse the same coverage gates and assembly logic without duplication.
 */
export function assembleWrites(
  partial: Partial<ProductWrites>,
  telemetry: OrchestratorTelemetry,
): ProductWrites {
  if (telemetry.toolCalls.length === 0) {
    throw new Error('orchestrator: 0 tool calls — LLM client returned empty content (check llm-client adapter)')
  }
  if (!partial.tagline?.trim()) {
    throw new Error('orchestrator: tagline tool did not run or returned empty — refusing to ship a fallback')
  }
  return {
    productTypeDial:    partial.productTypeDial    ?? 'vibrator',
    tagline:            partial.tagline,
    seoMetaDescription: partial.seoMetaDescription ?? '',
    descriptionHtml:    partial.descriptionHtml    ?? '',
    moodTags:           partial.moodTags           ?? [],
    audienceTags:       partial.audienceTags       ?? [],
    mattersTags:        partial.mattersTags        ?? [],
    ...(partial.productSubtypeDial !== undefined ? { productSubtypeDial: partial.productSubtypeDial } : {}),
    ...(partial.productTitle    !== undefined ? { productTitle:        partial.productTitle    } : {}),
    ...(partial.productTitleAugmented !== undefined ? { productTitleAugmented: partial.productTitleAugmented } : {}),
    ...(partial.originalTitle   !== undefined ? { originalTitle:       partial.originalTitle   } : {}),
    ...(partial.boxContents     !== undefined ? { boxContents:      partial.boxContents }     : {}),
    ...(partial.specifications  !== undefined ? { specifications:   partial.specifications }  : {}),
    ...(partial.careInstructions!== undefined ? { careInstructions: partial.careInstructions } : {}),
    ...(partial.sensationDialV2 !== undefined ? { sensationDialV2:  partial.sensationDialV2 } : {}),
    ...(partial.emmaHero        !== undefined ? { emmaHero:         partial.emmaHero }        : {}),
    ...(partial.moodImageUrl    !== undefined ? { moodImageUrl:     partial.moodImageUrl }    : {}),
    ...(partial.accessoryProductIds !== undefined ? { accessoryProductIds: partial.accessoryProductIds } : {}),
    ...(partial.pairingWhy      !== undefined ? { pairingWhy:       partial.pairingWhy      } : {}),
    ...(partial.ivrExperience   !== undefined ? { ivrExperience:    partial.ivrExperience   } : {}),
    ...(partial.ivrUseCase      !== undefined ? { ivrUseCase:       partial.ivrUseCase      } : {}),
    ...(partial.ivrFeatures     !== undefined ? { ivrFeatures:      partial.ivrFeatures     } : {}),
    ...(partial.productFaqs     !== undefined ? { productFaqs:      partial.productFaqs     } : {}),
  }
}

// ─── Public entry point ──────────────────────────────────────────────────────

export const SYSTEM = `You are Emma's content brain for xdipx.com — an editorially-curated sexual-wellness storefront. Given one product, you decide which content generators to run to fully populate its PDP and Emma's voice surfaces (chat / IVR / SMS), then call them via tools.

Required for every product (run in this exact phase order):

Phase 1 — classify (must complete BEFORE anything else):
  1. classifyProductTypeDial

Phase 2 — tag the product (must complete BEFORE copy generators so the SEO keyword bank can filter approved terms by these tags — without this, copy is generic):
  2. generateAskEmmaTagsAll  (single Haiku call, all three axes — mood / audience / matters)

Phase 3 — title decision (uses dial + tags to pick a descriptor when needed):
  3. generateProductTitle

Phase 4 — copy generators (these benefit from keyword targeting via the tags above):
  4. generateProductCopyBundle  (single Haiku call: tagline + seoMeta + specifications together)
  5. generateEmmaTake

Phase 5 — dial + hero + image (independent, run after copy is set):
  6. generateSensationDialV2 (must be AFTER classifyProductTypeDial)
  7. generateEmmaHero
  8. generateMoodImage

Phase 6 — pairings (run AFTER copy bundle + emmaTake exist so the pairing-why blurbs have richer context):
  9. proposePairingWhy (SKIP if no pairing candidates were provided)

Phase 7 — IVR / voice surfaces (run AFTER generateEmmaTake — they need rich context):
  10. generateIvrAll  (single Haiku call: experience + useCases + features together)

Phase 8 — PDP FAQs (run LAST — must be AFTER generateEmmaTake AND generateCareInstructions so the differentiation context is populated; H1 answers must NOT restate descriptionHtml or careInstructions):
  11. generateProductFaqs

Conditional:
- generateCareInstructions: call for every product type. The underlying generator branches on productTypeDial — hardware gets 3–5 maintenance bullets, consumables (lube, edible wear) get 2–3 playful storage/usage bullets.
- generateBoxContents: skip for lube; usually skip for wear.

When every applicable tool above has been called, call \`finish\` with no arguments. Do NOT re-emit content — the orchestrator already has it.

Be efficient. Each tool is a single call. Do NOT call the same tool twice.`

/**
 * Build the initial user message for the orchestrator. Extracted so the batch
 * runner can seed freshRunnerState with the same prompt without duplicating the
 * template. Pure function -- no side effects.
 */
export function buildUserPrompt(input: OrchestratorInput): string {
  return `Generate the full PDP content for this product:

Title: ${input.product.title}
Brand: ${input.product.brand}
Categories: ${input.product.categories.join(', ') || '(none)'}
Description (truncated): ${input.product.description.slice(0, 800)}

SEO title (already set, for context): ${input.seoTitle}
Pricing context (do not echo): deal $${input.product.dealPrice} / msrp $${input.product.msrp}

Start with classifyProductTypeDial, then run every other applicable tool exactly once, then call finish.`
}

export async function generateProductContent(input: OrchestratorInput): Promise<OrchestratorResult> {
  const t0 = Date.now()
  const [dialRegistry, dialTaxonomy, vocab] = await Promise.all([
    getDialRegistry(),
    getDialTaxonomy(),
    getAskEmmaVocabulary(),
  ])

  const state: OrchestratorState = {
    input,
    dialRegistry,
    dialTaxonomy,
    vocab,
    writes: {},
    telemetry: {
      totalInputTokens:  0,
      totalOutputTokens: 0,
      totalTokens:       0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens:     0,
      durationMs:        0,
      turns:             0,
      toolCalls:         [],
    },
    finished: false,
  }

  const userPrompt = buildUserPrompt(input)

  const llm: LLMClient = input.llmClient ?? getDefaultClient()

  if (llm.via === 'claude-code') {
    // SDK manages turns + tool dispatch internally; we just expose tools as MCP
    // and walk the stream for telemetry. See runOrchestrationViaSdk.
    await runOrchestrationViaSdk(state, userPrompt)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content: userPrompt }]

    const calledTools = new Set<string>()

    while (state.telemetry.turns < MAX_TURNS && !state.finished) {
      state.telemetry.turns++

      const response = await llm.create({
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
          drainToolTokens()
          try {
            const r = await executeTool(tu.name, state)
            ok = r.ok
            summary = r.summary
          } catch (err) {
            errorMsg = err instanceof Error ? err.message : String(err)
            summary = `tool error: ${errorMsg}`
          }
          const toolTokens = drainToolTokens()
          state.telemetry.totalInputTokens         += toolTokens.input
          state.telemetry.totalOutputTokens        += toolTokens.output
          state.telemetry.totalCacheCreationTokens += toolTokens.cacheCreation
          state.telemetry.totalCacheReadTokens     += toolTokens.cacheRead
          state.telemetry.toolCalls.push({
            name:         tu.name,
            durationMs:   Date.now() - start,
            inputTokens:  toolTokens.input,
            outputTokens: toolTokens.output,
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
  }

  state.telemetry.totalTokens = state.telemetry.totalInputTokens + state.telemetry.totalOutputTokens
  state.telemetry.durationMs  = Date.now() - t0

  const writes = assembleWrites(state.writes, state.telemetry)

  return { writes, telemetry: state.telemetry }
}
