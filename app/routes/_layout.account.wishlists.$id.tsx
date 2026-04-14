import { useEffect, useRef, useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, redirect, useFetcher, useLoaderData, useNavigate } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import {
  getListsForCustomer,
  getListWithItems,
  type WishlistWithCount,
  type WishlistWithItems,
} from '~/lib/wishlist.server'
import { ConfirmDialog } from '~/components/account/ConfirmDialog'

export const meta: MetaFunction = () => [{ title: 'Wishlist — xdipx' }]

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const profile = await customerAPI({ token, tokenType }).getProfile()
  if (!profile) throw redirect('/account/login')

  const listId = Number(params.id)
  if (!Number.isFinite(listId)) throw redirect('/account/wishlists')

  const list = await getListWithItems(listId, profile.id)
  if (!list) throw redirect('/account/wishlists')

  const allLists = await getListsForCustomer(profile.id)
  return { list, allLists }
}

export default function WishlistDetail() {
  const { list, allLists } = useLoaderData<typeof loader>()
  const mutateFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const deleteFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const navigate = useNavigate()

  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(list.name)
  const [confirmDeleteList, setConfirmDeleteList] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => setDraftName(list.name), [list.name])

  // After successful list delete, navigate back
  useEffect(() => {
    if (deleteFetcher.state === 'idle' && deleteFetcher.data?.ok) {
      navigate('/account/wishlists')
    }
  }, [deleteFetcher.state, deleteFetcher.data, navigate])

  const isShared = !!list.publicSlug
  const shareUrl =
    typeof window !== 'undefined' && list.publicSlug
      ? `${window.location.origin}/wishlists/${list.publicSlug}`
      : list.publicSlug
        ? `/wishlists/${list.publicSlug}`
        : null

  const mutateError = mutateFetcher.data?.ok === false ? mutateFetcher.data.error : null

  function handleRename() {
    const name = draftName.trim()
    if (!name) return
    const fd = new FormData()
    fd.set('intent', 'rename-list')
    fd.set('listId', String(list.id))
    fd.set('name', name)
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
    setIsRenaming(false)
  }

  function handleToggleShare() {
    const fd = new FormData()
    fd.set('intent', 'toggle-share')
    fd.set('listId', String(list.id))
    fd.set('shared', isShared ? 'false' : 'true')
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  function handleCopy() {
    if (!shareUrl) return
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {
        // Swallow — not critical.
      })
  }

  function handleRemoveItem(shopifyProductId: string, handle: string) {
    const fd = new FormData()
    fd.set('intent', 'remove')
    fd.set('shopifyProductId', shopifyProductId)
    fd.set('handle', handle)
    fd.set('listId', String(list.id))
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  function handleMoveItem(shopifyProductId: string, toListId: number) {
    const fd = new FormData()
    fd.set('intent', 'move-item')
    fd.set('shopifyProductId', shopifyProductId)
    fd.set('fromListId', String(list.id))
    fd.set('toListId', String(toListId))
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  function handleDeleteList() {
    const fd = new FormData()
    fd.set('intent', 'delete-list')
    fd.set('listId', String(list.id))
    deleteFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
    setConfirmDeleteList(false)
  }

  const otherLists = allLists.filter(l => l.id !== list.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-brand-charcoal/50">
        <Link to="/account/wishlists" className="hover:text-brand-purple">
          ← All wishlists
        </Link>
      </div>

      <section>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  handleRename()
                }}
                className="flex gap-2"
              >
                <input
                  autoFocus
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  maxLength={100}
                  className="flex-1 rounded-full border border-brand-mist px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-brand-purple/40"
                />
                <button
                  type="submit"
                  className="text-sm font-semibold text-brand-purple px-3"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(false)
                    setDraftName(list.name)
                  }}
                  className="text-sm font-semibold text-brand-charcoal/50 px-3"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <h1
                className="text-2xl font-bold text-brand-charcoal"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {list.name}
                {list.isDefault && (
                  <span className="ml-2 text-[11px] font-semibold text-brand-purple uppercase tracking-wide">
                    Default
                  </span>
                )}
              </h1>
            )}
            <p className="text-sm text-brand-charcoal/50 mt-0.5">
              {list.items.length} {list.items.length === 1 ? 'item' : 'items'}
            </p>
          </div>
          {!isRenaming && (
            <button
              type="button"
              onClick={() => setIsRenaming(true)}
              className="text-sm font-semibold text-brand-charcoal/60 hover:text-brand-charcoal"
            >
              Rename
            </button>
          )}
        </div>
      </section>

      {/* Share card */}
      <section className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p
              className="text-sm font-bold text-brand-charcoal"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {isShared ? 'Shared' : 'Private'}
            </p>
            <p className="text-xs text-brand-charcoal/60 mt-0.5">
              {isShared
                ? 'Anyone with the link can view this list.'
                : 'Only you can see this list.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleShare}
            disabled={mutateFetcher.state !== 'idle'}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
              isShared
                ? 'bg-brand-mist text-brand-charcoal hover:bg-brand-mist/70'
                : 'bg-brand-gradient text-white hover:opacity-90'
            }`}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {isShared ? 'Make private' : 'Share'}
          </button>
        </div>

        {isShared && shareUrl && (
          <div className="flex items-center gap-2 pt-2 border-t border-brand-mist">
            <input
              readOnly
              value={shareUrl}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 text-xs bg-brand-mist/40 rounded-full px-3 py-1.5 font-mono text-brand-charcoal/80"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 text-xs font-semibold text-brand-purple hover:text-brand-purple-light px-2"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <Link
              to={`/wishlists/${list.publicSlug}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs font-semibold text-brand-charcoal/60 hover:text-brand-charcoal px-2"
            >
              View
            </Link>
          </div>
        )}
      </section>

      {mutateError && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {mutateError}
        </div>
      )}

      {/* Items */}
      {list.items.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <p
            className="text-base font-bold text-brand-charcoal mb-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            This list is empty ♥
          </p>
          <p className="text-sm text-brand-charcoal/60">
            Heart a product anywhere on the site to add it here.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center mt-4 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-brand-gradient hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Browse deals ♥
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {list.items.map(item => (
            <WishlistItemCard
              key={item.id}
              item={item}
              otherLists={otherLists}
              onRemove={() => handleRemoveItem(item.shopifyProductId, item.handle)}
              onMove={toListId => handleMoveItem(item.shopifyProductId, toListId)}
            />
          ))}
        </ul>
      )}

      {/* Delete list */}
      {!list.isDefault && (
        <section className="pt-6 border-t border-brand-mist">
          <button
            type="button"
            onClick={() => setConfirmDeleteList(true)}
            className="text-sm font-semibold text-red-600 hover:text-red-700"
          >
            Delete this list
          </button>
        </section>
      )}

      <ConfirmDialog
        open={confirmDeleteList}
        titleId="confirm-delete-list-title"
        title={`Delete "${list.name}"?`}
        description="This will remove the list and all items in it. This can't be undone."
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        variant="destructive"
        onConfirm={handleDeleteList}
        onCancel={() => setConfirmDeleteList(false)}
      />
    </div>
  )
}

type ItemRow = WishlistWithItems['items'][number]

function WishlistItemCard({
  item,
  otherLists,
  onRemove,
  onMove,
}: {
  item: ItemRow
  otherLists: WishlistWithCount[]
  onRemove: () => void
  onMove: (toListId: number) => void
}) {
  const [showMove, setShowMove] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const cartFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const wasSubmitting = useRef(false)
  const { product } = item
  const image = product?.images?.[0]
  const variant = product?.variants?.find(v => v.availableForSale) ?? product?.variants?.[0]
  const canAddToCart = !!variant?.availableForSale
  const isAdding = cartFetcher.state !== 'idle'

  useEffect(() => {
    if (cartFetcher.state === 'submitting') wasSubmitting.current = true
    else if (cartFetcher.state === 'idle' && wasSubmitting.current) {
      wasSubmitting.current = false
      if (cartFetcher.data?.ok) {
        setJustAdded(true)
        window.dispatchEvent(new CustomEvent('xdipx:cart-added'))
        const t = setTimeout(() => setJustAdded(false), 1200)
        return () => clearTimeout(t)
      }
    }
  }, [cartFetcher.state, cartFetcher.data])

  function handleAtcClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!canAddToCart || !variant) return
    const fd = new FormData()
    fd.set('intent', 'add-item')
    fd.set('variantId', variant.id)
    fd.set('quantity', '1')
    cartFetcher.submit(fd, { method: 'post', action: '/api/cart' })
  }

  return (
    <li className="bg-white rounded-2xl overflow-hidden shadow-sm flex flex-col">
      <div className="relative aspect-square bg-brand-mist overflow-hidden">
        <Link to={`/products/${item.handle}`} className="block w-full h-full">
          {image ? (
            <img
              src={image.url}
              alt={image.altText || product?.title || item.handle}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl text-brand-charcoal/10">
              ♥
            </div>
          )}
        </Link>
        {canAddToCart && (
          <button
            type="button"
            onClick={handleAtcClick}
            disabled={isAdding}
            aria-label={`Add ${product?.title ?? item.handle} to cart`}
            className={`absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 text-white text-xs font-bold shadow-md transition-all ${
              justAdded ? 'bg-brand-purple scale-105' : 'bg-brand-coral hover:bg-brand-coral/90 hover:scale-105'
            } ${isAdding ? 'opacity-70' : ''}`}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {justAdded ? (
              <>
                <span aria-hidden="true">♥</span>
                <span>Added</span>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                <span>+ Add</span>
              </>
            )}
          </button>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <Link to={`/products/${item.handle}`} className="block">
          {product?.brand && (
            <p className="text-[11px] text-brand-charcoal/50 uppercase tracking-wide">
              {product.brand}
            </p>
          )}
          <p
            className="text-sm font-semibold text-brand-charcoal line-clamp-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {product?.title || item.handle}
          </p>
          {product?.price !== undefined && (
            <p className="text-sm font-bold text-brand-gradient mt-1">
              ${product.price.toFixed(2)}
            </p>
          )}
        </Link>

        <div className="flex items-center gap-2 mt-auto pt-2 border-t border-brand-mist text-xs">
          <button
            type="button"
            onClick={onRemove}
            className="font-semibold text-red-600 hover:text-red-700"
          >
            Remove
          </button>
          {otherLists.length > 0 && (
            <>
              <span className="text-brand-charcoal/20">·</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMove(s => !s)}
                  className="font-semibold text-brand-charcoal/60 hover:text-brand-charcoal"
                >
                  Move ▾
                </button>
                {showMove && (
                  <div className="absolute left-0 bottom-full mb-1 z-10 bg-white shadow-lg rounded-xl border border-brand-mist min-w-[160px] py-1">
                    {otherLists.map(l => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          onMove(l.id)
                          setShowMove(false)
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-brand-mist truncate"
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
