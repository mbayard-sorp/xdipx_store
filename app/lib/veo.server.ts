/**
 * Google Veo video generation via @google/genai SDK.
 * Models: veo-3-generate-preview (stable, audio, 1080p max)
 *         veo-3.1-generate-preview (preview, audio, 4K, reference images)
 *
 * Auth: reuses the same Vertex AI service account / ADC pattern as imagen.server.ts.
 */

import {
  GoogleGenAI,
  GenerateVideosOperation,
  VideoGenerationReferenceType,
  type GenerateVideosConfig,
  type GenerateVideosParameters,
  type Image,
} from '@google/genai'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// ─── Auth (mirrors imagen.server.ts buildClient) ────────────────────────────

function buildClient(): GoogleGenAI {
  const project  = process.env['GOOGLE_CLOUD_PROJECT_ID'] ?? ''
  const location = process.env['GOOGLE_CLOUD_LOCATION'] ?? 'us-central1'

  const raw = process.env['GOOGLE_SERVICE_ACCOUNT_JSON']
  if (raw) {
    const key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
      client_email: string
      private_key: string
    }
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
      googleAuthOptions: {
        credentials: {
          client_email: key.client_email,
          private_key:  key.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      },
    })
  }

  return new GoogleGenAI({ vertexai: true, project, location })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type VeoModel = 'veo-3.0-generate-001' | 'veo-3.1-generate-001' | 'veo-3.1-fast-generate-001'

export type ImageMode = 'start_frame' | 'reference'

export interface VeoGenerateOptions {
  prompt: string
  aspectRatio: '16:9' | '9:16'
  durationSeconds: 4 | 6 | 8
  personGeneration: 'allow_all' | 'allow_adult'
  resolution?: '720p' | '1080p' | '4k'
  numberOfVideos: 1 | 2
  startingImage?: Buffer
  imageMode?: ImageMode
  model?: VeoModel
}

/** Serializable operation state stored in KV between polling requests. */
export interface VeoOperationState {
  /** The operation name/ID returned by the API for polling. */
  operationName: string
  done: boolean
}

export interface VeoResult {
  videoBuffers: Buffer[]
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateVeoOptions(opts: VeoGenerateOptions): string | null {
  if (opts.resolution === '1080p' || opts.resolution === '4k') {
    if (opts.durationSeconds !== 8) {
      return `${opts.resolution} resolution requires 8s duration`
    }
  }
  if (opts.startingImage && opts.imageMode !== 'reference' && opts.personGeneration !== 'allow_adult') {
    return 'Image-to-video (start frame) requires personGeneration set to "allow_adult"'
  }
  if (opts.numberOfVideos < 1 || opts.numberOfVideos > 2) {
    return 'numberOfVideos must be 1 or 2'
  }
  return null
}

// ─── Select model based on options ──────────────────────────────────────────

function selectModel(opts: VeoGenerateOptions): VeoModel {
  if (opts.model) return opts.model
  // Use 3.1 GA for 4K/1080p resolution or image-to-video (3.0 doesn't support starting images)
  if (opts.resolution === '4k' || opts.resolution === '1080p' || opts.startingImage) {
    return 'veo-3.1-generate-001'
  }
  return 'veo-3.0-generate-001'
}

// ─── Start generation ───────────────────────────────────────────────────────

export async function startVeoGeneration(opts: VeoGenerateOptions): Promise<VeoOperationState> {
  const project = process.env['GOOGLE_CLOUD_PROJECT_ID']
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT_ID not set')

  const validationError = validateVeoOptions(opts)
  if (validationError) throw new Error(validationError)

  const ai    = buildClient()
  const model = selectModel(opts)

  const config: GenerateVideosConfig = {
    aspectRatio:      opts.aspectRatio,
    personGeneration: opts.personGeneration,
    numberOfVideos:   opts.numberOfVideos,
    durationSeconds:  opts.durationSeconds,
    generateAudio:    true,
  }

  // Only veo-3.1 supports the resolution parameter
  if (model.startsWith('veo-3.1') && opts.resolution) {
    config.resolution = opts.resolution
  }

  const params: GenerateVideosParameters = {
    model,
    prompt: opts.prompt,
    config,
  }

  // Attach image: either as starting frame or as reference
  if (opts.startingImage) {
    const image: Image = {
      imageBytes: opts.startingImage.toString('base64'),
      mimeType: 'image/jpeg',
    }

    if (opts.imageMode === 'reference') {
      // Reference image: included as visual context, NOT the first frame
      config.referenceImages = [{
        image,
        referenceType: VideoGenerationReferenceType.ASSET,
      }]
    } else {
      // Start frame: image-to-video, the image IS the first frame
      params.image = image
    }
  }

  console.log(`[veo] Starting generation: model=${model}, aspect=${opts.aspectRatio}, duration=${opts.durationSeconds}s, resolution=${opts.resolution ?? 'default'}, videos=${opts.numberOfVideos}, hasImage=${!!opts.startingImage}${opts.startingImage ? ` (${opts.startingImage.length} bytes)` : ''}`)

  const operation = await ai.models.generateVideos(params)

  const opName = operation.name
  if (!opName) throw new Error('Veo API returned no operation name')

  return {
    operationName: opName,
    done: operation.done ?? false,
  }
}

// ─── Poll operation ─────────────────────────────────────────────────────────

export async function pollVeoOperation(state: VeoOperationState): Promise<VeoOperationState> {
  const ai = buildClient()

  // Reconstruct a real GenerateVideosOperation instance (SDK calls _fromAPIResponse on it)
  const opHandle = new GenerateVideosOperation()
  opHandle.name = state.operationName

  const operation = await ai.operations.getVideosOperation({ operation: opHandle })

  console.log(`[veo] Poll result: done=${operation.done}, hasResponse=${!!operation.response}, error=${JSON.stringify(operation.error ?? null)}`)

  return {
    operationName: state.operationName,
    done: operation.done ?? false,
  }
}

// ─── Download completed videos ──────────────────────────────────────────────

export async function downloadVeoResults(state: VeoOperationState): Promise<VeoResult> {
  const ai = buildClient()

  // Re-fetch the completed operation to get the video references
  const opHandle = new GenerateVideosOperation()
  opHandle.name = state.operationName
  const operation = await ai.operations.getVideosOperation({ operation: opHandle })

  if (!operation.done) {
    throw new Error('Cannot download results: operation not complete')
  }

  // Debug: log the full operation to diagnose empty responses
  console.log('[veo] Operation response:', JSON.stringify({
    done: operation.done,
    name: operation.name,
    hasResponse: !!operation.response,
    generatedVideos: operation.response?.generatedVideos?.length ?? 0,
    raiFilteredReasons: operation.response?.raiMediaFilteredReasons,
    error: operation.error,
  }))

  // Check for RAI filtering
  if (operation.response?.raiMediaFilteredReasons) {
    throw new Error(`Video blocked by safety filter: ${operation.response.raiMediaFilteredReasons.join(', ')}`)
  }

  const generatedVideos = operation.response?.generatedVideos
  if (!generatedVideos || generatedVideos.length === 0) {
    throw new Error('Veo returned no generated videos (response may have been filtered)')
  }

  const buffers: Buffer[] = []
  for (let i = 0; i < generatedVideos.length; i++) {
    const gv = generatedVideos[i]!
    if (!gv.video) {
      console.warn('[veo] Skipping video with no video reference')
      continue
    }

    // SDK download writes to disk — use a temp path
    const tmpPath = join('/tmp', `veo_dl_${randomBytes(8).toString('hex')}_${i}.mp4`)
    try {
      await ai.files.download({ file: gv, downloadPath: tmpPath })
      buffers.push(readFileSync(tmpPath))
    } finally {
      try { unlinkSync(tmpPath) } catch { /* ok */ }
    }
  }

  if (buffers.length === 0) {
    throw new Error('Failed to download any videos from Veo')
  }

  console.log(`[veo] Downloaded ${buffers.length} video(s)`)
  return { videoBuffers: buffers }
}
