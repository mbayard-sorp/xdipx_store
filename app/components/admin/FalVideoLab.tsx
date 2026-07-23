/**
 * FalVideoLab — the fal.ai video spike panel on /admin/labs.
 *
 * Two-step recipe the production pipeline will automate:
 *   1. Compose candidate 9:16 scene frames (Emma + real product photo) for cents.
 *   2. Pick the best frame and animate it via a fal queue image-to-video model.
 * Validates likeness hold and drift per model tier before any team automation.
 */

import { useEffect, useRef, useState } from 'react'

interface LabProduct {
  id: string
  title: string
  handle: string
}

interface QueueHandle {
  requestId: string
  statusUrl: string
  responseUrl: string
}

interface ModelOption {
  id: string
  label: string
  ratePerSecondUsd: number
  durations: number[]
}

// Mirrors VIDEO_MODELS in fal-video.server.ts (client-safe copy for the picker).
const MODEL_OPTIONS: ModelOption[] = [
  { id: 'veo31',       label: 'Veo 3.1 (native audio) ~$0.40/s',  ratePerSecondUsd: 0.40, durations: [4, 6, 8] },
  { id: 'veo31-fast',  label: 'Veo 3.1 Fast ~$0.15/s',            ratePerSecondUsd: 0.15, durations: [4, 6, 8] },
  { id: 'kling25-pro', label: 'Kling 2.5 Turbo Pro ~$0.07/s',     ratePerSecondUsd: 0.07, durations: [5, 10] },
  { id: 'seedance2',   label: 'Seedance 2.0 ~$0.31/s',            ratePerSecondUsd: 0.31, durations: [4, 6, 8, 10] },
]

const DEFAULT_FRAME_PROMPT =
  'Editorial product scene, bright high-key daylight, soft white paper backdrop with a coral tint. ' +
  'The woman from the first image stands in a warm, private bedroom setting holding the product from the second image ' +
  'toward the camera in her open palm, product large and sharply in focus at the center of the frame, her face soft and friendly behind it. ' +
  'Premium lingerie-campaign styling, tasteful, fully clothed in elevated loungewear. ' +
  'Vertical 9:16 composition. No text, no words, no letters, no watermark, no logo.'

export function FalVideoLab({ product, productImages }: {
  product: LabProduct | null
  productImages: { src: string }[]
}) {
  const [open, setOpen] = useState(false)

  // Step 1: frame composition
  const [presenter, setPresenter]       = useState<'emma' | 'none'>('emma')
  const [framePrompt, setFramePrompt]   = useState(DEFAULT_FRAME_PROMPT)
  const [productImage, setProductImage] = useState<string | null>(null)
  const [frames, setFrames]             = useState<string[]>([])
  const [chosenFrame, setChosenFrame]   = useState<string | null>(null)
  const [frameStatus, setFrameStatus]   = useState<'idle' | 'working' | 'error'>('idle')
  const [frameError, setFrameError]     = useState<string | null>(null)

  // Step 2: video generation
  const [modelId, setModelId]       = useState('kling25-pro')
  const [duration, setDuration]     = useState(5)
  const [motionPrompt, setMotionPrompt] = useState(
    'She holds the product steady toward the camera and speaks warmly about it, natural hand motion, ' +
    'camera holds on the product, gentle push-in, bright editorial lighting stays constant.',
  )
  const [videoStatus, setVideoStatus] = useState<'idle' | 'queued' | 'generating' | 'complete' | 'error'>('idle')
  const [videoUrl, setVideoUrl]       = useState<string | null>(null)
  const [videoError, setVideoError]   = useState<string | null>(null)
  const [elapsed, setElapsed]         = useState(0)
  const handleRef = useRef<QueueHandle | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const model = MODEL_OPTIONS.find(m => m.id === modelId) ?? MODEL_OPTIONS[0]!
  const estCost = (model.ratePerSecondUsd * duration).toFixed(2)

  // Keep duration valid for the selected model.
  useEffect(() => {
    if (!model.durations.includes(duration)) setDuration(model.durations[0] ?? 5)
  }, [modelId, model, duration])

  // Reset when the product changes.
  useEffect(() => {
    setFrames([]); setChosenFrame(null); setProductImage(null)
    setVideoStatus('idle'); setVideoUrl(null); setVideoError(null)
  }, [product?.id])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const composeFrames = async () => {
    if (!product || !productImage) return
    setFrameStatus('working'); setFrameError(null); setFrames([]); setChosenFrame(null)
    try {
      const res = await fetch('/api/fal-video/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: framePrompt,
          productImageUrl: productImage,
          presenter,
          count: 3,
          productHandle: product.handle,
        }),
      })
      const data = await res.json() as { urls?: string[]; error?: string }
      if (!res.ok || !data.urls?.length) throw new Error(data.error ?? 'No frames returned')
      setFrames(data.urls)
      setFrameStatus('idle')
    } catch (err) {
      setFrameStatus('error')
      setFrameError(err instanceof Error ? err.message : 'Frame composition failed')
    }
  }

  const generateVideo = async () => {
    if (!chosenFrame || !product) return
    setVideoStatus('queued'); setVideoError(null); setVideoUrl(null); setElapsed(0)
    try {
      const res = await fetch('/api/fal-video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'submit',
          model: modelId,
          imageUrl: chosenFrame,
          prompt: motionPrompt,
          durationSeconds: duration,
          productHandle: product.handle,
        }),
      })
      const data = await res.json() as { handle?: QueueHandle; error?: string }
      if (!res.ok || !data.handle) throw new Error(data.error ?? 'Submit failed')
      handleRef.current = data.handle
      setVideoStatus('generating')

      pollRef.current = setInterval(async () => {
        setElapsed(e => e + 5)
        try {
          const sres = await fetch('/api/fal-video/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op: 'status', handle: handleRef.current }),
          })
          const sdata = await sres.json() as { status?: string; videoUrl?: string; error?: string }
          if (sdata.status === 'COMPLETED' && sdata.videoUrl) {
            if (pollRef.current) clearInterval(pollRef.current)
            setVideoUrl(sdata.videoUrl)
            setVideoStatus('complete')
          } else if (sdata.status === 'FAILED' || sdata.error) {
            if (pollRef.current) clearInterval(pollRef.current)
            setVideoStatus('error')
            setVideoError(sdata.error ?? 'Generation failed on fal')
          }
        } catch {
          // transient poll failure; keep polling
        }
      }, 5000)
    } catch (err) {
      setVideoStatus('error')
      setVideoError(err instanceof Error ? err.message : 'Video generation failed')
    }
  }

  return (
    <section className="rounded-[22px] border border-line bg-paper-2 p-4 md:p-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h2 className="font-display text-lg text-ink">fal Video Spike</h2>
          <p className="text-sm text-ink-3">Compose a scene frame (Emma + product), then animate it. Validates likeness per model tier.</p>
        </div>
        <span className="text-ink-3">{open ? '−' : '+'}</span>
      </button>

      {open && !product && (
        <p className="mt-4 text-sm text-ink-3">Select a product above to start.</p>
      )}

      {open && product && (
        <div className="mt-4 flex flex-col gap-5">
          {/* Step 1 — scene frame */}
          <div>
            <h3 className="text-sm font-medium text-ink">1. Compose scene frames (~$0.12 for 3)</h3>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start">
              <div className="flex-1">
                <label className="text-xs text-ink-3">Presenter</label>
                <select
                  value={presenter}
                  onChange={e => setPresenter(e.target.value as 'emma' | 'none')}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
                >
                  <option value="emma">Emma (canonical photo)</option>
                  <option value="none">No presenter (product only)</option>
                </select>
                <label className="mt-3 block text-xs text-ink-3">Scene direction</label>
                <textarea
                  value={framePrompt}
                  onChange={e => setFramePrompt(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-ink-3">Product photo (the real one, appears in the frame)</label>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {productImages.map(img => (
                    <button
                      key={img.src}
                      type="button"
                      onClick={() => setProductImage(img.src)}
                      className={`overflow-hidden rounded-lg border-2 ${productImage === img.src ? 'border-coral' : 'border-line'}`}
                    >
                      <img src={img.src} alt="" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
                {!productImages.length && <p className="mt-2 text-xs text-ink-4">No product images found.</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={composeFrames}
              disabled={!productImage || frameStatus === 'working'}
              className="mt-3 rounded-full bg-ink px-5 py-2 text-sm text-paper disabled:opacity-40"
            >
              {frameStatus === 'working' ? 'Composing…' : 'Compose 3 frames'}
            </button>
            {frameError && <p className="mt-2 text-sm text-coral">{frameError}</p>}
            {frames.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-ink-3">Pick the frame to animate:</p>
                <div className="mt-2 grid grid-cols-3 gap-2 md:max-w-md">
                  {frames.map(url => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setChosenFrame(url)}
                      className={`overflow-hidden rounded-lg border-2 ${chosenFrame === url ? 'border-coral' : 'border-line'}`}
                    >
                      <img src={url} alt="" className="aspect-[9/16] w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Step 2 — animate */}
          <div>
            <h3 className="text-sm font-medium text-ink">2. Animate the chosen frame</h3>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center">
              <select
                value={modelId}
                onChange={e => setModelId(e.target.value)}
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              >
                {MODEL_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              >
                {model.durations.map(d => <option key={d} value={d}>{d}s</option>)}
              </select>
              <span className="text-sm text-ink-3">est. ${estCost}</span>
            </div>
            <textarea
              value={motionPrompt}
              onChange={e => setMotionPrompt(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={generateVideo}
              disabled={!chosenFrame || videoStatus === 'queued' || videoStatus === 'generating'}
              className="mt-3 rounded-full bg-coral px-5 py-2 text-sm text-paper disabled:opacity-40"
            >
              {videoStatus === 'generating' ? `Generating… ${elapsed}s` : videoStatus === 'queued' ? 'Queuing…' : `Generate video (~$${estCost})`}
            </button>
            {videoError && <p className="mt-2 text-sm text-coral">{videoError}</p>}
            {videoUrl && (
              <div className="mt-3 md:max-w-xs">
                <video src={videoUrl} controls playsInline className="w-full rounded-lg border border-line" />
                <a href={videoUrl} download className="mt-2 inline-block text-sm text-coral underline">Download mp4</a>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
