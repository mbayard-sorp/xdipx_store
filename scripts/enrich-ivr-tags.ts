/**
 * Enrich Sanity productPage documents with IVR discovery tags using Haiku.
 *
 * Uses a curated descriptor CSV (ivr_descriptors.csv) as ground truth for
 * feature extraction and context, supplemented by Shopify's original
 * manufacturer description. Haiku classifies mood, experience, useCase,
 * and generates a TTS-safe voiceSummary.
 *
 * Run:   npx tsx scripts/enrich-ivr-tags.ts
 * Force: npx tsx scripts/enrich-ivr-tags.ts --force   (re-classify all)
 *
 * Cost: ~$0.05 per 100 products on Haiku.
 */
import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@sanity/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHOPIFY_STORE = process.env['SHOPIFY_STORE_DOMAIN'] ?? process.env['PUBLIC_STORE_DOMAIN']
const SHOPIFY_TOKEN = process.env['SHOPIFY_STOREFRONT_ACCESS_TOKEN'] ?? process.env['SHOPIFY_STOREFRONT_API_TOKEN'] ?? process.env['PUBLIC_STOREFRONT_API_TOKEN']

const force = process.argv.includes('--force')

const sanity = createClient({
  projectId: process.env['SANITY_PROJECT_ID']!,
  dataset: process.env['SANITY_DATASET'] ?? 'production',
  apiVersion: '2024-10-01',
  token: process.env['SANITY_API_TOKEN']!,
  useCdn: false,
})

const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! })

const VALID_MOODS = ['playful', 'romantic', 'luxurious', 'adventurous', 'relaxing'] as const
const VALID_EXPERIENCE = ['beginner', 'intermediate', 'advanced'] as const
const VALID_USE_CASE = ['solo', 'couples', 'date-night', 'gift', 'travel'] as const
const VALID_FEATURES = ['waterproof', 'quiet', 'rechargeable', 'app-controlled', 'body-safe'] as const

const BRAND_VOICE = `You are the voice of xdipx.com — a daily flash-sale site for sexual wellness products.
Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy.
Write as a trusted, funny friend who isn't embarrassed about the topic.
Keep all copy tasteful — suggestive is fine, explicit is not.
Never use "sex" as an adjective — use "intimate", "pleasure", or "wellness".
Never assume the reader's experience level.`

// ─── Descriptor CSV — deterministic feature extraction ─────────────────────

const FEATURE_MAP: Record<string, typeof VALID_FEATURES[number]> = {
  'waterproof': 'waterproof',
  'submersible': 'waterproof',
  'quiet': 'quiet',
  'rechargeable': 'rechargeable',
  'app controlled': 'app-controlled',
  'remote control': 'app-controlled',
  'body safe silicone': 'body-safe',
  'body-safe': 'body-safe',
  'body safe': 'body-safe',
  'silicone': 'body-safe',
}

function loadDescriptorMap(): Map<string, string[]> {
  const csvPath = resolve(import.meta.dirname ?? '.', '..', 'ivr_descriptors.csv')
  try {
    const raw = readFileSync(csvPath, 'utf-8')
    const map = new Map<string, string[]>()
    const lines = raw.split('\n').slice(1)
    for (const line of lines) {
      if (!line.trim()) continue
      const firstComma = line.indexOf(',')
      const handle = line.slice(0, firstComma)
      const rest = line.slice(firstComma + 1)
      const lastQuoteStart = rest.lastIndexOf('"')
      const firstQuote = rest.indexOf('"')
      if (firstQuote === -1) continue
      const descriptors = rest.slice(firstQuote + 1, lastQuoteStart === firstQuote ? undefined : lastQuoteStart)
      map.set(handle, descriptors.split(',').map(d => d.trim()).filter(Boolean))
    }
    console.log(`Loaded ${map.size} product descriptors from CSV`)
    return map
  } catch {
    console.log('No ivr_descriptors.csv found — running without descriptor hints')
    return new Map()
  }
}

function extractFeaturesFromDescriptors(descriptors: string[]): string[] {
  const features = new Set<string>()
  for (const d of descriptors) {
    const lower = d.toLowerCase()
    for (const [keyword, feature] of Object.entries(FEATURE_MAP)) {
      if (lower.includes(keyword)) features.add(feature)
    }
  }
  return [...features]
}

function inferExperienceHint(descriptors: string[]): string | null {
  const joined = descriptors.join(', ').toLowerCase()
  if (joined.includes('first time') || joined.includes('beginner') || joined.includes('starter')) return 'beginner'
  if (joined.includes('advanced') || joined.includes('extreme')) return 'advanced'
  return null
}

function inferUseCaseHints(descriptors: string[]): string[] {
  const hints: string[] = []
  const joined = descriptors.join(', ').toLowerCase()
  if (joined.includes('for couples') || joined.includes('couples vibrator') || joined.includes('couples and wearable')) hints.push('couples')
  if (joined.includes('gift set') || joined.includes('gift box')) hints.push('gift')
  if (joined.includes('travel') || joined.includes('compact') || joined.includes('mini')) hints.push('travel')
  return hints
}

interface ClassificationResult {
  mood: string[]
  experience: string
  useCase: string[]
  features: string[]
  voiceSummary: string
}

// ─── Shopify Storefront API — fetch original_description ────────────────────

async function fetchOriginalDescription(handle: string): Promise<string | null> {
  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) return null

  try {
    const res = await fetch(`https://${SHOPIFY_STORE}/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': SHOPIFY_TOKEN,
      },
      body: JSON.stringify({
        query: `query ($handle: String!) {
          product(handle: $handle) {
            metafield(namespace: "custom", key: "original_description") { value }
          }
        }`,
        variables: { handle },
      }),
    })

    if (!res.ok) return null
    const json = await res.json() as { data?: { product?: { metafield?: { value?: string } } } }
    return json.data?.product?.metafield?.value ?? null
  } catch {
    return null
  }
}

// ─── Classification via Haiku ───────────────────────────────────────────────

async function classifyProduct(product: {
  title: string
  tagline?: string
  originalDescription?: string
  sanityDescription?: string
  featureBullets?: string[]
  category?: string
  vendor?: string
  descriptors?: string[]
}): Promise<ClassificationResult> {
  const csvFeatures = product.descriptors ? extractFeaturesFromDescriptors(product.descriptors) : []
  const csvExperience = product.descriptors ? inferExperienceHint(product.descriptors) : null
  const csvUseCases = product.descriptors ? inferUseCaseHints(product.descriptors) : []

  const context = [
    `Title: ${product.title}`,
    product.vendor && `Brand: ${product.vendor}`,
    product.tagline && `Tagline: ${product.tagline}`,
    product.category && `Category: ${product.category}`,
    product.descriptors?.length && `Product Tags: ${product.descriptors.join(', ')}`,
    product.originalDescription && `Manufacturer Description: ${product.originalDescription}`,
    !product.originalDescription && product.sanityDescription && `Description: ${product.sanityDescription}`,
    product.featureBullets?.length && `Feature Bullets: ${product.featureBullets.join(', ')}`,
  ].filter(Boolean).join('\n')

  const presetHints = [
    csvFeatures.length && `Pre-confirmed features: [${csvFeatures.join(', ')}] — include these in your features array.`,
    csvExperience && `Experience hint: ${csvExperience}`,
    csvUseCases.length && `Use-case hints: [${csvUseCases.join(', ')}] — include these plus any others that fit.`,
  ].filter(Boolean).join('\n')

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: BRAND_VOICE,
    messages: [{
      role: 'user',
      content: `Classify this product for our phone-based shopping assistant. Use the product tags and manufacturer description as your source of truth. Return ONLY valid JSON, no other text.

${context}

${presetHints ? `\n${presetHints}\n` : ''}
Return JSON with these fields:
- "mood": array from [${VALID_MOODS.join(', ')}] — pick 1–3 that genuinely fit the product's vibe
- "experience": one of [${VALID_EXPERIENCE.join(', ')}] — who would love this most?
- "useCase": array from [${VALID_USE_CASE.join(', ')}] — pick 1–3 scenarios this product shines in
- "features": array from [${VALID_FEATURES.join(', ')}] — include any pre-confirmed features above, plus others explicitly stated in the description or tags
- "voiceSummary": one sentence under 120 chars in our brand voice (playful, warm, never clinical). No markdown, no URLs, no special symbols. This will be read aloud by a TTS voice on a phone call.`,
    }],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in response: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(jsonMatch[0])

  const aiFeatures = (parsed.features ?? []).filter((f: string) => (VALID_FEATURES as readonly string[]).includes(f))
  const mergedFeatures = [...new Set([...csvFeatures, ...aiFeatures])]

  const aiUseCases = (parsed.useCase ?? []).filter((u: string) => (VALID_USE_CASE as readonly string[]).includes(u))
  const mergedUseCases = [...new Set([...csvUseCases, ...aiUseCases])]

  return {
    mood: (parsed.mood ?? []).filter((m: string) => (VALID_MOODS as readonly string[]).includes(m)),
    experience: (VALID_EXPERIENCE as readonly string[]).includes(parsed.experience)
      ? parsed.experience
      : (csvExperience ?? 'beginner'),
    useCase: mergedUseCases,
    features: mergedFeatures,
    voiceSummary: String(parsed.voiceSummary ?? '').slice(0, 120),
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const descriptorMap = loadDescriptorMap()

  const needsEnrichment = force
    ? '!defined(archived) || archived != true'
    : '(!defined(ivrMood) || count(ivrMood) == 0) && (!defined(archived) || archived != true)'

  const products = await sanity.fetch<{
    _id: string
    title: string
    tagline?: string
    vendor?: string
    category?: string
    featureBullets?: string[]
    sanityDescription?: string
    shopifyHandle: string
  }[]>(
    `*[_type == "productPage" && defined(shopifyHandle) && (${needsEnrichment})] {
      _id, title, tagline, vendor, category, featureBullets, shopifyHandle,
      "sanityDescription": pt::text(description)
    }`,
  )

  console.log(`Found ${products.length} products to enrich${force ? ' (force mode)' : ''}`)
  const csvMatches = products.filter(p => descriptorMap.has(p.shopifyHandle)).length
  console.log(`CSV descriptor matches: ${csvMatches}/${products.length}`)
  if (SHOPIFY_STORE && SHOPIFY_TOKEN) {
    console.log(`Shopify API configured — will fetch custom.original_description per product`)
  } else {
    console.log(`⚠ Shopify API not configured — falling back to Sanity description only`)
  }

  let enriched = 0
  let errors = 0

  for (const product of products) {
    try {
      const originalDescription = await fetchOriginalDescription(product.shopifyHandle)
      const descriptors = descriptorMap.get(product.shopifyHandle)

      const result = await classifyProduct({
        title: product.title,
        tagline: product.tagline,
        originalDescription: originalDescription ?? undefined,
        sanityDescription: product.sanityDescription,
        featureBullets: product.featureBullets,
        category: product.category,
        vendor: product.vendor,
        descriptors,
      })

      await sanity.patch(product._id).set({
        ivrMood: result.mood,
        ivrExperience: result.experience,
        ivrUseCase: result.useCase,
        ivrFeatures: result.features,
        ivrVoiceSummary: result.voiceSummary,
      }).commit()

      enriched++
      const src = [
        descriptors ? 'csv' : null,
        originalDescription ? 'shopify' : 'sanity',
      ].filter(Boolean).join('+')
      console.log(`  ✓ ${product.shopifyHandle} (${src}): mood=[${result.mood}] exp=${result.experience} use=[${result.useCase}] feat=[${result.features}]`)
      console.log(`    voice: "${result.voiceSummary}"`)
    } catch (err) {
      errors++
      console.error(`  ✗ ${product.shopifyHandle}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\nDone: ${enriched} enriched, ${errors} errors, ${products.length - enriched - errors} skipped`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
