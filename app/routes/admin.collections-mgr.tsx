import type { ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState, useEffect, useMemo } from 'react'
import { getShopifyCollections, updateCollectionDescription } from '~/lib/shopify.server'
import { requireAdmin } from '~/lib/session.server'

type CollectionItem = Awaited<ReturnType<typeof getShopifyCollections>>[number]

export const meta: MetaFunction = () => [{ title: 'Collections Mgr. — xdipx Admin' }]

export async function loader({ request }: { request: Request }) {
  await requireAdmin(request)
  const collections = await getShopifyCollections()
  return { collections }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = form.get('intent')

  if (intent === 'update-description') {
    const collectionId = form.get('collectionId') as string
    const description = form.get('description') as string
    if (!collectionId) return { error: 'Missing collectionId' }
    await updateCollectionDescription(collectionId, description ?? '')
    return { ok: true, intent: 'update-description' }
  }

  return null
}

interface ProductThumb {
  id: string
  title: string
  images: { url: string; altText: string }[]
}

const STYLES = [
  { value: 'lifestyle',    label: 'Lifestyle' },
  { value: 'studio-white', label: 'Studio White' },
  { value: 'dark-moody',   label: 'Dark Moody' },
  { value: 'flat-lay',     label: 'Flat Lay' },
  { value: 'close-up',     label: 'Close-up' },
]

export default function CollectionsManager() {
  const { collections } = useLoaderData<typeof loader>()
  const [expandedHandle, setExpandedHandle] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductThumb[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Image generation state
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState('lifestyle')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generatedImages, setGeneratedImages] = useState<{ base64: string; mimeType: string }[]>([])
  const [settingImage, setSettingImage] = useState<number | null>(null)
  const [collectionImages, setCollectionImages] = useState<Record<string, string>>({})

  // Reference image selection
  const [selectedRefImages, setSelectedRefImages] = useState<Set<string>>(new Set())

  // Search + sort
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'title' | 'handle' | 'productsCount'>('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() =>
    collections
      .filter(c => {
        if (!search) return true
        const q = search.toLowerCase()
        return c.title.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        if (sortKey === 'productsCount') return (a.productsCount - b.productsCount) * dir
        return a[sortKey].localeCompare(b[sortKey]) * dir
      }),
    [collections, search, sortKey, sortDir],
  )

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Initialize collection images from loader data
  useEffect(() => {
    const imgs: Record<string, string> = {}
    for (const c of collections) {
      if (c.image?.url) imgs[c.handle] = c.image.url
    }
    setCollectionImages(imgs)
  }, [collections])

  // Fetch products when expanding a collection
  useEffect(() => {
    if (!expandedHandle) return
    setLoadingProducts(true)
    setProducts([])
    setPrompt('')
    setGeneratedImages([])
    setSelectedRefImages(new Set())
    fetch(`/api/admin/collection-products?handle=${expandedHandle}`)
      .then(r => r.json() as Promise<{ products: ProductThumb[] }>)
      .then(data => setProducts(data.products))
      .catch(() => {})
      .finally(() => setLoadingProducts(false))
  }, [expandedHandle])

  function toggleRow(handle: string) {
    setExpandedHandle(prev => prev === handle ? null : handle)
  }

  function toggleRefImage(imageUrl: string) {
    setSelectedRefImages(prev => {
      const next = new Set(prev)
      if (next.has(imageUrl)) next.delete(imageUrl)
      else next.add(imageUrl)
      return next
    })
  }

  async function handleGenerate(collection: CollectionItem) {
    if (!prompt.trim() || generating) return
    setGenerating(true)
    setGeneratedImages([])
    setGenerateError(null)
    try {
      const referenceImageUrls = Array.from(selectedRefImages)

      const res = await fetch('/api/admin/imagen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          style,
          count: 1,
          aspectRatio: '4:3',
          referenceImageUrls,
          productTitle: collection.title,
        }),
      })
      const data = await res.json() as { images?: { base64: string; mimeType: string }[]; error?: string }
      if (!res.ok || data.error) {
        setGenerateError(data.error ?? `Generation failed (${res.status})`)
      } else {
        setGeneratedImages(data.images ?? [])
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Network error — could not reach generation API')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSetCollectionImage(collection: CollectionItem, imageIndex: number) {
    const img = generatedImages[imageIndex]
    if (!img || settingImage !== null) return
    setSettingImage(imageIndex)
    try {
      const res = await fetch('/api/admin/collection-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionId: collection.id,
          base64: img.base64,
          mimeType: img.mimeType,
          alt: `${collection.title} category image`,
        }),
      })
      const data = await res.json() as { ok?: boolean; imageUrl?: string; error?: string }
      if (data.ok && data.imageUrl) {
        setCollectionImages(prev => ({ ...prev, [collection.handle]: data.imageUrl! }))
      } else if (data.error) {
        alert(`Failed to set image: ${data.error}`)
      }
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSettingImage(null)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Collections Manager
        </h1>
        <p className="text-sm text-ink/50 mt-1">
          Browse Shopify collections, edit descriptions, and generate category images.
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search collections..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-cream-2 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sage/30 text-ink"
          />
        </div>
      </div>

      {/* Collections list */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {/* Column headers */}
        <div
          className="hidden md:grid px-5 py-3 bg-cream-2 text-xs font-semibold text-ink/50 uppercase tracking-wide gap-3"
          style={{ gridTemplateColumns: '1fr 10rem 5rem 3rem' }}
        >
          <button type="button" onClick={() => toggleSort('title')} className="flex items-center gap-1 text-left hover:text-ink transition-colors">
            Collection
            {sortKey === 'title' && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}>
                <path d="M6 15l6-6 6 6" />
              </svg>
            )}
          </button>
          <button type="button" onClick={() => toggleSort('handle')} className="flex items-center gap-1 text-left hover:text-ink transition-colors">
            Handle
            {sortKey === 'handle' && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}>
                <path d="M6 15l6-6 6 6" />
              </svg>
            )}
          </button>
          <button type="button" onClick={() => toggleSort('productsCount')} className="flex items-center gap-1 justify-center hover:text-ink transition-colors">
            Products
            {sortKey === 'productsCount' && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}>
                <path d="M6 15l6-6 6 6" />
              </svg>
            )}
          </button>
          <span />
        </div>

        {filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-ink/40">
            {search ? `No collections matching "${search}".` : 'No collections found in Shopify.'}
          </p>
        )}

        {filtered.map(c => {
          const isExpanded = expandedHandle === c.handle
          const imageUrl = collectionImages[c.handle]
          return (
            <div key={c.handle} className="border-t border-cream-2">
              {/* Row */}
              <button
                type="button"
                onClick={() => toggleRow(c.handle)}
                className="w-full px-5 py-3.5 flex items-center md:grid gap-3 text-left hover:bg-cream-2/40 transition-colors"
                style={{ gridTemplateColumns: '1fr 10rem 5rem 3rem' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={c.title}
                      className="w-8 h-8 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-cream-2 flex items-center justify-center shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink/20">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                  )}
                  <span className="text-sm font-medium text-ink truncate">{c.title}</span>
                </div>
                <span className="text-xs font-mono text-ink/40 hidden md:block">{c.handle}</span>
                <span className="text-xs font-semibold text-ink/60 text-center hidden md:block">
                  {c.productsCount}
                </span>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className={`text-ink/30 transition-transform shrink-0 ml-auto md:ml-0 ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {/* Expanded panel */}
              {isExpanded && (
                <ExpandedPanel
                  collection={c}
                  products={products}
                  loadingProducts={loadingProducts}
                  prompt={prompt}
                  setPrompt={setPrompt}
                  style={style}
                  setStyle={setStyle}
                  generating={generating}
                  generateError={generateError}
                  generatedImages={generatedImages}
                  settingImage={settingImage}
                  onGenerate={() => handleGenerate(c)}
                  onSetImage={(idx) => handleSetCollectionImage(c, idx)}
                  currentImageUrl={collectionImages[c.handle]}
                  selectedRefImages={selectedRefImages}
                  onToggleRefImage={toggleRefImage}
                  onClearRefImages={() => setSelectedRefImages(new Set())}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExpandedPanel({
  collection,
  products,
  loadingProducts,
  prompt,
  setPrompt,
  style,
  setStyle,
  generating,
  generateError,
  generatedImages,
  settingImage,
  onGenerate,
  onSetImage,
  currentImageUrl,
  selectedRefImages,
  onToggleRefImage,
  onClearRefImages,
}: {
  collection: { id: string; handle: string; title: string; descriptionHtml: string }
  products: ProductThumb[]
  loadingProducts: boolean
  prompt: string
  setPrompt: (v: string) => void
  style: string
  setStyle: (v: string) => void
  generating: boolean
  generateError: string | null
  generatedImages: { base64: string; mimeType: string }[]
  settingImage: number | null
  onGenerate: () => void
  onSetImage: (idx: number) => void
  currentImageUrl: string | undefined
  selectedRefImages: Set<string>
  onToggleRefImage: (imageUrl: string) => void
  onClearRefImages: () => void
}) {
  const descFetcher = useFetcher()
  const descSaved = descFetcher.state === 'idle' && descFetcher.data && typeof descFetcher.data === 'object' && 'ok' in descFetcher.data
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)

  return (
    <div className="px-5 pb-5 space-y-5 bg-cream-2/20">
      {/* Description editor */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h3
          className="text-xs font-bold text-ink/50 uppercase tracking-wide mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Description
        </h3>
        <descFetcher.Form method="post">
          <input type="hidden" name="intent" value="update-description" />
          <input type="hidden" name="collectionId" value={collection.id} />
          <textarea
            name="description"
            defaultValue={collection.descriptionHtml}
            rows={4}
            className="w-full text-sm border border-cream-2 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sage/30 text-ink resize-y"
            placeholder="Collection description (HTML supported)"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              type="submit"
              disabled={descFetcher.state !== 'idle'}
              className="text-xs font-semibold px-4 py-1.5 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {descFetcher.state !== 'idle' ? 'Saving...' : 'Save Description'}
            </button>
            {descSaved && (
              <span className="text-xs text-green-600 font-semibold">Saved</span>
            )}
          </div>
        </descFetcher.Form>
      </div>

      {/* Product thumbnails — click to expand and select reference images */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <h3
            className="text-xs font-bold text-ink/50 uppercase tracking-wide"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Products in Collection ({products.length})
          </h3>
          <span className="text-[11px] text-ink/30">— click product to browse images, then select references</span>
          {selectedRefImages.size > 0 && (
            <>
              <span className="ml-auto text-[11px] font-medium text-coral">
                {selectedRefImages.size} selected
              </span>
              <button
                type="button"
                onClick={onClearRefImages}
                className="text-[11px] text-ink/40 hover:text-red-500 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
        {loadingProducts ? (
          <div className="py-6 text-center text-sm text-ink/40">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="py-6 text-center text-sm text-ink/40">No products in this collection.</div>
        ) : (
          <div>
            {/* Product thumbnail grid */}
            <div className="flex flex-wrap gap-2">
              {products.map(p => {
                const hasSelected = p.images.some(img => selectedRefImages.has(img.url))
                const isExpanded = expandedProductId === p.id
                const thumbUrl = p.images[0]?.url
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setExpandedProductId(prev => prev === p.id ? null : p.id)}
                    className={[
                      'group relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all',
                      isExpanded
                        ? 'border-sage ring-2 ring-sage/20'
                        : hasSelected
                          ? 'border-coral ring-2 ring-coral/20'
                          : 'border-transparent hover:border-cream-2',
                    ].join(' ')}
                    title={p.title}
                  >
                    {thumbUrl ? (
                      <img src={thumbUrl} alt={p.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-cream-2 flex items-center justify-center">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink/20">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                    )}
                    {/* Image count badge */}
                    {p.images.length > 1 && (
                      <span className="absolute bottom-0.5 right-0.5 min-w-[16px] h-4 px-0.5 rounded bg-black/60 text-white text-[9px] font-bold flex items-center justify-center">
                        {p.images.length}
                      </span>
                    )}
                    {/* Selected count badge */}
                    {hasSelected && (
                      <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-coral text-white text-[9px] font-bold flex items-center justify-center shadow">
                        ✓
                      </span>
                    )}
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-ink text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      {p.title}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Expanded image strip for selected product */}
            {expandedProductId && (() => {
              const product = products.find(p => p.id === expandedProductId)
              if (!product || product.images.length === 0) return null
              return (
                <div className="mt-3 pt-3 border-t border-cream-2/50">
                  <p className="text-[11px] font-medium text-ink/60 mb-2">
                    {product.title} — {product.images.length} image{product.images.length !== 1 ? 's' : ''} (click to select as reference)
                  </p>
                  <div className="flex flex-wrap gap-3 py-2" style={{ overflow: 'visible' }}>
                    {product.images.map((img, idx) => {
                      const selected = selectedRefImages.has(img.url)
                      return (
                        <button
                          key={img.url}
                          type="button"
                          onClick={() => onToggleRefImage(img.url)}
                          className={[
                            'relative shrink-0 w-20 h-20 rounded-lg border-2 transition-all duration-200 origin-center hover:scale-150 hover:z-10',
                            selected
                              ? 'border-coral ring-2 ring-coral/20'
                              : 'border-transparent hover:border-cream-2',
                          ].join(' ')}
                          title={`Image ${idx + 1}${selected ? ' (selected)' : ''}`}
                        >
                          <img
                            src={img.url}
                            alt={img.altText || `${product.title} image ${idx + 1}`}
                            className="w-full h-full object-cover rounded-md"
                          />
                          {selected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-coral/20 rounded-md">
                              <span className="w-5 h-5 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center shadow">
                                ✓
                              </span>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Category image generator */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h3
          className="text-xs font-bold text-ink/50 uppercase tracking-wide mb-3"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Category Image
        </h3>

        {/* Current image */}
        {currentImageUrl && (
          <div className="mb-3">
            <p className="text-xs text-ink/40 mb-1">Current image:</p>
            <img
              src={currentImageUrl}
              alt={collection.title}
              className="w-40 h-28 rounded-lg object-cover border border-cream-2"
            />
          </div>
        )}

        {/* Prompt + style */}
        <div className="space-y-2 mb-3">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={2}
            className="w-full text-sm border border-cream-2 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sage/30 text-ink resize-y"
            placeholder={`Describe the category image for "${collection.title}"...`}
          />
          <div className="flex items-center gap-3">
            <select
              value={style}
              onChange={e => setStyle(e.target.value)}
              className="text-xs border border-cream-2 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage/30 text-ink"
            >
              {STYLES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={onGenerate}
              disabled={!prompt.trim() || generating}
              className="text-xs font-semibold px-4 py-1.5 bg-sage text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {generating ? (
                <>
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : 'Generate Images'}
            </button>
          </div>
          {selectedRefImages.size > 0 && (
            <p className="text-[11px] text-coral/70">
              {selectedRefImages.size} reference image{selectedRefImages.size !== 1 ? 's' : ''} will be included in generation.
            </p>
          )}
        </div>

        {/* Generation error */}
        {generateError && (
          <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-xs font-semibold text-red-700 mb-0.5">Image generation failed</p>
            <p className="text-[11px] text-red-600">{generateError}</p>
          </div>
        )}

        {/* Generated images */}
        {generatedImages.length > 0 && (
          <div>
            <p className="text-xs text-ink/50 mb-2 font-medium">Generated — click to set as collection image:</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {generatedImages.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSetImage(i)}
                  disabled={settingImage !== null}
                  className="relative group rounded-lg overflow-hidden border-2 border-transparent hover:border-sage transition-colors disabled:opacity-50"
                >
                  <img
                    src={`data:${img.mimeType};base64,${img.base64}`}
                    alt={`Generated option ${i + 1}`}
                    className="w-full aspect-[4/3] object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    {settingImage === i ? (
                      <svg className="animate-spin w-6 h-6 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <span className="text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity bg-sage/80 px-2 py-1 rounded">
                        Set as Image
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
