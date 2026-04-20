import { useEffect, useState } from 'react'
import { Link } from 'react-router'

const STORAGE_KEY = 'xdipx:recently-browsed'
const MAX_ITEMS = 10

type TileProduct = {
  handle: string
  title: string
  image: string | null
  price: number
  compareAtPrice: number | null
}

interface RecentlyBrowsedProps {
  currentHandle: string
}

export default function RecentlyBrowsed({ currentHandle }: RecentlyBrowsedProps) {
  const [mounted, setMounted] = useState(false)
  const [products, setProducts] = useState<TileProduct[]>([])

  useEffect(() => {
    setMounted(true)

    let list: string[] = []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      list = raw ? (JSON.parse(raw) as string[]) : []
    } catch {
      list = []
    }

    const priorHandles = list.filter(h => h !== currentHandle).slice(0, MAX_ITEMS)

    const next = [currentHandle, ...list.filter(h => h !== currentHandle)].slice(0, MAX_ITEMS)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}

    if (priorHandles.length === 0) return

    const controller = new AbortController()
    fetch(`/api/products-by-handles?handles=${encodeURIComponent(priorHandles.join(','))}`, {
      signal: controller.signal,
    })
      .then(r => r.json() as Promise<{ products: TileProduct[] }>)
      .then(data => setProducts(data.products ?? []))
      .catch(() => {})
    return () => controller.abort()
  }, [currentHandle])

  if (!mounted || products.length === 0) return null

  return (
    <section className="mt-12 mb-6">
      <h2 className="font-display text-2xl font-bold text-ink mb-4">Recently browsed</h2>
      <ul className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin">
        {products.map(p => (
          <li key={p.handle} className="flex-shrink-0 w-40 snap-start">
            <Link to={`/products/${p.handle}`} className="block group">
              <div className="aspect-square rounded-xl overflow-hidden bg-cream-2">
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink/10 text-4xl">♥</div>
                )}
              </div>
              <h3 className="mt-2 text-sm font-medium text-ink line-clamp-2 group-hover:text-coral transition-colors">
                {p.title}
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-coral font-bold text-sm">${p.price.toFixed(2)}</span>
                {p.compareAtPrice && p.compareAtPrice > p.price && (
                  <span className="text-ink/40 text-xs line-through">${p.compareAtPrice.toFixed(2)}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
