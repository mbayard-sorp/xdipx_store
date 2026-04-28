/**
 * POST /api/import-product
 *
 * Phase 1 forward-pipeline entry. Called by the product-management agent (or
 * any non-CSV, non-admin caller) to import a single product end-to-end:
 * Shopify draft + orchestrator enrichment + metafield push + dealHistory row
 * + Sanity productPage upsert.
 *
 * Authentication: x-import-secret header must match IMPORT_PRODUCT_SECRET
 * env var. The secret is shared out-of-band with the agent. Returns 401 on
 * missing/mismatched header. We deliberately do NOT use the admin cookie
 * session here — this endpoint is machine-to-machine.
 *
 * Request body (JSON): ImportNewProductInput shape from
 * app/lib/bulk-import.server.ts.
 *
 * Response: ImportNewProductResult JSON, or { error } on failure.
 */
import type { ActionFunctionArgs } from 'react-router'
import { importNewProduct } from '~/lib/bulk-import.server'
import type { ImportNewProductInput } from '~/lib/bulk-import.server'

const ALLOWED_SOURCES = ['manual', 'agent', 'nalpac'] as const
type AllowedSource = typeof ALLOWED_SOURCES[number]

function isAllowedSource(s: unknown): s is AllowedSource {
  return typeof s === 'string' && (ALLOWED_SOURCES as readonly string[]).includes(s)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // Auth — shared-secret header. Constant-time compare to avoid timing
  // disclosure when SECRET length differs from supplied header length.
  const expectedSecret = process.env['IMPORT_PRODUCT_SECRET'] ?? ''
  if (!expectedSecret) {
    console.error('[api.import-product] IMPORT_PRODUCT_SECRET not configured — refusing all requests')
    return jsonResponse({ error: 'Server not configured' }, 500)
  }
  const suppliedSecret = request.headers.get('x-import-secret') ?? ''
  if (!constantTimeEqual(expectedSecret, suppliedSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  // Shape-check the agent's input. We're strict at the boundary so the
  // downstream importNewProduct() never has to defend against malformed
  // input mid-pipeline.
  const validation = validateInput(body)
  if ('error' in validation) {
    return jsonResponse({ error: validation.error }, 400)
  }

  try {
    const result = await importNewProduct(validation.input)
    return jsonResponse(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[api.import-product] importNewProduct threw:', message)
    return jsonResponse({ error: message }, 500)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function validateInput(raw: unknown): { input: ImportNewProductInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object' }
  const r = raw as Record<string, unknown>

  if (!isAllowedSource(r['source'])) {
    return { error: `Invalid "source": must be one of ${ALLOWED_SOURCES.join('|')}` }
  }
  const handle = typeof r['handle'] === 'string' ? r['handle'].trim() : ''
  if (!handle || handle.length > 200) {
    return { error: 'Invalid "handle": required string, ≤200 chars' }
  }
  if (!/^[a-z0-9-]+$/.test(handle)) {
    return { error: 'Invalid "handle": must be lowercase alphanumeric + hyphens only (Shopify-compatible)' }
  }

  const rp = r['rawProduct']
  if (!rp || typeof rp !== 'object') return { error: 'Missing "rawProduct" object' }
  const p = rp as Record<string, unknown>

  const sku           = strField(p['sku'])
  const title         = strField(p['title'])
  const brand         = strField(p['brand'])
  const description   = strField(p['description'])
  if (!sku || !title || !brand || !description) {
    return { error: 'rawProduct requires non-empty sku, title, brand, description' }
  }

  const categories = Array.isArray(p['categories'])
    ? (p['categories'] as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : []
  const dealPrice     = numField(p['dealPrice'])
  const msrp          = numField(p['msrp'])
  const wholesaleCost = numField(p['wholesaleCost'])
  if (dealPrice === null || msrp === null || wholesaleCost === null) {
    return { error: 'rawProduct requires numeric dealPrice, msrp, wholesaleCost' }
  }

  const rawDescription = optStrField(p['rawDescription'])
  const mapPrice       = optNumField(p['mapPrice'])
  const qty            = optNumField(p['qty'])
  const images = Array.isArray(p['images'])
    ? (p['images'] as unknown[]).filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
    : undefined

  const voiceProfile = (() => {
    const vp = r['voiceProfile']
    if (!vp || typeof vp !== 'object') return undefined
    const v = vp as Record<string, unknown>
    return {
      ...(typeof v['hash']       === 'string' ? { hash:       v['hash']       } : {}),
      ...(typeof v['brandVoice'] === 'string' ? { brandVoice: v['brandVoice'] } : {}),
    }
  })()

  return {
    input: {
      source: r['source'],
      handle,
      rawProduct: {
        sku, title, brand, description, categories,
        dealPrice, msrp, wholesaleCost,
        ...(rawDescription !== undefined ? { rawDescription } : {}),
        ...(mapPrice       !== null      ? { mapPrice       } : {}),
        ...(qty            !== null      ? { qty            } : {}),
        ...(images         !== undefined ? { images         } : {}),
      },
      ...(voiceProfile ? { voiceProfile } : {}),
    },
  }
}

function strField(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}
function optStrField(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}
function numField(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}
function optNumField(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}
