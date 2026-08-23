/**
 * POST /api/admin/social-upload: owner uploads into the social image library
 * (Social Studio v2 Phase 2, #4937).
 *
 * Multipart form, one or more `file` entries (jpeg / png / webp, 12MB each),
 * optional `productHandle`, `shopifyProductId`, `tags` (comma list),
 * `castSlugs` (comma list). Each file is rehosted to Shopify Files with the
 * same helper the generators use, then ingested with source 'upload' and
 * createdBy 'owner'. The filename carries the `social-` prefix so an upload
 * also passes the legacy provenance prefix check during the burn-in.
 *
 * Passing provenance is not passing review (ADR-013 decision 5): an owner
 * upload still owes the full imagery judgment when it reaches the gate.
 */

import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import { uploadMoodImageToShopifyFiles } from '~/lib/shopify.server'
import { ingestSocialAsset } from '~/lib/social-asset-library.server'

const MAX_BYTES = 12 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function text(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim() : ''
}

function list(v: FormDataEntryValue | null): string[] {
  return text(v).split(',').map(x => x.trim()).filter(Boolean)
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 })
  }

  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) {
    return Response.json({ ok: false, error: 'No file provided' }, { status: 400 })
  }

  const productHandle = text(form.get('productHandle'))
  const shopifyProductId = text(form.get('shopifyProductId'))
  const tags = list(form.get('tags'))
  const castSlugs = list(form.get('castSlugs'))

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const base = slug(productHandle || files[0]!.name.replace(/\.[^.]+$/, '')) || 'upload'

  const assets: { id: number; url: string; filename: string; width: number | null; height: number | null }[] = []
  const errors: string[] = []

  for (const [i, file] of files.entries()) {
    const ext = EXT_BY_TYPE[file.type]
    if (!ext) {
      errors.push(`${file.name}: unsupported type ${file.type || 'unknown'} (jpeg, png, webp only)`)
      continue
    }
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: over the 12MB limit`)
      continue
    }
    const filename = `social-upload-${date}-${base}-${i + 1}.${ext}`
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const url = await uploadMoodImageToShopifyFiles(buffer, filename)
      const row = await ingestSocialAsset({
        buffer,
        filename,
        contentType: file.type,
        url,
        bytes: file.size,
        source: 'upload',
        createdBy: 'owner',
        ...(productHandle ? { productHandle } : {}),
        ...(shopifyProductId ? { shopifyProductId } : {}),
        ...(tags.length ? { tags } : {}),
        ...(castSlugs.length ? { castSlugs } : {}),
      })
      assets.push({ id: row.id, url: row.url, filename, width: row.width, height: row.height })
    } catch (err) {
      console.error('[social-upload] file failed', { index: i, filename, err })
      const isProd = process.env['NODE_ENV'] === 'production'
      errors.push(`${file.name}: ${isProd ? 'upload failed' : err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (assets.length === 0) {
    return Response.json({ ok: false, error: errors.join('; ') || 'Upload failed' }, { status: 400 })
  }
  return Response.json({ ok: true, assets, ...(errors.length ? { errors } : {}) })
}
