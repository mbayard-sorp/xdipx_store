import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AdminProductImage } from '~/lib/shopify.server'
import type { Deal } from '~/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueuedImage {
  tempId: string
  base64: string
  mimeType: string
  alt: string
  uploadState: 'pending' | 'uploading' | 'done' | 'error'
  errorMsg?: string
}

interface GeneratedImage {
  tempId: string
  base64: string
  mimeType: string
  inQueue: boolean
}

interface ImproveModalState {
  image: AdminProductImage
  prompt: string
  loadingSuggestions: boolean
  suggestions: string[]
  generating: boolean
  variants: GeneratedImage[]
  error: string | null
}

const STYLES = [
  { value: 'lifestyle',    label: 'Lifestyle' },
  { value: 'studio-white', label: 'Studio White' },
  { value: 'dark-moody',   label: 'Dark Moody' },
  { value: 'flat-lay',     label: 'Flat Lay' },
  { value: 'close-up',     label: 'Close-Up Detail' },
]

let _tempIdCounter = 0
function tempId() { return `tmp-${++_tempIdCounter}-${Date.now()}` }

// ─── Confirm Delete Popover ───────────────────────────────────────────────────

function ConfirmDeletePopover({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 rounded-xl backdrop-blur-sm">
      <div className="bg-white rounded-xl p-3 shadow-xl text-center w-40">
        <p className="text-xs font-semibold text-brand-charcoal mb-2">Remove image?</p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-1 text-xs rounded-lg border border-brand-mist text-brand-charcoal/60 hover:bg-brand-mist transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-1 text-xs rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Image Tile ───────────────────────────────────────────────────────────────

function ImageTile({
  image,
  isFirst,
  isLast,
  onDelete,
  onImprove,
  onMoveLeft,
  onMoveRight,
}: {
  image: AdminProductImage
  isFirst: boolean
  isLast: boolean
  onDelete: () => void
  onImprove: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="relative group aspect-square rounded-xl overflow-hidden border border-brand-mist bg-brand-mist/30">
      <img
        src={image.src}
        alt={image.alt ?? 'Product image'}
        className="w-full h-full object-cover"
      />

      {/* Reorder arrows */}
      <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isFirst && (
          <button
            onClick={onMoveLeft}
            title="Move left"
            className="w-6 h-6 flex items-center justify-center bg-white/90 rounded-md text-brand-charcoal hover:bg-white text-xs shadow transition-colors"
          >
            ←
          </button>
        )}
        {!isLast && (
          <button
            onClick={onMoveRight}
            title="Move right"
            className="w-6 h-6 flex items-center justify-center bg-white/90 rounded-md text-brand-charcoal hover:bg-white text-xs shadow transition-colors"
          >
            →
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onImprove}
          title="Improve with AI"
          className="w-7 h-7 flex items-center justify-center bg-white/90 rounded-md text-brand-purple hover:bg-white shadow text-xs transition-colors"
        >
          ✨
        </button>
        <button
          onClick={() => setConfirmingDelete(true)}
          title="Remove image"
          className="w-7 h-7 flex items-center justify-center bg-white/90 rounded-md text-red-500 hover:bg-white shadow text-xs transition-colors"
        >
          🗑
        </button>
      </div>

      {/* Position badge */}
      <div className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center bg-black/50 rounded-md text-white text-[10px] font-bold">
        {image.position}
      </div>

      {confirmingDelete && (
        <ConfirmDeletePopover
          onConfirm={() => { setConfirmingDelete(false); onDelete() }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function ImageSkeleton() {
  return (
    <div className="aspect-square rounded-xl overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-r from-brand-mist via-brand-cream to-brand-mist bg-[length:200%_100%] animate-pulse" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-brand-charcoal/20 text-xs">Generating…</div>
      </div>
    </div>
  )
}

// ─── Generated Image Card ─────────────────────────────────────────────────────

/**
 * Returns a viewport-clamped position for the 600×600 overlay so it never
 * escapes the screen. Anchored to the center of the triggering card.
 */
function calcOverlayPos(rect: DOMRect): { top: number; left: number } {
  const SIZE = 600
  const PAD  = 8
  const cx = rect.left + rect.width  / 2
  const cy = rect.top  + rect.height / 2
  return {
    top:  Math.max(PAD, Math.min(cy - SIZE / 2, window.innerHeight - SIZE - PAD)),
    left: Math.max(PAD, Math.min(cx - SIZE / 2, window.innerWidth  - SIZE - PAD)),
  }
}

function GeneratedCard({
  img,
  onAddToQueue,
  onRemove,
  onRegenerate,
}: {
  img: GeneratedImage
  onAddToQueue: () => void
  onRemove: () => void
  onRegenerate: () => void
}) {
  const cardRef                       = useRef<HTMLDivElement>(null)
  const [hovered, setHovered]         = useState(false)
  const [pos,     setPos]             = useState({ top: 0, left: 0 })

  const handleMouseEnter = () => {
    if (cardRef.current) setPos(calcOverlayPos(cardRef.current.getBoundingClientRect()))
    setHovered(true)
  }

  const src = `data:${img.mimeType};base64,${img.base64}`

  return (
    <>
      {/* Thumbnail card */}
      <div
        ref={cardRef}
        className="relative shrink-0 w-36 aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-brand-purple/30 transition-colors group"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        <img src={src} alt="Generated" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
          <button
            onClick={onAddToQueue}
            disabled={img.inQueue}
            title={img.inQueue ? 'Added to queue' : 'Add to upload queue'}
            className={[
              'w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold shadow',
              img.inQueue
                ? 'bg-green-500 text-white cursor-default'
                : 'bg-white text-brand-purple hover:bg-brand-purple hover:text-white transition-colors',
            ].join(' ')}
          >
            {img.inQueue ? '✓' : '+'}
          </button>
          <button
            onClick={onRegenerate}
            title="Regenerate this slot"
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-white text-brand-charcoal hover:bg-brand-mist text-xs shadow transition-colors"
          >
            ↻
          </button>
          <button
            onClick={onRemove}
            title="Discard"
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-white text-red-500 hover:bg-red-50 text-xs shadow transition-colors"
          >
            ✕
          </button>
        </div>
        {img.inQueue && (
          <div className="absolute bottom-1 right-1 bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
            Queued
          </div>
        )}
      </div>

      {/* 600×600 hover preview — fixed so overflow constraints don't clip it */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            className="fixed z-[200] rounded-2xl overflow-hidden shadow-2xl border-2 border-brand-purple/20 pointer-events-auto"
            style={{ top: pos.top, left: pos.left, width: 600, height: 600 }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <img src={src} alt="Generated — full preview" className="w-full h-full object-cover" />

            {/* Action bar */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-4 flex gap-3 justify-center">
              <button
                onClick={onAddToQueue}
                disabled={img.inQueue}
                className={[
                  'px-4 py-2 rounded-full text-sm font-bold shadow transition-colors',
                  img.inQueue
                    ? 'bg-green-500 text-white cursor-default'
                    : 'bg-white text-brand-purple hover:bg-brand-purple hover:text-white',
                ].join(' ')}
              >
                {img.inQueue ? '✓ In queue' : '+ Add to queue'}
              </button>
              <button
                onClick={onRegenerate}
                className="px-4 py-2 rounded-full text-sm font-bold bg-white/20 text-white hover:bg-white/30 shadow transition-colors"
              >
                ↻ Regenerate
              </button>
              <button
                onClick={onRemove}
                className="px-4 py-2 rounded-full text-sm font-bold bg-white/20 text-white hover:bg-red-500 shadow transition-colors"
              >
                ✕ Discard
              </button>
            </div>

            {img.inQueue && (
              <div className="absolute top-3 right-3 bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                Queued ✓
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Modal Variant Tile (with hover-expand) ───────────────────────────────────

function ModalVariantTile({ variant, onUse }: { variant: GeneratedImage; onUse: () => void }) {
  const tileRef                   = useRef<HTMLDivElement>(null)
  const [hovered, setHovered]     = useState(false)
  const [pos,     setPos]         = useState({ top: 0, left: 0 })

  const handleMouseEnter = () => {
    if (tileRef.current) setPos(calcOverlayPos(tileRef.current.getBoundingClientRect()))
    setHovered(true)
  }

  const src = `data:${variant.mimeType};base64,${variant.base64}`

  return (
    <>
      <div
        ref={tileRef}
        className="relative rounded-xl overflow-hidden aspect-square group"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        <img src={src} alt="Variant" className="w-full h-full object-cover" />
        <button
          onClick={onUse}
          disabled={variant.inQueue}
          className={[
            'absolute bottom-2 inset-x-2 py-1.5 rounded-lg text-xs font-bold text-white transition-colors',
            variant.inQueue ? 'bg-green-500 cursor-default' : 'bg-brand-gradient hover:opacity-90',
          ].join(' ')}
        >
          {variant.inQueue ? '✓ Queued' : 'Use This'}
        </button>
      </div>

      <AnimatePresence>
        {hovered && (
          <motion.div
            className="fixed z-[300] rounded-2xl overflow-hidden shadow-2xl border-2 border-brand-purple/20 pointer-events-auto"
            style={{ top: pos.top, left: pos.left, width: 600, height: 600 }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <img src={src} alt="Variant — full preview" className="w-full h-full object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-4 flex justify-center">
              <button
                onClick={onUse}
                disabled={variant.inQueue}
                className={[
                  'px-6 py-2.5 rounded-full text-sm font-bold text-white shadow transition-colors',
                  variant.inQueue ? 'bg-green-500 cursor-default' : 'bg-brand-gradient hover:opacity-90',
                ].join(' ')}
              >
                {variant.inQueue ? '✓ Added to queue' : 'Use This'}
              </button>
            </div>
            {variant.inQueue && (
              <div className="absolute top-3 right-3 bg-green-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                Queued ✓
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Improvement Modal ────────────────────────────────────────────────────────

function ImprovementModal({
  state,
  productContext,
  onClose,
  onAddVariantToQueue,
  onChange,
}: {
  state: ImproveModalState
  productContext: string
  onClose: () => void
  onAddVariantToQueue: (img: GeneratedImage) => void
  onChange: (patch: Partial<ImproveModalState>) => void
}) {
  const handleSuggestImprovements = async () => {
    onChange({ loadingSuggestions: true, error: null })
    try {
      const res  = await fetch('/api/admin/imagen/suggest-improvement', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ imageUrl: state.image.src, productContext }),
      })
      const data = await res.json() as { suggestions?: string[]; error?: string }
      if (data.error) throw new Error(data.error)
      onChange({ suggestions: data.suggestions ?? [], loadingSuggestions: false })
    } catch (err) {
      onChange({ error: err instanceof Error ? err.message : 'Failed', loadingSuggestions: false })
    }
  }

  const handleGenerate = async () => {
    if (!state.prompt.trim()) return
    onChange({ generating: true, error: null, variants: [] })
    try {
      const res  = await fetch('/api/admin/imagen/improve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ improvementPrompt: state.prompt, productContext }),
      })
      const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string }
      if (data.error) throw new Error(data.error)
      const variants: GeneratedImage[] = (data.images ?? []).map(img => ({
        tempId:   tempId(),
        base64:   img.base64,
        mimeType: img.mimeType,
        inQueue:  false,
      }))
      onChange({ variants, generating: false })
    } catch (err) {
      onChange({ error: err instanceof Error ? err.message : 'Failed', generating: false })
    }
  }

  const handleVariantQueue = (variant: GeneratedImage) => {
    onAddVariantToQueue(variant)
    onChange({ variants: state.variants.map(v => v.tempId === variant.tempId ? { ...v, inQueue: true } : v) })
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-brand-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-brand-cream rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-mist">
          <h3 className="font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
            ✨ Improve Image
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-brand-mist text-brand-charcoal/50 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Two-column: original + variants */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-brand-charcoal/50 mb-2 uppercase tracking-wide">Original</p>
              <img
                src={state.image.src}
                alt={state.image.alt ?? 'Original'}
                className="w-full aspect-square object-cover rounded-xl border border-brand-mist"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-brand-charcoal/50 mb-2 uppercase tracking-wide">Improved Variants</p>
              {state.generating ? (
                <div className="w-full aspect-square rounded-xl bg-brand-mist animate-pulse flex items-center justify-center text-sm text-brand-charcoal/40">
                  Generating…
                </div>
              ) : state.variants.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {state.variants.map(v => (
                    <ModalVariantTile key={v.tempId} variant={v} onUse={() => handleVariantQueue(v)} />
                  ))}
                </div>
              ) : (
                <div className="w-full aspect-square rounded-xl border-2 border-dashed border-brand-mist flex items-center justify-center text-sm text-brand-charcoal/30">
                  Generate to see results
                </div>
              )}
            </div>
          </div>

          {/* Improvement prompt */}
          <div>
            <label className="block text-xs font-semibold text-brand-charcoal/60 mb-1.5">
              Improvement Direction
            </label>
            {state.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {state.suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => onChange({ prompt: s })}
                    className="px-2.5 py-1 text-xs rounded-full bg-brand-mist text-brand-charcoal/70 border border-brand-mist hover:border-brand-purple/30 hover:text-brand-purple transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={state.prompt}
              onChange={e => onChange({ prompt: e.target.value })}
              rows={2}
              placeholder="e.g. Make the background warmer, add soft bokeh, enhance product sharpness"
              className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30 resize-y"
            />
          </div>

          {state.error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">⚠ {state.error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleSuggestImprovements}
              disabled={state.loadingSuggestions}
              className="flex-1 py-2 rounded-xl text-sm font-semibold border border-brand-mist text-brand-charcoal/70 hover:bg-brand-mist transition-colors disabled:opacity-50"
            >
              {state.loadingSuggestions ? 'Suggesting…' : '💡 Suggest Improvements'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={state.generating || !state.prompt.trim()}
              className="flex-1 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-brand-coral to-brand-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.generating ? '✨ Generating…' : '✨ Generate Improved'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Upload Queue Bar ─────────────────────────────────────────────────────────

function UploadQueueBar({
  queue,
  productId,
  variantId,
  onClear,
  onUploadComplete,
}: {
  queue: QueuedImage[]
  productId: string
  variantId?: string
  onClear: () => void
  onUploadComplete: (newImageIds: string[]) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [results,   setResults]   = useState<{ tempId: string; state: 'done' | 'error'; msg?: string }[]>([])

  const handleUpload = async () => {
    if (uploading || queue.length === 0) return
    setUploading(true)
    setResults([])
    try {
      const res = await fetch('/api/admin/imagen/upload-to-shopify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          productId,
          ...(variantId ? { variantId } : {}),
          images: queue.map(q => ({ base64: q.base64, mimeType: q.mimeType, alt: q.alt })),
        }),
      })
      const data = await res.json() as {
        uploaded: number
        errors: string[]
        results: { index: number; mediaId?: string; error?: string }[]
      }
      const newResults = data.results.map((r, i) => ({
        tempId: queue[i]?.tempId ?? '',
        state:  (r.mediaId ? 'done' : 'error') as 'done' | 'error',
        msg:    r.error,
      }))
      setResults(newResults)
      // Trigger parent refresh after a moment
      if (data.uploaded > 0) {
        setTimeout(() => { onUploadComplete([]) }, 1500)
      }
    } finally {
      setUploading(false)
    }
  }

  const getItemState = (tempId: string) => results.find(r => r.tempId === tempId)

  return (
    <div className="border-t border-brand-mist pt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-brand-charcoal">
          Upload Queue
          <span className="ml-2 text-xs font-normal text-brand-charcoal/50">
            {queue.length} image{queue.length !== 1 ? 's' : ''} ready
          </span>
        </p>
        <button
          onClick={onClear}
          disabled={uploading}
          className="text-xs text-brand-charcoal/40 hover:text-red-500 transition-colors disabled:opacity-40"
        >
          Clear queue
        </button>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
        {queue.map(img => {
          const state = getItemState(img.tempId)
          return (
            <div key={img.tempId} className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden">
              <img
                src={`data:${img.mimeType};base64,${img.base64}`}
                alt={img.alt}
                className="w-full h-full object-cover"
              />
              {state && (
                <div className={[
                  'absolute inset-0 flex items-center justify-center text-base rounded-lg',
                  state.state === 'done' ? 'bg-green-500/80' : 'bg-red-500/80',
                ].join(' ')}>
                  {state.state === 'done' ? '✓' : '✗'}
                </div>
              )}
              {uploading && !state && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={handleUpload}
        disabled={uploading || queue.length === 0}
        className="w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-brand-coral to-brand-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {uploading ? '⬆ Uploading to Shopify…' : `⬆ Upload ${queue.length} Image${queue.length !== 1 ? 's' : ''} to Shopify`}
      </button>

      {results.some(r => r.state === 'error') && (
        <div className="mt-2 space-y-1">
          {results.filter(r => r.state === 'error').map(r => (
            <p key={r.tempId} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
              ⚠ {r.msg ?? 'Upload failed'}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main ImageManager ────────────────────────────────────────────────────────

export function ImageManager({
  deal,
  initialImages,
  onImagesChange,
}: {
  deal: Deal
  initialImages: AdminProductImage[]
  onImagesChange?: () => void
}) {
  const [open,              setOpen]              = useState(false)
  const [images,            setImages]            = useState<AdminProductImage[]>(initialImages)
  const [queue,             setQueue]             = useState<QueuedImage[]>([])
  const [prompts,           setPrompts]           = useState<string[]>([])
  const [loadingPrompts,    setLoadingPrompts]    = useState(false)
  const [promptError,       setPromptError]       = useState<string | null>(null)
  const [activePrompt,      setActivePrompt]      = useState('')
  const [style,             setStyle]             = useState('lifestyle')
  const [genCount,          setGenCount]          = useState(2)
  const [generating,        setGenerating]        = useState(false)
  const [genError,          setGenError]          = useState<string | null>(null)
  const [generatedImages,   setGeneratedImages]   = useState<GeneratedImage[]>([])
  const [improveModal,      setImproveModal]      = useState<ImproveModalState | null>(null)
  const [deletingIds,       setDeletingIds]       = useState<Set<number>>(new Set())
  const [reordering,        setReordering]        = useState(false)
  /** IDs of existing Shopify images selected as visual references for generation */
  const [referenceImageIds, setReferenceImageIds] = useState<Set<number>>(new Set())
  /** Optional variant to target for image generation (affects prompt context + upload association) */
  const [targetVariantId,   setTargetVariantId]   = useState<string>('')

  const multiVariant = (deal.variants?.length ?? 0) > 1
  const targetVariant = multiVariant && targetVariantId
    ? deal.variants?.find(v => v.id === targetVariantId)
    : undefined
  const variantLabel = targetVariant
    ? targetVariant.selectedOptions.map(o => o.value).join(' / ')
    : undefined
  const productContext = variantLabel
    ? `${deal.seoTitle} by ${deal.brand} — ${variantLabel}`
    : `${deal.seoTitle} by ${deal.brand}`

  // ── Suggest prompts ────────────────────────────────────────────────────────
  const fetchPrompts = useCallback(async () => {
    setLoadingPrompts(true)
    setPromptError(null)
    try {
      const res  = await fetch('/api/admin/imagen/suggest-prompts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          title:       deal.seoTitle,
          description: deal.fullStory,
          tags:        deal.category,
          vendor:      deal.brand,
        }),
      })
      const data = await res.json() as { prompts?: string[]; error?: string }
      if (data.error) throw new Error(data.error)
      setPrompts(data.prompts ?? [])
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Failed to load suggestions')
    } finally {
      setLoadingPrompts(false)
    }
  }, [deal.seoTitle, deal.fullStory, deal.category, deal.brand])

  useEffect(() => {
    if (open && prompts.length === 0 && !loadingPrompts) fetchPrompts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Generate images ────────────────────────────────────────────────────────
  const buildGenerateBody = (overrideCount?: number) => {
    const referenceImageUrls = images
      .filter(img => referenceImageIds.has(img.id))
      .map(img => img.src)
    return {
      prompt:             activePrompt,
      style,
      count:              overrideCount ?? genCount,
      referenceImageUrls,
      productTitle:       deal.seoTitle,
    }
  }

  const handleGenerate = async () => {
    if (!activePrompt.trim() || generating) return
    setGenerating(true)
    setGenError(null)
    try {
      const res  = await fetch('/api/admin/imagen/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildGenerateBody()),
      })
      const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string }
      if (data.error) throw new Error(data.error)
      const newImgs: GeneratedImage[] = (data.images ?? []).map(img => ({
        tempId:   tempId(),
        base64:   img.base64,
        mimeType: img.mimeType,
        inQueue:  false,
      }))
      setGeneratedImages(prev => [...newImgs, ...prev].slice(0, 20))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleRegenerate = async (img: GeneratedImage) => {
    if (!activePrompt.trim() || generating) return
    setGenerating(true)
    setGenError(null)
    try {
      const res  = await fetch('/api/admin/imagen/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildGenerateBody(1)),
      })
      const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string }
      if (data.error) throw new Error(data.error)
      const newImg: GeneratedImage = {
        tempId:   tempId(),
        base64:   data.images?.[0]?.base64 ?? '',
        mimeType: data.images?.[0]?.mimeType ?? 'image/jpeg',
        inQueue:  false,
      }
      setGeneratedImages(prev => prev.map(g => g.tempId === img.tempId ? newImg : g))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Regeneration failed')
    } finally {
      setGenerating(false)
    }
  }

  // ── Queue management ───────────────────────────────────────────────────────
  const addToQueue = (img: GeneratedImage, alt = '') => {
    setQueue(prev => {
      if (prev.length >= 10) return prev  // max 10 queued
      return [...prev, {
        tempId:       img.tempId,
        base64:       img.base64,
        mimeType:     img.mimeType,
        alt:          alt || `${deal.seoTitle} product image`,
        uploadState:  'pending',
      }]
    })
    setGeneratedImages(prev => prev.map(g => g.tempId === img.tempId ? { ...g, inQueue: true } : g))
  }

  const removeFromQueue = (tempId: string) => {
    setQueue(prev => prev.filter(q => q.tempId !== tempId))
    setGeneratedImages(prev => prev.map(g => g.tempId === tempId ? { ...g, inQueue: false } : g))
  }

  const clearQueue = () => {
    const queuedIds = new Set(queue.map(q => q.tempId))
    setQueue([])
    setGeneratedImages(prev => prev.map(g => queuedIds.has(g.tempId) ? { ...g, inQueue: false } : g))
  }

  // ── Delete image ───────────────────────────────────────────────────────────
  const handleDeleteImage = async (img: AdminProductImage) => {
    setDeletingIds(prev => new Set(prev).add(img.id))
    try {
      await fetch('/api/admin/imagen/delete-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId: deal.shopifyProductId, imageId: img.id }),
      })
      setImages(prev => prev.filter(i => i.id !== img.id))
    } catch {
      // silently ignore — image will still show
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(img.id); return s })
    }
  }

  // ── Reorder ────────────────────────────────────────────────────────────────
  const handleMove = async (index: number, direction: 'left' | 'right') => {
    const newImages = [...images]
    const swapIndex = direction === 'left' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= newImages.length) return
    ;[newImages[index], newImages[swapIndex]] = [newImages[swapIndex]!, newImages[index]!]
    setImages(newImages)
    setReordering(true)
    try {
      await fetch('/api/admin/imagen/reorder-images', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          productId: deal.shopifyProductId,
          imageIds:  newImages.map(i => i.id),
        }),
      })
    } finally {
      setReordering(false)
    }
  }

  // ── Upload complete → refresh images from Shopify ──────────────────────────
  const handleUploadComplete = async () => {
    try {
      const res  = await fetch(`/api/admin/imagen/images?productId=${encodeURIComponent(deal.shopifyProductId)}`)
      const data = await res.json() as { images: AdminProductImage[] }
      if (data.images) setImages(data.images)
    } catch {
      // Just clear the queue and let the page refresh handle it
    }
    setQueue([])
    onImagesChange?.()
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-brand-mist/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
            🖼 Image Manager
          </span>
          <span className="text-xs bg-brand-mist text-brand-charcoal/60 px-2 py-0.5 rounded-full font-medium">
            {images.length} image{images.length !== 1 ? 's' : ''}
          </span>
          {reordering && (
            <span className="text-xs text-brand-charcoal/40">Saving order…</span>
          )}
        </div>
        <span className={`text-brand-charcoal/40 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-6 border-t border-brand-mist pt-5">

          {/* ── Section 1: Existing Images ─────────────────────────────────── */}
          <div>
            <h4 className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wide mb-3">
              Shopify Images
            </h4>
            {images.length > 0 ? (
              <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                {images.map((img, idx) => (
                  deletingIds.has(img.id) ? (
                    <div key={img.id} className="aspect-square rounded-xl bg-brand-mist animate-pulse" />
                  ) : (
                    <ImageTile
                      key={img.id}
                      image={img}
                      isFirst={idx === 0}
                      isLast={idx === images.length - 1}
                      onDelete={() => handleDeleteImage(img)}
                      onImprove={() => setImproveModal({
                        image:              img,
                        prompt:             '',
                        loadingSuggestions: false,
                        suggestions:        [],
                        generating:         false,
                        variants:           [],
                        error:              null,
                      })}
                      onMoveLeft={() => handleMove(idx, 'left')}
                      onMoveRight={() => handleMove(idx, 'right')}
                    />
                  )
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-charcoal/40 italic py-4 text-center">
                No images yet. Generate and upload below.
              </p>
            )}
          </div>

          {/* ── Section 2: Prompt Suggestions ─────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-brand-charcoal/50 uppercase tracking-wide">
                AI Prompt Suggestions
              </h4>
              <button
                onClick={fetchPrompts}
                disabled={loadingPrompts}
                className="text-xs text-brand-purple hover:text-brand-purple/70 transition-colors disabled:opacity-50"
              >
                {loadingPrompts ? 'Loading…' : '↻ Refresh'}
              </button>
            </div>

            {loadingPrompts ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="shrink-0 h-8 w-40 rounded-full bg-brand-mist animate-pulse" />
                ))}
              </div>
            ) : promptError ? (
              <p className="text-xs text-red-500">{promptError}</p>
            ) : prompts.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {prompts.map(p => (
                  <button
                    key={p}
                    onClick={() => setActivePrompt(p)}
                    className={[
                      'shrink-0 px-3 py-1.5 text-xs rounded-full border transition-all',
                      activePrompt === p
                        ? 'bg-brand-purple text-white border-brand-purple'
                        : 'bg-white border-brand-mist text-brand-charcoal/70 hover:border-brand-purple/30 hover:text-brand-purple',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : null}

            {/* Freeform prompt input */}
            <textarea
              value={activePrompt}
              onChange={e => setActivePrompt(e.target.value)}
              rows={3}
              placeholder="Or write your own prompt… e.g. 'Minimalist studio shot with warm coral tones, soft shadows, single product centered'"
              className="w-full mt-3 border border-brand-mist rounded-xl px-4 py-3 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30 resize-y"
            />
          </div>

          {/* ── Section 3: Generation Panel ───────────────────────────────── */}
          <div className="space-y-3">
            <div className={`grid gap-3 ${multiVariant ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {/* Style */}
              <div>
                <label className="block text-xs font-medium text-brand-charcoal/50 mb-1">Style</label>
                <select
                  value={style}
                  onChange={e => setStyle(e.target.value)}
                  className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30 bg-white"
                >
                  {STYLES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              {/* Count */}
              <div>
                <label className="block text-xs font-medium text-brand-charcoal/50 mb-1">Generate</label>
                <div className="flex gap-2">
                  {[1, 2, 4].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGenCount(n)}
                      className={[
                        'flex-1 py-2 rounded-xl text-sm font-semibold border transition-all',
                        genCount === n
                          ? 'bg-brand-purple text-white border-brand-purple'
                          : 'bg-white border-brand-mist text-brand-charcoal/60 hover:border-brand-purple/30',
                      ].join(' ')}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {/* Variant target */}
              {multiVariant && (
                <div>
                  <label className="block text-xs font-medium text-brand-charcoal/50 mb-1">For Variant</label>
                  <select
                    value={targetVariantId}
                    onChange={e => setTargetVariantId(e.target.value)}
                    className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30 bg-white"
                  >
                    <option value="">All variants (product-level)</option>
                    {deal.variants?.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.selectedOptions.map(o => o.value).join(' / ')}
                        {!v.availableForSale ? ' (OOS)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Reference Images row */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-brand-charcoal/60">Feature the product from:</span>
                {referenceImageIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReferenceImageIds(new Set())}
                    className="text-xs text-brand-charcoal/40 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                ) : (
                  <span className="text-xs text-brand-charcoal/30 italic">None selected</span>
                )}
                {referenceImageIds.size === 1 && (
                  <span
                    title="Only the first selected image will be used to identify the product"
                    className="ml-auto text-[10px] text-brand-charcoal/30 cursor-help underline decoration-dotted"
                  >
                    1 reference active ⓘ
                  </span>
                )}
              </div>

              {images.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {images.map(img => {
                    const selected = referenceImageIds.has(img.id)
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          setReferenceImageIds(prev => {
                            const next = new Set(prev)
                            if (next.has(img.id)) next.delete(img.id)
                            else next.add(img.id)
                            return next
                          })
                        }}
                        className={[
                          'relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all',
                          selected
                            ? 'border-brand-coral ring-2 ring-brand-coral/20'
                            : 'border-transparent hover:border-brand-mist',
                        ].join(' ')}
                        title={selected ? 'Remove as reference' : 'Use as reference'}
                      >
                        <img
                          src={img.src}
                          alt={img.alt ?? ''}
                          className="w-full h-full object-cover"
                        />
                        {selected && (
                          <div className="absolute inset-0 flex items-center justify-center bg-brand-coral/20">
                            <span className="w-5 h-5 rounded-full bg-brand-coral text-white text-[10px] font-bold flex items-center justify-center shadow">
                              ✓
                            </span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-brand-charcoal/30 italic">No existing images to use as references.</p>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !activePrompt.trim()}
              className="w-full py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-brand-coral to-brand-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? '✨ Generating…' : '✨ Generate Images'}
            </button>

            {genError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                ⚠ {genError}
              </p>
            )}

            {/* Generated Previews Tray */}
            {(generating || generatedImages.length > 0) && (
              <div className="overflow-y-auto" style={{ maxHeight: '220px' }}>
                <div className="flex gap-3 flex-wrap">
                  {generating && [...Array(genCount)].map((_, i) => (
                    <ImageSkeleton key={`skel-${i}`} />
                  ))}
                  {generatedImages.map(img => (
                    <GeneratedCard
                      key={img.tempId}
                      img={img}
                      onAddToQueue={() => addToQueue(img)}
                      onRemove={() => setGeneratedImages(prev => prev.filter(g => g.tempId !== img.tempId))}
                      onRegenerate={() => handleRegenerate(img)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Section 5: Upload Queue ────────────────────────────────────── */}
          {queue.length > 0 && (
            <UploadQueueBar
              queue={queue}
              productId={deal.shopifyProductId}
              {...(targetVariantId ? { variantId: targetVariantId } : {})}
              onClear={clearQueue}
              onUploadComplete={handleUploadComplete}
            />
          )}
        </div>
      )}

      {/* Improvement Modal */}
      {improveModal && (
        <ImprovementModal
          state={improveModal}
          productContext={productContext}
          onClose={() => setImproveModal(null)}
          onAddVariantToQueue={img => {
            addToQueue(img)
            setImproveModal(null)
          }}
          onChange={patch => setImproveModal(prev => prev ? { ...prev, ...patch } : null)}
        />
      )}
    </div>
  )
}
