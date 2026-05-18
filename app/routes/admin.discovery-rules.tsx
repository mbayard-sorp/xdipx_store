import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { requireAdmin } from '~/lib/session.server'
import {
  listAllDiscoveryRules,
  getInventoryMin,
  createDiscoveryRule,
  updateDiscoveryRule,
  deleteDiscoveryRule,
  moveFallbackPin,
  cleanCollectionHandle,
} from '~/lib/discovery-rules.server'
import { invalidateDiscoveryIndex } from '~/lib/discovery.server'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'
import type { Category, DiscoveryRule, DiscoveryRuleType } from '~/types/discovery'
import { CATEGORIES } from '~/types/discovery'

export const meta: MetaFunction = () => [{ title: 'Discovery Rules — xdipx Admin' }]

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)

  const [allRules, inventoryMin] = await Promise.all([
    listAllDiscoveryRules(),
    getInventoryMin(),
  ])

  const exclusions = allRules.filter(
    r => r.ruleType !== 'pin_fallback' && r.ruleType !== 'pin_collection_fallback',
  )
  const pinsByCategory: Record<Category, DiscoveryRule[]> = {
    Pleasure: [], Play: [], Body: [], Wear: [],
  }
  const collectionPinsByCategory: Record<Category, DiscoveryRule[]> = {
    Pleasure: [], Play: [], Body: [], Wear: [],
  }
  for (const rule of allRules) {
    if (!rule.category) continue
    const cat = rule.category as Category
    if (rule.ruleType === 'pin_fallback' && pinsByCategory[cat]) {
      pinsByCategory[cat].push(rule)
    } else if (rule.ruleType === 'pin_collection_fallback' && collectionPinsByCategory[cat]) {
      collectionPinsByCategory[cat].push(rule)
    }
  }
  for (const cat of CATEGORIES) {
    pinsByCategory[cat].sort((a, b) => a.sortOrder - b.sortOrder)
    collectionPinsByCategory[cat].sort((a, b) => a.sortOrder - b.sortOrder)
  }

  return { exclusions, pinsByCategory, collectionPinsByCategory, inventoryMin }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  const form   = await request.formData()
  const intent = form.get('intent') as string

  // --- save_inventory_min ---
  if (intent === 'save_inventory_min') {
    const raw = form.get('value') as string
    const n   = parseInt(raw, 10)
    const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 0), 9999) : 0

    await db
      .insert(pipelineSettings)
      .values({ key: 'discovery_inventory_min', value: String(clamped), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pipelineSettings.key,
        set: { value: String(clamped), updatedAt: new Date() },
      })
    await invalidateDiscoveryIndex()
    return { ok: true, message: `Inventory floor saved: ${clamped}` }
  }

  // --- add_rule ---
  if (intent === 'add_rule') {
    const ruleType = form.get('ruleType') as DiscoveryRuleType
    const rawValue = (form.get('ruleValue') as string ?? '').trim()
    const category = (form.get('category') as Category | '') || null
    const notes    = (form.get('notes') as string ?? '').trim() || null

    if (!rawValue) return { ok: false, error: 'Rule value is required.' }

    if (ruleType === 'exclude_price_min' || ruleType === 'exclude_price_max') {
      const n = parseFloat(rawValue)
      if (!Number.isFinite(n) || n <= 0) {
        return { ok: false, error: 'Price rules require a positive number.' }
      }
    }

    // Lowercase keywords on storage
    const storedValue = ruleType === 'exclude_keyword' ? rawValue.toLowerCase() : rawValue

    await createDiscoveryRule({
      ruleType,
      ruleValue: storedValue,
      category: category as Category | null,
      notes,
    })
    return { ok: true, message: 'Rule added.' }
  }

  // --- toggle_rule ---
  if (intent === 'toggle_rule') {
    const id      = parseInt(form.get('id') as string, 10)
    const current = form.get('current') === 'true'
    await updateDiscoveryRule(id, { active: !current })
    return { ok: true, message: `Rule ${!current ? 'enabled' : 'disabled'}.` }
  }

  // --- delete_rule ---
  if (intent === 'delete_rule') {
    const id = parseInt(form.get('id') as string, 10)
    await deleteDiscoveryRule(id)
    return { ok: true, message: 'Rule deleted.' }
  }

  // --- add_pin (product handle) ---
  if (intent === 'add_pin') {
    const category  = form.get('category') as Category
    const ruleValue = (form.get('ruleValue') as string ?? '').trim()
    if (!ruleValue) return { ok: false, error: 'Handle is required.' }
    if (!CATEGORIES.includes(category)) return { ok: false, error: 'Invalid category.' }

    // Re-fetch pins for this category to compute next sortOrder
    const all  = await listAllDiscoveryRules()
    const pins = all.filter(r => r.ruleType === 'pin_fallback' && r.category === category)
    const nextOrder = pins.length > 0 ? Math.max(...pins.map(p => p.sortOrder)) + 1 : 0

    await createDiscoveryRule({
      ruleType:  'pin_fallback',
      ruleValue,
      category,
      sortOrder: nextOrder,
    })
    return { ok: true, message: `Pinned "${ruleValue}" to ${category}.` }
  }

  // --- add_collection_pin (Shopify collection handle) ---
  if (intent === 'add_collection_pin') {
    const category = form.get('category') as Category
    const raw      = (form.get('ruleValue') as string ?? '')
    // Strip URL/path/query so a pasted PLP link becomes the bare handle.
    const ruleValue = cleanCollectionHandle(raw)
    if (!ruleValue) return { ok: false, error: 'Collection handle is required.' }
    if (!CATEGORIES.includes(category)) return { ok: false, error: 'Invalid category.' }

    const all  = await listAllDiscoveryRules()
    const pins = all.filter(r => r.ruleType === 'pin_collection_fallback' && r.category === category)
    const nextOrder = pins.length > 0 ? Math.max(...pins.map(p => p.sortOrder)) + 1 : 0

    await createDiscoveryRule({
      ruleType:  'pin_collection_fallback',
      ruleValue,
      category,
      sortOrder: nextOrder,
    })
    return { ok: true, message: `Pinned collection "${ruleValue}" to ${category}.` }
  }

  // --- remove_pin ---
  if (intent === 'remove_pin') {
    const id = parseInt(form.get('id') as string, 10)
    await deleteDiscoveryRule(id)
    return { ok: true, message: 'Pin removed.' }
  }

  // --- move_pin ---
  if (intent === 'move_pin') {
    const id        = parseInt(form.get('id') as string, 10)
    const direction = form.get('direction') as 'up' | 'down'
    await moveFallbackPin(id, direction)
    return { ok: true, message: 'Pin reordered.' }
  }

  return { ok: false, error: 'Unknown intent.' }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionData = { ok: true; message: string } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Rule type labels + badge colours
// ---------------------------------------------------------------------------

const RULE_TYPE_LABELS: Record<DiscoveryRuleType, string> = {
  exclude_product:         'Product handle',
  exclude_product_type:    'Shopify Type',
  exclude_keyword:         'Title keyword',
  exclude_price_min:       'Min price',
  exclude_price_max:       'Max price',
  pin_fallback:            'Pin product',
  pin_collection_fallback: 'Pin collection',
}

const RULE_TYPE_BADGE: Record<DiscoveryRuleType, string> = {
  exclude_product:         'bg-red-100 text-red-700',
  exclude_product_type:    'bg-orange-100 text-orange-700',
  exclude_keyword:         'bg-yellow-100 text-yellow-700',
  exclude_price_min:       'bg-blue-100 text-blue-700',
  exclude_price_max:       'bg-indigo-100 text-indigo-700',
  pin_fallback:            'bg-sage/10 text-sage',
  pin_collection_fallback: 'bg-coral/10 text-coral',
}

const EXCLUSION_RULE_TYPES: DiscoveryRuleType[] = [
  'exclude_product',
  'exclude_product_type',
  'exclude_keyword',
  'exclude_price_min',
  'exclude_price_max',
]

function valueInputProps(ruleType: DiscoveryRuleType): {
  type: string
  placeholder: string
  min?: string
  step?: string
} {
  switch (ruleType) {
    case 'exclude_price_min':
      return { type: 'number', placeholder: 'e.g. 25', min: '0.01', step: '0.01' }
    case 'exclude_price_max':
      return { type: 'number', placeholder: 'e.g. 300', min: '0.01', step: '0.01' }
    case 'exclude_product':
      return { type: 'text', placeholder: 'e.g. bathmate-hydromax7-clear' }
    case 'exclude_product_type':
      return { type: 'text', placeholder: 'e.g. Discontinued (matches Shopify\'s Type field)' }
    case 'exclude_keyword':
      return { type: 'text', placeholder: 'e.g. fetish (case-insensitive)' }
    default:
      return { type: 'text', placeholder: 'Value' }
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AdminDiscoveryRulesPage() {
  const { exclusions, pinsByCategory, collectionPinsByCategory, inventoryMin } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<ActionData>()

  const latestData = fetcher.data

  return (
    <div className="max-w-5xl space-y-8">
      <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
        Discovery Rules
      </h1>

      {/* Inline result banner */}
      {latestData && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            latestData.ok
              ? 'bg-sage/10 text-ink border border-sage/20'
              : 'bg-coral/10 text-ink border border-coral/20'
          }`}
        >
          {latestData.ok ? latestData.message : latestData.error}
        </div>
      )}

      {/* ── Section 1: Inventory floor ──────────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm">
        <h2 className="text-base font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          Inventory floor
        </h2>
        <p className="text-sm text-ink/60 mb-4">
          Hide products with fewer than N units in stock. Set to 0 to disable. Products Shopify
          does not track inventory for are never hidden by this.
        </p>
        <fetcher.Form method="post" className="flex items-center gap-3">
          <input type="hidden" name="intent" value="save_inventory_min" />
          <input
            type="number"
            name="value"
            defaultValue={inventoryMin}
            min={0}
            max={9999}
            step={1}
            className="w-24 border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
          />
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-sm font-semibold px-4 py-2 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors disabled:opacity-50"
          >
            {fetcher.state !== 'idle' ? 'Saving...' : 'Save'}
          </button>
        </fetcher.Form>
      </section>

      {/* ── Section 2: Exclusion rules ──────────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Exclusion rules
          </h2>
          <p className="text-sm text-ink/60">
            Hide matching products from the home page rails. Excluded products stay visible on
            product pages and collection pages.
          </p>
        </div>

        {/* Rules table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-cream-2 text-ink/60 text-xs uppercase tracking-wide">
                <th className="px-3 py-2 text-left rounded-tl-xl">Type</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Notes</th>
                <th className="px-3 py-2 text-center">Active</th>
                <th className="px-3 py-2 text-center rounded-tr-xl">Delete</th>
              </tr>
            </thead>
            <tbody>
              {exclusions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink/40 text-sm italic">
                    No exclusion rules yet. Add one below.
                  </td>
                </tr>
              )}
              {exclusions.map(rule => (
                <ExclusionRow key={rule.id} rule={rule} fetcher={fetcher} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Add rule form */}
        <AddExclusionForm fetcher={fetcher} />
      </section>

      {/* ── Section 3: Fallback pins ────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-5">
        <div>
          <h2 className="text-base font-bold text-ink mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            Fallback pins
          </h2>
          <p className="text-sm text-ink/60">
            Pinned products fill rails when filters would otherwise leave them empty. Product
            pins fill first (in order); collection pins backfill from any remaining slots. If
            nothing is pinned and the rail is empty, the system auto-loosens the brief.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CATEGORIES.map(cat => (
            <PinCard
              key={cat}
              category={cat}
              pins={pinsByCategory[cat]}
              collectionPins={collectionPinsByCategory[cat]}
              fetcher={fetcher}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExclusionRow — individual table row with toggle + delete
// ---------------------------------------------------------------------------

type FetcherType = ReturnType<typeof useFetcher<ActionData>>

type PendingConfirm = { id: number; handle: string }

function ExclusionRow({ rule, fetcher }: { rule: DiscoveryRule; fetcher: FetcherType }) {
  const [pendingDelete, setPendingDelete] = useState<PendingConfirm | null>(null)

  return (
    <>
      <tr className="border-t border-cream-2 hover:bg-cream-2/20 transition-colors">
        <td className="px-3 py-3">
          <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${RULE_TYPE_BADGE[rule.ruleType]}`}>
            {RULE_TYPE_LABELS[rule.ruleType]}
          </span>
        </td>
        <td className="px-3 py-3 font-mono text-xs text-ink/80">{rule.ruleValue}</td>
        <td className="px-3 py-3 text-xs text-ink/60">{rule.category ?? 'All'}</td>
        <td className="px-3 py-3 text-xs text-ink/50 max-w-[180px] truncate">{rule.notes ?? ''}</td>

        {/* Active toggle */}
        <td className="px-3 py-3 text-center">
          <fetcher.Form method="post" className="inline">
            <input type="hidden" name="intent"  value="toggle_rule" />
            <input type="hidden" name="id"      value={rule.id} />
            <input type="hidden" name="current" value={String(rule.active)} />
            <button
              type="submit"
              title={rule.active ? 'Disable rule' : 'Enable rule'}
              className={`w-9 h-5 rounded-full transition-colors relative inline-flex items-center ${
                rule.active ? 'bg-sage' : 'bg-ink/20'
              }`}
            >
              <span
                className={`absolute w-3.5 h-3.5 bg-white rounded-full shadow transition-all ${
                  rule.active ? 'right-1' : 'left-1'
                }`}
              />
            </button>
          </fetcher.Form>
        </td>

        {/* Delete */}
        <td className="px-3 py-3 text-center">
          <button
            type="button"
            onClick={() => setPendingDelete({ id: rule.id, handle: rule.ruleValue })}
            className="text-xs text-ink/30 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
            title="Delete rule"
          >
            ✕
          </button>
        </td>
      </tr>

      {/* Confirmation modal */}
      {pendingDelete && (
        <ConfirmModal
          label="Delete rule"
          message={`Delete the rule for "${pendingDelete.handle}"? This cannot be undone.`}
          intent="delete_rule"
          id={pendingDelete.id}
          fetcher={fetcher}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// AddExclusionForm — type-aware add form below the table
// ---------------------------------------------------------------------------

function AddExclusionForm({ fetcher }: { fetcher: FetcherType }) {
  const [selectedType, setSelectedType] = useState<DiscoveryRuleType>('exclude_product')
  const inputProps = valueInputProps(selectedType)

  return (
    <div className="border border-dashed border-cream-2 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-ink/40 uppercase tracking-wide">Add rule</p>
      <fetcher.Form method="post" className="flex flex-wrap gap-3 items-end">
        <input type="hidden" name="intent" value="add_rule" />

        {/* Type */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink/60">Type</label>
          <select
            name="ruleType"
            value={selectedType}
            onChange={e => setSelectedType(e.target.value as DiscoveryRuleType)}
            className="border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 bg-white"
          >
            {EXCLUSION_RULE_TYPES.map(t => (
              <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Value — type adapts */}
        <div className="space-y-1 flex-1 min-w-[160px]">
          <label className="block text-xs font-semibold text-ink/60">Value</label>
          <input
            key={selectedType} // reset when type changes
            type={inputProps.type}
            name="ruleValue"
            placeholder={inputProps.placeholder}
            min={inputProps.min}
            step={inputProps.step}
            className="w-full border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
          />
        </div>

        {/* Category scope */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-ink/60">Category</label>
          <select
            name="category"
            className="border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 bg-white"
          >
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div className="space-y-1 flex-1 min-w-[140px]">
          <label className="block text-xs font-semibold text-ink/60">Notes (optional)</label>
          <input
            type="text"
            name="notes"
            placeholder="e.g. Hide while out of season"
            className="w-full border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
          />
        </div>

        <button
          type="submit"
          disabled={fetcher.state !== 'idle'}
          className="text-sm font-semibold px-5 py-2 bg-coral text-white rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
        >
          {fetcher.state !== 'idle' ? 'Adding...' : 'Add rule'}
        </button>
      </fetcher.Form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PinCard — one category's fallback pins panel
// ---------------------------------------------------------------------------

function PinCard({
  category,
  pins,
  collectionPins,
  fetcher,
}: {
  category: Category
  pins: DiscoveryRule[]
  collectionPins: DiscoveryRule[]
  fetcher: FetcherType
}) {
  const [pendingRemove, setPendingRemove] = useState<PendingConfirm | null>(null)

  return (
    <div className="border border-cream-2 rounded-xl flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-cream-2 bg-cream-2/40 rounded-t-xl">
        <p className="text-sm font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          {category}
        </p>
      </div>

      {/* Pin list (products first, then collections) */}
      <div className="flex-1 px-3 py-3 space-y-1.5 min-h-[80px]">
        {pins.length === 0 && collectionPins.length === 0 && (
          <p className="text-xs text-ink/40 italic">
            No fallbacks pinned. The rail will auto-loosen if it cannot fill.
          </p>
        )}

        {pins.map((pin, idx) => (
          <div key={pin.id} className="flex items-center gap-1.5 group">
            {/* Up */}
            <fetcher.Form method="post" className="shrink-0">
              <input type="hidden" name="intent"    value="move_pin" />
              <input type="hidden" name="id"        value={pin.id} />
              <input type="hidden" name="direction" value="up" />
              <button
                type="submit"
                disabled={idx === 0 || fetcher.state !== 'idle'}
                className="text-ink/30 hover:text-ink disabled:opacity-20 transition-colors text-xs px-1"
                title="Move up"
              >
                ▲
              </button>
            </fetcher.Form>

            {/* Down */}
            <fetcher.Form method="post" className="shrink-0">
              <input type="hidden" name="intent"    value="move_pin" />
              <input type="hidden" name="id"        value={pin.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                disabled={idx === pins.length - 1 || fetcher.state !== 'idle'}
                className="text-ink/30 hover:text-ink disabled:opacity-20 transition-colors text-xs px-1"
                title="Move down"
              >
                ▼
              </button>
            </fetcher.Form>

            {/* Product badge */}
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sage/10 text-sage">
              prod
            </span>

            {/* Handle */}
            <span className="flex-1 font-mono text-xs text-ink/80 truncate" title={pin.ruleValue}>
              {pin.ruleValue}
            </span>

            {/* Remove */}
            <button
              type="button"
              onClick={() => setPendingRemove({ id: pin.id, handle: pin.ruleValue })}
              className="text-xs text-ink/20 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 px-1"
              title="Remove pin"
            >
              ✕
            </button>
          </div>
        ))}

        {collectionPins.map(pin => (
          <div key={pin.id} className="flex items-center gap-1.5 group">
            {/* Spacer where up/down would be (collection pins aren't reorderable in v1) */}
            <span className="shrink-0 w-[34px]" aria-hidden="true" />

            {/* Collection badge */}
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-coral/10 text-coral">
              coll
            </span>

            {/* Handle */}
            <span className="flex-1 font-mono text-xs text-ink/80 truncate" title={pin.ruleValue}>
              {pin.ruleValue}
            </span>

            {/* Remove */}
            <button
              type="button"
              onClick={() => setPendingRemove({ id: pin.id, handle: pin.ruleValue })}
              className="text-xs text-ink/20 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 px-1"
              title="Remove collection pin"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Add product pin */}
      <div className="border-t border-cream-2 px-3 py-2">
        <fetcher.Form method="post" className="flex gap-2 items-center">
          <input type="hidden" name="intent"   value="add_pin" />
          <input type="hidden" name="category" value={category} />
          <input
            type="text"
            name="ruleValue"
            placeholder="product-handle"
            className="flex-1 min-w-0 border border-cream-2 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sage/30 font-mono"
          />
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-xs font-semibold px-3 py-1.5 bg-ink text-white rounded-lg hover:bg-ink/80 transition-colors disabled:opacity-40 whitespace-nowrap"
            title="Pin a single product handle"
          >
            Pin product
          </button>
        </fetcher.Form>
      </div>

      {/* Add collection pin */}
      <div className="border-t border-cream-2 px-3 py-2 rounded-b-xl">
        <fetcher.Form method="post" className="flex gap-2 items-center">
          <input type="hidden" name="intent"   value="add_collection_pin" />
          <input type="hidden" name="category" value={category} />
          <input
            type="text"
            name="ruleValue"
            placeholder="collection-handle"
            className="flex-1 min-w-0 border border-cream-2 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-coral/30 font-mono"
          />
          <button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="text-xs font-semibold px-3 py-1.5 bg-coral text-white rounded-lg hover:bg-coral/85 transition-colors disabled:opacity-40 whitespace-nowrap"
            title="Pin a whole Shopify collection (all matching products backfill this rail)"
          >
            Pin collection
          </button>
        </fetcher.Form>
      </div>

      {/* Remove confirmation modal */}
      {pendingRemove && (
        <ConfirmModal
          label="Remove pin"
          message={`Remove "${pendingRemove.handle}" from ${category} fallbacks?`}
          intent="remove_pin"
          id={pendingRemove.id}
          fetcher={fetcher}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => setPendingRemove(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfirmModal — shared destructive-action confirmation overlay
// ---------------------------------------------------------------------------

function ConfirmModal({
  label,
  message,
  intent,
  id,
  fetcher,
  onCancel,
  onConfirm,
}: {
  label: string
  message: string
  intent: string
  id: number
  fetcher: FetcherType
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
        <p className="text-sm font-medium text-ink mb-1">{label}</p>
        <p className="text-sm text-ink/60 mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-ink/60 hover:text-ink rounded-xl transition-colors"
          >
            Cancel
          </button>
          <fetcher.Form
            method="post"
            onSubmit={onConfirm}
            className="inline"
          >
            <input type="hidden" name="intent" value={intent} />
            <input type="hidden" name="id"     value={id} />
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              {label}
            </button>
          </fetcher.Form>
        </div>
      </div>
    </div>
  )
}
