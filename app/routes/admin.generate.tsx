import type { MetaFunction } from 'react-router'
import { useState } from 'react'
import { CopyGenerator } from '~/components/admin/CopyGenerator'

export const meta: MetaFunction = () => [{ title: 'AI Generator — xdipx Admin' }]

export default function AdminGenerate() {
  const [product, setProduct] = useState({
    title:       '',
    brand:       '',
    description: '',
    categories:  [] as string[],
    dealPrice:   undefined as number | undefined,
    msrp:        undefined as number | undefined,
  })
  const [categoriesInput, setCategoriesInput] = useState('')
  const [ready, setReady] = useState(false)

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-brand-charcoal" style={{ fontFamily: 'var(--font-display)' }}>
        AI Generator
      </h1>
      <p className="text-brand-charcoal/60 text-sm">Paste raw Nalpac product data to generate all copy types.</p>

      {/* Product input form */}
      <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        {[
          { label: 'Product Title', key: 'title',  type: 'text' },
          { label: 'Brand',         key: 'brand',  type: 'text' },
          { label: 'Deal Price',    key: 'dealPrice', type: 'number' },
          { label: 'MSRP',          key: 'msrp',   type: 'number' },
        ].map(({ label, key, type }) => (
          <div key={key}>
            <label className="block text-xs font-semibold text-brand-charcoal/60 mb-1">{label}</label>
            <input
              type={type}
              value={(product as Record<string, unknown>)[key] as string ?? ''}
              onChange={e => setProduct(p => ({ ...p, [key]: type === 'number' ? parseFloat(e.target.value) || undefined : e.target.value }))}
              className="w-full border border-brand-mist rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
            />
          </div>
        ))}

        <div>
          <label className="block text-xs font-semibold text-brand-charcoal/60 mb-1">Description (raw Nalpac)</label>
          <textarea
            value={product.description}
            onChange={e => setProduct(p => ({ ...p, description: e.target.value }))}
            rows={5}
            className="w-full border border-brand-mist rounded-xl px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-charcoal/60 mb-1">Sub-Categories (comma separated)</label>
          <input
            type="text"
            value={categoriesInput}
            onChange={e => setCategoriesInput(e.target.value)}
            className="w-full border border-brand-mist rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
            placeholder="Wands, Dual Action and Rabbits"
          />
        </div>

        <button
          onClick={() => {
            setProduct(p => ({ ...p, categories: categoriesInput.split(',').map(c => c.trim()).filter(Boolean) }))
            setReady(true)
          }}
          className="w-full bg-brand-gradient text-white font-bold py-3 rounded-full hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Generate All Copy ✨
        </button>
      </div>

      {/* Generator output */}
      {ready && product.title && (
        <CopyGenerator product={product} />
      )}
    </div>
  )
}
