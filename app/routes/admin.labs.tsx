/**
 * admin.labs.tsx
 *
 * Admin Labs — Google Veo video generation for products.
 * Search for a product, configure Veo parameters, generate AI video,
 * preview results, and upload to Shopify.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState, useEffect, useRef, useCallback } from 'react'
import { requireAdmin } from '~/lib/session.server'
import { getProductAdminImages, type AdminProductImage } from '~/lib/shopify.server'

export const meta: MetaFunction = () => [{ title: 'Labs — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  return { ok: true }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form   = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'fetch-images') {
    const productGid = form.get('productId') as string
    if (!productGid) return { images: [], error: 'Missing productId' }

    // Extract numeric ID from GID (gid://shopify/Product/12345 → 12345)
    const numericId = productGid.replace(/.*\//, '')
    try {
      const images = await getProductAdminImages(numericId)
      return { images }
    } catch (err) {
      return { images: [], error: err instanceof Error ? err.message : 'Failed to fetch images' }
    }
  }

  return null
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SearchProduct {
  id: string
  title: string
  handle: string
  image: string | null
  price: number
  compareAtPrice: number | null
}

type GenerationStatus = 'idle' | 'enhancing' | 'generating' | 'complete' | 'error'

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminLabsPage() {
  useLoaderData<typeof loader>()

  // Product search
  const [query, setQuery]                 = useState('')
  const [results, setResults]             = useState<SearchProduct[]>([])
  const [showDropdown, setShowDropdown]   = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<SearchProduct | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Product images
  const imageFetcher = useFetcher<typeof action>()
  const images = (imageFetcher.data && 'images' in imageFetcher.data ? imageFetcher.data.images : []) as AdminProductImage[]

  // Veo config
  const [prompt, setPrompt]                     = useState('')
  const [aspectRatio, setAspectRatio]           = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDuration]                 = useState<4 | 6 | 8>(8)
  const [resolution, setResolution]             = useState<'720p' | '1080p' | '4k'>('720p')
  const [personGeneration, setPersonGeneration] = useState<'allow_all' | 'allow_adult'>('allow_adult')
  const [numberOfVideos, setNumberOfVideos]     = useState<1 | 2>(1)
  const [startingImageUrl, setStartingImageUrl] = useState<string | null>(null)
  const [imageMode, setImageMode]               = useState<'start_frame' | 'reference'>('reference')

  // Generation state
  const [genStatus, setGenStatus]           = useState<GenerationStatus>('idle')
  const [genToken, setGenToken]             = useState<string | null>(null)
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null)
  const [videoUrls, setVideoUrls]           = useState<string[]>([])
  const [genError, setGenError]             = useState<string | null>(null)
  const [elapsed, setElapsed]               = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef(0)

  // Upload state per video
  const [uploadStatus, setUploadStatus] = useState<Record<number, 'idle' | 'uploading' | 'done' | 'error'>>({})
  const [uploadError, setUploadError]   = useState<Record<number, string>>({})

  // Section collapse state
  const [veoOpen, setVeoOpen] = useState(true)
  const [ltxOpen, setLtxOpen] = useState(false)

  // LTX config
  const [ltxPrompt, setLtxPrompt]           = useState('')
  const [ltxDuration, setLtxDuration]       = useState(8)
  const [ltxResolution, setLtxResolution]   = useState<'480p' | '720p' | '1080p'>('720p')
  const [ltxFps, setLtxFps]                 = useState<24 | 25 | 48 | 50>(24)
  const [ltxAspectRatio, setLtxAspectRatio]   = useState<'16:9' | '9:16'>('16:9')
  const [ltxCameraMotion, setLtxCameraMotion] = useState<string>('')

  // LTX generation state
  const [ltxGenStatus, setLtxGenStatus]           = useState<GenerationStatus>('idle')
  const [ltxGenToken, setLtxGenToken]             = useState<string | null>(null)
  const [ltxEnhancedPrompt, setLtxEnhancedPrompt] = useState<string | null>(null)
  const [ltxVideoUrl, setLtxVideoUrl]             = useState<string | null>(null)
  const [ltxGenError, setLtxGenError]             = useState<string | null>(null)
  const [ltxElapsed, setLtxElapsed]               = useState(0)
  const ltxTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // LTX upload state
  const [ltxUploadStatus, setLtxUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [ltxUploadError, setLtxUploadError]   = useState<string | null>(null)

  // LTX prompt enhancement state
  const [ltxPromptEnhanced, setLtxPromptEnhanced] = useState(false)
  const [ltxEnhanceStatus, setLtxEnhanceStatus]   = useState<'idle' | 'enhancing' | 'error'>('idle')
  const [ltxEnhanceError, setLtxEnhanceError]     = useState<string | null>(null)
  const [ltxGuideOpen, setLtxGuideOpen]           = useState(false)

  // LTX audio state
  const [ltxAudioType, setLtxAudioType]       = useState<'voiceover' | 'sfx' | 'music'>('music')
  const [ltxAudioText, setLtxAudioText]       = useState('')
  const [ltxAudioStatus, setLtxAudioStatus]   = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [ltxAudioError, setLtxAudioError]     = useState<string | null>(null)
  const [ltxHasAudio, setLtxHasAudio]         = useState(false)

  // ── Product search (debounced) ──────────────────────────────────────────
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (query.length < 2) { setResults([]); setShowDropdown(false); return }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/product-search?q=${encodeURIComponent(query)}`)
        const data = await res.json() as { products: SearchProduct[] }
        setResults(data.products ?? [])
        setShowDropdown(true)
      } catch { setResults([]) }
    }, 300)

    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [query])

  // ── Select product ────────────────────────────────────────────────────────
  const selectProduct = useCallback((product: SearchProduct) => {
    setSelectedProduct(product)
    setQuery(product.title)
    setShowDropdown(false)
    setStartingImageUrl(null)
    // Reset generation state
    setGenStatus('idle')
    setGenToken(null)
    setVideoUrls([])
    setEnhancedPrompt(null)
    setGenError(null)
    setUploadStatus({})
    setUploadError({})
    // Fetch product images
    const form = new FormData()
    form.set('intent', 'fetch-images')
    form.set('productId', product.id)
    imageFetcher.submit(form, { method: 'post' })
  }, [imageFetcher])

  // ── Resolution validation ─────────────────────────────────────────────────
  const resolutionDisabled = duration !== 8

  useEffect(() => {
    if (resolutionDisabled && (resolution === '1080p' || resolution === '4k')) {
      setResolution('720p')
    }
  }, [duration, resolution, resolutionDisabled])

  // Auto-set personGeneration when using start_frame mode with an image
  useEffect(() => {
    if (startingImageUrl && imageMode === 'start_frame') setPersonGeneration('allow_adult')
  }, [startingImageUrl, imageMode])

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!selectedProduct || !prompt.trim()) return

    setGenStatus('enhancing')
    setGenError(null)
    setVideoUrls([])
    setEnhancedPrompt(null)
    setElapsed(0)
    setUploadStatus({})
    setUploadError({})
    pollCountRef.current = 0

    try {
      const form = new FormData()
      form.set('productId',        selectedProduct.id)
      form.set('productName',      selectedProduct.title)
      form.set('brand',            selectedProduct.title.split(' ')[0] ?? 'Unknown')
      form.set('category',         '')
      form.set('prompt',           prompt)
      form.set('aspectRatio',      aspectRatio)
      form.set('duration',         String(duration))
      form.set('resolution',       resolution)
      form.set('personGeneration', personGeneration)
      form.set('numberOfVideos',   String(numberOfVideos))
      if (startingImageUrl) {
        form.set('startingImageUrl', startingImageUrl)
        form.set('imageMode', imageMode)
      }

      const res  = await fetch('/api/veo/generate', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; token?: string; enhancedPrompt?: string; error?: string }

      if (!res.ok || !data.ok) {
        setGenStatus('error')
        setGenError(data.error ?? 'Generation failed')
        return
      }

      setGenToken(data.token!)
      setEnhancedPrompt(data.enhancedPrompt ?? null)
      setGenStatus('generating')
      startPolling(data.token!)
    } catch (err) {
      setGenStatus('error')
      setGenError(err instanceof Error ? err.message : 'Network error')
    }
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  const startPolling = (token: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollCountRef.current = 0

    pollRef.current = setInterval(async () => {
      pollCountRef.current++
      setElapsed(prev => prev + 10)

      // Timeout after 6 minutes (36 polls)
      if (pollCountRef.current > 36) {
        if (pollRef.current) clearInterval(pollRef.current)
        setGenStatus('error')
        setGenError('Generation timed out after 6 minutes. The video may still be processing — try refreshing.')
        return
      }

      try {
        const res  = await fetch(`/api/veo/status/${token}`)
        const data = await res.json() as { status: string; videoUrls?: string[]; enhancedPrompt?: string; error?: string; elapsed?: number }

        if (data.status === 'complete' && data.videoUrls) {
          if (pollRef.current) clearInterval(pollRef.current)
          setVideoUrls(data.videoUrls)
          setGenStatus('complete')
          if (data.enhancedPrompt) setEnhancedPrompt(data.enhancedPrompt)
        } else if (data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current)
          setGenStatus('error')
          setGenError(data.error ?? 'Generation failed')
        }
        // else still generating — continue polling
      } catch {
        // Network error — don't stop polling, might be transient
      }
    }, 10_000)
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ── Upload to Shopify ─────────────────────────────────────────────────────
  const handleUpload = async (videoIndex: number) => {
    if (!genToken || !selectedProduct) return

    setUploadStatus(prev => ({ ...prev, [videoIndex]: 'uploading' }))
    setUploadError(prev => { const n = { ...prev }; delete n[videoIndex]; return n })

    try {
      const form = new FormData()
      form.set('token',      genToken)
      form.set('videoIndex', String(videoIndex))
      form.set('productId',  selectedProduct.id)

      const res  = await fetch('/api/veo/upload', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok || !data.ok) {
        setUploadStatus(prev => ({ ...prev, [videoIndex]: 'error' }))
        setUploadError(prev => ({ ...prev, [videoIndex]: data.error ?? 'Upload failed' }))
        return
      }

      setUploadStatus(prev => ({ ...prev, [videoIndex]: 'done' }))
    } catch (err) {
      setUploadStatus(prev => ({ ...prev, [videoIndex]: 'error' }))
      setUploadError(prev => ({ ...prev, [videoIndex]: err instanceof Error ? err.message : 'Network error' }))
    }
  }

  // ── LTX Add Audio ─────────────────────────────────────────────────────────
  const handleLtxAddAudio = async () => {
    if (!ltxGenToken || !ltxAudioText.trim()) return

    setLtxAudioStatus('generating')
    setLtxAudioError(null)

    try {
      const form = new FormData()
      form.set('token',     ltxGenToken)
      form.set('audioType', ltxAudioType)
      form.set('audioText', ltxAudioText)

      const res  = await fetch('/api/ltx/add-audio', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; videoUrl?: string; error?: string }

      if (!res.ok || !data.ok) {
        setLtxAudioStatus('error')
        setLtxAudioError(data.error ?? 'Audio generation failed')
        return
      }

      // Bust browser cache by appending timestamp
      setLtxVideoUrl(`${data.videoUrl}?t=${Date.now()}`)
      setLtxAudioStatus('done')
      setLtxHasAudio(true)
    } catch (err) {
      setLtxAudioStatus('error')
      setLtxAudioError(err instanceof Error ? err.message : 'Network error')
    }
  }

  // ── LTX duration validation ───────────────────────────────────────────────
  const validLtxDurations = getValidLtxDurations(ltxResolution, ltxFps)

  useEffect(() => {
    if (!validLtxDurations.includes(ltxDuration)) {
      setLtxDuration(validLtxDurations[validLtxDurations.length - 1]!)
    }
  }, [ltxResolution, ltxFps, ltxDuration, validLtxDurations])

  // Cleanup LTX timer on unmount
  useEffect(() => {
    return () => { if (ltxTimerRef.current) clearInterval(ltxTimerRef.current) }
  }, [])

  // ── LTX Enhance Prompt ───────────────────────────────────────────────────
  const handleLtxEnhancePrompt = async () => {
    if (!selectedProduct || !ltxPrompt.trim()) return

    setLtxEnhanceStatus('enhancing')
    setLtxEnhanceError(null)

    try {
      const form = new FormData()
      form.set('prompt',      ltxPrompt)
      form.set('productName', selectedProduct.title)
      form.set('brand',       selectedProduct.title.split(' ')[0] ?? 'Unknown')
      form.set('resolution',  ltxResolution)
      form.set('duration',    String(ltxDuration))
      if (ltxCameraMotion) form.set('cameraMotion', ltxCameraMotion)

      const res  = await fetch('/api/ltx/enhance-prompt', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; enhanced?: string; error?: string }

      if (!res.ok || !data.ok) {
        setLtxEnhanceStatus('error')
        setLtxEnhanceError(data.error ?? 'Enhancement failed')
        return
      }

      setLtxPrompt(data.enhanced!)
      setLtxPromptEnhanced(true)
      setLtxEnhanceStatus('idle')
    } catch (err) {
      setLtxEnhanceStatus('error')
      setLtxEnhanceError(err instanceof Error ? err.message : 'Network error')
    }
  }

  // ── LTX Generate ─────────────────────────────────────────────────────────
  const handleLtxGenerate = async () => {
    if (!selectedProduct || !ltxPrompt.trim() || !startingImageUrl) return

    setLtxGenStatus('generating')
    setLtxGenError(null)
    setLtxVideoUrl(null)
    setLtxEnhancedPrompt(null)
    setLtxElapsed(0)
    setLtxUploadStatus('idle')
    setLtxUploadError(null)
    setLtxAudioStatus('idle')
    setLtxAudioError(null)
    setLtxHasAudio(false)

    // Start elapsed timer (1s intervals)
    if (ltxTimerRef.current) clearInterval(ltxTimerRef.current)
    ltxTimerRef.current = setInterval(() => setLtxElapsed(prev => prev + 1), 1000)

    try {
      const form = new FormData()
      form.set('productId',        selectedProduct.id)
      form.set('productName',      selectedProduct.title)
      form.set('brand',            selectedProduct.title.split(' ')[0] ?? 'Unknown')
      form.set('category',         '')
      form.set('prompt',           ltxPrompt)
      form.set('duration',         String(ltxDuration))
      form.set('resolution',       ltxResolution)
      form.set('aspectRatio',     ltxAspectRatio)
      form.set('fps',              String(ltxFps))
      form.set('startingImageUrl', startingImageUrl)
      if (ltxCameraMotion) form.set('cameraMotion', ltxCameraMotion)
      form.set('skipEnhance', 'true')

      setLtxGenStatus('generating')

      const res  = await fetch('/api/ltx/generate', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; token?: string; enhancedPrompt?: string; videoUrls?: string[]; error?: string }

      if (ltxTimerRef.current) clearInterval(ltxTimerRef.current)

      if (!res.ok || !data.ok) {
        setLtxGenStatus('error')
        setLtxGenError(data.error ?? 'Generation failed')
        return
      }

      setLtxGenToken(data.token!)
      setLtxEnhancedPrompt(data.enhancedPrompt ?? null)
      setLtxVideoUrl(data.videoUrls?.[0] ?? null)
      setLtxGenStatus('complete')
    } catch (err) {
      if (ltxTimerRef.current) clearInterval(ltxTimerRef.current)
      setLtxGenStatus('error')
      setLtxGenError(err instanceof Error ? err.message : 'Network error')
    }
  }

  // ── LTX Upload to Shopify ────────────────────────────────────────────────
  const handleLtxUpload = async () => {
    if (!ltxGenToken || !selectedProduct) return

    setLtxUploadStatus('uploading')
    setLtxUploadError(null)

    try {
      const form = new FormData()
      form.set('token',      ltxGenToken)
      form.set('videoIndex', '0')
      form.set('productId',  selectedProduct.id)

      const res  = await fetch('/api/ltx/upload', { method: 'POST', body: form })
      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok || !data.ok) {
        setLtxUploadStatus('error')
        setLtxUploadError(data.error ?? 'Upload failed')
        return
      }

      setLtxUploadStatus('done')
    } catch (err) {
      setLtxUploadStatus('error')
      setLtxUploadError(err instanceof Error ? err.message : 'Network error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-8">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Labs
      </h1>
      <p className="text-sm text-ink/60">
        AI video generation powered by Google Veo and LTX Video. Search for a product, describe your video idea, and generate cinematic clips.
      </p>

      {/* ── Section 1: Product Search ─────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Select Product
        </h2>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); if (selectedProduct && e.target.value !== selectedProduct.title) setSelectedProduct(null) }}
            placeholder="Search products..."
            className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
          />

          {showDropdown && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white rounded-xl shadow-lg border border-cream-2 max-h-72 overflow-y-auto">
              {results.map(product => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cream-2/50 transition-colors text-left"
                >
                  {product.image ? (
                    <img src={product.image} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-cream-2 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{product.title}</div>
                    <div className="text-xs text-ink/50">
                      ${product.price.toFixed(2)}
                      {product.compareAtPrice ? <span className="line-through ml-2">${product.compareAtPrice.toFixed(2)}</span> : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected product card with images */}
        {selectedProduct && images.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-ink/50 mb-2 font-medium">Product Images ({images.length})</p>
            <div className="grid grid-cols-5 gap-2">
              {images.map(img => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setStartingImageUrl(prev => prev === img.src ? null : img.src)}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all aspect-square ${
                    startingImageUrl === img.src
                      ? 'border-sage ring-2 ring-sage/30'
                      : 'border-transparent hover:border-cream-2'
                  }`}
                >
                  <img src={img.src} alt={img.alt ?? ''} className="w-full h-full object-cover" />
                  {startingImageUrl === img.src && (
                    <div className="absolute inset-0 bg-sage/20 flex items-center justify-center">
                      <span className="text-white text-xs font-bold bg-sage rounded-full px-2 py-0.5">Start Frame</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
            {startingImageUrl && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-ink/60">Image Mode</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setImageMode('reference')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      imageMode === 'reference'
                        ? 'bg-sage text-white'
                        : 'bg-cream-2 text-ink/60 hover:text-ink'
                    }`}
                  >
                    Reference (visual context)
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageMode('start_frame')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      imageMode === 'start_frame'
                        ? 'bg-sage text-white'
                        : 'bg-cream-2 text-ink/60 hover:text-ink'
                    }`}
                  >
                    Start Frame (first frame)
                  </button>
                </div>
                <p className="text-xs text-sage">
                  {imageMode === 'reference'
                    ? 'Reference mode: Veo uses the image as visual context but generates the video freely.'
                    : 'Start frame mode: Veo animates directly from the selected image as the first frame.'}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Google Veo Section (collapsible) ────────────────────────── */}
      {selectedProduct && (
        <CollapsibleSection title="Google Veo" badge="purple" open={veoOpen} onToggle={() => setVeoOpen(o => !o)}>
          {/* Prompt */}
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-ink">Video Idea</label>
            <p className="text-xs text-ink/50">Describe your video concept. Claude will enhance it with camera, lighting, and audio cues for Veo.</p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g., A warm, intimate scene with soft golden lighting. The camera slowly pans across silk fabric as someone whispers 'You deserve this.'"
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 resize-y"
            />
          </div>

          {/* Controls grid */}
          <div className="grid grid-cols-2 gap-6">
            <RadioGroup
              label="Aspect Ratio"
              value={aspectRatio}
              onChange={v => setAspectRatio(v as '16:9' | '9:16')}
              options={[
                { value: '16:9', label: '16:9 Landscape' },
                { value: '9:16', label: '9:16 Vertical' },
              ]}
            />
            <RadioGroup
              label="Duration"
              value={String(duration)}
              onChange={v => setDuration(parseInt(v, 10) as 4 | 6 | 8)}
              options={[
                { value: '4', label: '4 seconds' },
                { value: '6', label: '6 seconds' },
                { value: '8', label: '8 seconds' },
              ]}
            />
            <RadioGroup
              label="Resolution"
              value={resolution}
              onChange={v => setResolution(v as '720p' | '1080p' | '4k')}
              options={[
                { value: '720p',  label: '720p' },
                { value: '1080p', label: '1080p', disabled: resolutionDisabled },
                { value: '4k',    label: '4K',    disabled: resolutionDisabled },
              ]}
              hint={resolutionDisabled ? '1080p and 4K require 8s duration' : undefined}
            />
            <RadioGroup
              label="Person Generation"
              value={personGeneration}
              onChange={v => setPersonGeneration(v as 'allow_all' | 'allow_adult')}
              options={[
                { value: 'allow_all',   label: 'Allow All',   disabled: !!(startingImageUrl && imageMode === 'start_frame') },
                { value: 'allow_adult', label: 'Allow Adult' },
              ]}
              hint={startingImageUrl && imageMode === 'start_frame' ? 'Start frame mode requires Allow Adult' : undefined}
            />
            <RadioGroup
              label="Number of Videos"
              value={String(numberOfVideos)}
              onChange={v => setNumberOfVideos(parseInt(v, 10) as 1 | 2)}
              options={[
                { value: '1', label: '1 video' },
                { value: '2', label: '2 videos' },
              ]}
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim() || genStatus === 'enhancing' || genStatus === 'generating'}
            className="w-full py-3 px-6 bg-coral text-white font-bold rounded-xl text-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {genStatus === 'enhancing' ? 'Enhancing prompt...' :
             genStatus === 'generating' ? 'Generating...' :
             'Generate Video'}
          </button>

          {/* Veo Generation Progress */}
          {(genStatus === 'enhancing' || genStatus === 'generating') && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-sage border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-ink/70">
                  {genStatus === 'enhancing' ? 'Enhancing prompt with Claude...' : `Generating video with Veo... (${elapsed}s)`}
                </span>
              </div>
              {enhancedPrompt && (
                <div className="bg-cream-2/50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-ink/50 mb-1">Enhanced Prompt</p>
                  <p className="text-sm text-ink leading-relaxed">{enhancedPrompt}</p>
                </div>
              )}
              <p className="text-xs text-ink/40">
                Veo generation typically takes 30 seconds to 6 minutes. The page will update automatically.
              </p>
            </div>
          )}

          {/* Veo Error */}
          {genStatus === 'error' && genError && (
            <div className="bg-red-50 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-red-700">Generation Failed</p>
              <p className="text-sm text-red-600">{genError}</p>
              <button
                type="button"
                onClick={() => { setGenStatus('idle'); setGenError(null) }}
                className="text-sm font-semibold text-red-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Veo Preview & Upload */}
          {genStatus === 'complete' && videoUrls.length > 0 && (
            <div className="space-y-4">
              {enhancedPrompt && (
                <div className="bg-cream-2/50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-ink/50 mb-1">Enhanced Prompt</p>
                  <p className="text-sm text-ink leading-relaxed">{enhancedPrompt}</p>
                </div>
              )}
              <div className={`grid gap-6 ${videoUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {videoUrls.map((url, i) => (
                  <div key={i} className="space-y-3">
                    <video src={url} controls playsInline className="w-full rounded-xl bg-black" />
                    {uploadStatus[i] === 'done' ? (
                      <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Uploaded to Shopify
                      </div>
                    ) : uploadStatus[i] === 'uploading' ? (
                      <div className="flex items-center gap-2 text-sm text-ink/60">
                        <div className="w-4 h-4 border-2 border-sage border-t-transparent rounded-full animate-spin" />
                        Uploading to Shopify...
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => handleUpload(i)}
                          className="w-full py-2.5 px-4 bg-sage text-white font-semibold rounded-xl text-sm hover:bg-sun transition-colors"
                          style={{ fontFamily: 'var(--font-display)' }}
                        >
                          Upload to Shopify
                        </button>
                        {uploadStatus[i] === 'error' && uploadError[i] && (
                          <p className="text-xs text-red-600">{uploadError[i]}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* ── LTX Video Section (collapsible) ──────────────────────────── */}
      {selectedProduct && (
        <CollapsibleSection title="LTX Video" badge="blue" open={ltxOpen} onToggle={() => setLtxOpen(o => !o)}>
          {/* Image requirement notice */}
          {!startingImageUrl ? (
            <div className="bg-amber-50 rounded-xl p-4">
              <p className="text-sm text-amber-700">Select a product image above to use as the starting frame. LTX image-to-video requires a source image.</p>
            </div>
          ) : (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-xs text-blue-600">LTX always uses the selected image as the <strong>first frame</strong> of the video. The image mode toggle above only applies to Google Veo.</p>
            </div>
          )}

          {/* Prompting Guide (collapsible) */}
          <div className="border border-cream-2 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setLtxGuideOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-cream-2/30 hover:bg-cream-2/50 transition-colors text-left"
            >
              <span className="text-sm font-semibold text-ink flex items-center gap-2">
                <svg className="w-4 h-4 text-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" /></svg>
                LTX Prompting Guide
              </span>
              <svg className={`w-4 h-4 text-ink/50 transition-transform ${ltxGuideOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {ltxGuideOpen && (
              <div className="px-4 py-3 space-y-3 text-xs text-ink/70 border-t border-cream-2">
                <p className="font-semibold text-ink text-sm">The product image IS the first frame. Don't re-describe it — describe what happens next.</p>
                <div className="space-y-2">
                  <p className="font-semibold text-ink">Three layers, in order:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-1">
                    <li><strong>Subject Action</strong> — What moves and how. Name the subject first, then the physical change. No vague labels like "epic" or "stunning."</li>
                    <li><strong>Camera Movement</strong> — Specific terms: slow dolly in, gentle jib up, rack focus. Not "dynamic" or "cinematic."</li>
                    <li><strong>Environment / Atmosphere</strong> — What shifts: lighting changes, particles, reflections, color temperature. Describe change, not static state.</li>
                  </ol>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-ink">Scaling:</p>
                  <ul className="list-disc list-inside ml-1 space-y-0.5">
                    <li>6-8s: 3-5 tight sentences</li>
                    <li>10-15s: 5-8 sentences with progression</li>
                    <li>16-20s: 8-12 sentences with phases and ending beat</li>
                  </ul>
                </div>
                <p className="italic">Template: [product action] + [camera instruction] + [lighting/atmosphere shift] + [optional audio cue]</p>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="space-y-1">
            <label className="block text-sm font-semibold text-ink">Video Idea</label>
            <p className="text-xs text-ink/50">Write your prompt directly or start with a rough idea and hit "Enhance with Claude" to expand it.</p>
            <textarea
              value={ltxPrompt}
              onChange={e => { setLtxPrompt(e.target.value); setLtxPromptEnhanced(false) }}
              rows={4}
              placeholder="e.g., Product slowly rises off the surface, camera dollies in, warm golden light intensifies from behind"
              className="w-full border border-cream-2 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 resize-y"
            />
            {/* Enhance button */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleLtxEnhancePrompt}
                disabled={!ltxPrompt.trim() || !selectedProduct || ltxEnhanceStatus === 'enhancing'}
                className="px-4 py-1.5 text-xs font-semibold text-sage border border-sage/30 rounded-lg hover:bg-sage/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {ltxEnhanceStatus === 'enhancing' ? (
                  <>
                    <div className="w-3 h-3 border-2 border-sage border-t-transparent rounded-full animate-spin" />
                    Enhancing...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                    Enhance with Claude
                  </>
                )}
              </button>
              {ltxPromptEnhanced && (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Enhanced — will skip auto-enhance on generate
                </span>
              )}
              {ltxEnhanceStatus === 'error' && ltxEnhanceError && (
                <span className="text-xs text-red-600">{ltxEnhanceError}</span>
              )}
            </div>
          </div>

          {/* Controls grid */}
          <div className="grid grid-cols-2 gap-6">
            <RadioGroup
              label="Aspect Ratio"
              value={ltxAspectRatio}
              onChange={v => setLtxAspectRatio(v as '16:9' | '9:16')}
              options={[
                { value: '16:9', label: '16:9 Landscape' },
                { value: '9:16', label: '9:16 Vertical' },
              ]}
            />
            <RadioGroup
              label="Resolution"
              value={ltxResolution}
              onChange={v => setLtxResolution(v as '480p' | '720p' | '1080p')}
              options={[
                { value: '480p',  label: '480p' },
                { value: '720p',  label: '720p' },
                { value: '1080p', label: '1080p' },
              ]}
            />
            <RadioGroup
              label="FPS"
              value={String(ltxFps)}
              onChange={v => setLtxFps(parseInt(v, 10) as 24 | 25 | 48 | 50)}
              options={[
                { value: '24', label: '24 fps' },
                { value: '25', label: '25 fps' },
                { value: '48', label: '48 fps' },
                { value: '50', label: '50 fps' },
              ]}
            />
            <RadioGroup
              label="Duration"
              value={String(ltxDuration)}
              onChange={v => setLtxDuration(parseInt(v, 10))}
              options={validLtxDurations.map(d => ({ value: String(d), label: `${d}s` }))}
              hint={ltxResolution !== '1080p' || ltxFps > 25
                ? 'Higher resolution/fps limits duration to 6-10s'
                : 'Up to 20s at 1080p 24/25fps'}
            />
            <RadioGroup
              label="Camera Motion"
              value={ltxCameraMotion || 'none'}
              onChange={v => setLtxCameraMotion(v === 'none' ? '' : v)}
              options={[
                { value: 'none',        label: 'None' },
                { value: 'dolly_in',    label: 'Dolly In' },
                { value: 'dolly_out',   label: 'Dolly Out' },
                { value: 'dolly_left',  label: 'Dolly Left' },
                { value: 'dolly_right', label: 'Dolly Right' },
                { value: 'jib_up',      label: 'Jib Up' },
                { value: 'jib_down',    label: 'Jib Down' },
                { value: 'static',      label: 'Static' },
                { value: 'focus_shift', label: 'Focus Shift' },
              ]}
            />
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleLtxGenerate}
            disabled={!ltxPrompt.trim() || !startingImageUrl || ltxGenStatus === 'generating'}
            className="w-full py-3 px-6 bg-coral text-white font-bold rounded-xl text-sm transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {ltxGenStatus === 'generating' ? 'Generating...' : 'Generate Video'}
          </button>

          {/* LTX Generation Progress */}
          {ltxGenStatus === 'generating' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-ink/70">
                  Generating video with LTX... ({ltxElapsed}s)
                </span>
              </div>
              <p className="text-xs text-ink/40">
                LTX generation typically takes 30-120 seconds. The page will update when complete.
              </p>
            </div>
          )}

          {/* LTX Error */}
          {ltxGenStatus === 'error' && ltxGenError && (
            <div className="bg-red-50 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-red-700">Generation Failed</p>
              <p className="text-sm text-red-600">{ltxGenError}</p>
              <button
                type="button"
                onClick={() => { setLtxGenStatus('idle'); setLtxGenError(null) }}
                className="text-sm font-semibold text-red-700 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* LTX Preview & Upload */}
          {ltxGenStatus === 'complete' && ltxVideoUrl && (
            <div className="space-y-4">
              {ltxEnhancedPrompt && (
                <div className="bg-cream-2/50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-ink/50 mb-1">Enhanced Prompt</p>
                  <p className="text-sm text-ink leading-relaxed">{ltxEnhancedPrompt}</p>
                </div>
              )}
              <div className="space-y-3">
                <video key={ltxVideoUrl} src={ltxVideoUrl} controls playsInline className="w-full rounded-xl bg-black" />

                {ltxHasAudio && (
                  <div className="flex items-center gap-2 text-green-600 text-xs font-medium">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    Audio added ({ltxAudioType === 'sfx' ? 'Sound Effects' : ltxAudioType === 'voiceover' ? 'Voiceover' : 'Music'})
                  </div>
                )}

                {/* ── Add Audio Section ──────────────────────────────── */}
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-ink/70">Add Audio (ElevenLabs)</p>

                  {/* Audio type selector */}
                  <div className="flex gap-2">
                    {([
                      { value: 'music',     label: 'Music',         icon: '♪' },
                      { value: 'sfx',       label: 'Sound Effects', icon: '🔊' },
                      { value: 'voiceover', label: 'Voiceover',     icon: '🎙' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setLtxAudioType(opt.value)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                          ltxAudioType === opt.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-ink/60 hover:bg-blue-50 border border-cream-2'
                        }`}
                      >
                        <span className="mr-1">{opt.icon}</span> {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Audio prompt/text input */}
                  <textarea
                    value={ltxAudioText}
                    onChange={e => setLtxAudioText(e.target.value)}
                    rows={2}
                    placeholder={
                      ltxAudioType === 'voiceover'
                        ? 'Enter the narration script...'
                        : ltxAudioType === 'sfx'
                          ? 'Describe the sound effect (e.g., "soft ambient spa sounds with gentle water flowing")'
                          : 'Describe the music mood (e.g., "upbeat lo-fi chill, warm and inviting, gentle piano")'
                    }
                    className="w-full border border-cream-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 resize-y bg-white"
                  />

                  {/* Generate audio button */}
                  <button
                    type="button"
                    onClick={handleLtxAddAudio}
                    disabled={!ltxAudioText.trim() || ltxAudioStatus === 'generating'}
                    className="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {ltxAudioStatus === 'generating' ? 'Generating audio & mixing...' : ltxHasAudio ? 'Replace Audio' : 'Generate & Mix Audio'}
                  </button>

                  {ltxAudioStatus === 'generating' && (
                    <div className="flex items-center gap-2 text-sm text-ink/60">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      {ltxAudioType === 'music' ? 'Composing music' : ltxAudioType === 'sfx' ? 'Generating sound effects' : 'Synthesizing voiceover'}... this may take 10-30s
                    </div>
                  )}

                  {ltxAudioStatus === 'error' && ltxAudioError && (
                    <p className="text-xs text-red-600">{ltxAudioError}</p>
                  )}
                </div>

                {/* ── Upload to Shopify ─────────────────────────────── */}
                {ltxUploadStatus === 'done' ? (
                  <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Uploaded to Shopify
                  </div>
                ) : ltxUploadStatus === 'uploading' ? (
                  <div className="flex items-center gap-2 text-sm text-ink/60">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Uploading to Shopify...
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleLtxUpload}
                      className="w-full py-2.5 px-4 bg-blue-600 text-white font-semibold rounded-xl text-sm hover:bg-blue-500 transition-colors"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      Upload to Shopify{ltxHasAudio ? ' (with audio)' : ''}
                    </button>
                    {ltxUploadStatus === 'error' && ltxUploadError && (
                      <p className="text-xs text-red-600">{ltxUploadError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}
    </div>
  )
}

// ─── LTX Duration Helper ──────────────────────────────────────────────────────

function getValidLtxDurations(resolution: string, fps: number): number[] {
  if (resolution === '1080p' && (fps === 24 || fps === 25)) {
    return [6, 8, 10, 12, 14, 16, 18, 20]
  }
  return [6, 8, 10]
}

// ─── CollapsibleSection component ─────────────────────────────────────────────

function CollapsibleSection({ title, open, onToggle, badge, children }: {
  title: string
  open: boolean
  onToggle: () => void
  badge?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-cream-2/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </h2>
          {badge && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              badge === 'purple' ? 'bg-sage/10 text-sage' : 'bg-blue-100 text-blue-600'
            }`}>
              {badge === 'purple' ? 'Google' : 'LTX'}
            </span>
          )}
        </div>
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-ink/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-6 pb-6 space-y-6">{children}</div>}
    </div>
  )
}

// ─── RadioGroup component ─────────────────────────────────────────────────────

function RadioGroup({ label, value, onChange, options, hint }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; disabled?: boolean | undefined }[]
  hint?: string | undefined
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              value === opt.value
                ? 'bg-sage text-white'
                : opt.disabled
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-cream-2 text-ink hover:bg-sage/10'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {hint && <p className="text-xs text-ink/40">{hint}</p>}
    </div>
  )
}
