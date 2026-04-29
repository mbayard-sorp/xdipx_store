import { useEffect, useRef, useState } from 'react'
import type { LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Link, redirect, useFetcher, useLoaderData, useOutletContext } from 'react-router'
import { requireCustomer } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import { getListsForCustomer, type WishlistWithCount } from '~/lib/wishlist.server'
import { getProductsByHandles } from '~/lib/shopify.server'
import { ConfirmDialog } from '~/components/account/ConfirmDialog'
import { EmptyState } from '~/components/account/EmptyState'
import type { AccountOutletContext } from './_layout.account'

export const meta: MetaFunction = () => [{ title: 'Wishlists — xdipx' }, { name: 'robots', content: 'noindex, nofollow' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const { token, tokenType } = await requireCustomer(request)
  const profile = await customerAPI({ token, tokenType }).getProfile()
  if (!profile) throw redirect('/account/login')
  const lists = await getListsForCustomer(profile.id)

  const handleSet = new Set<string>()
  for (const l of lists) for (const h of l.previewHandles) handleSet.add(h)
  const products = handleSet.size > 0 ? await getProductsByHandles([...handleSet]) : []
  const previewImages: Record<string, { url: string; alt: string }> = {}
  for (const p of products) {
    const img = p.images[0]
    if (img?.url) previewImages[p.handle] = { url: img.url, alt: img.altText ?? p.title }
  }

  return { lists, previewImages }
}

export default function WishlistsIndex() {
  const { lists, previewImages } = useLoaderData<typeof loader>()
  const { customer } = useOutletContext<AccountOutletContext>()
  const createFetcher = useFetcher<{ ok: boolean; error?: string }>()
  const mutateFetcher = useFetcher<{ ok: boolean; error?: string }>()

  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WishlistWithCount | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const isBusy = createFetcher.state !== 'idle' || mutateFetcher.state !== 'idle'
  const createError = createFetcher.data?.ok === false ? createFetcher.data.error : null
  const mutateError = mutateFetcher.data?.ok === false ? mutateFetcher.data.error : null

  // Close create form after successful submit
  useEffect(() => {
    if (createFetcher.state === 'idle' && createFetcher.data?.ok) {
      setShowCreate(false)
    }
  }, [createFetcher.state, createFetcher.data])

  // Focus input when opened
  useEffect(() => {
    if (showCreate) createInputRef.current?.focus()
  }, [showCreate])

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('intent', 'create-list')
    createFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  function handleRename(listId: number, name: string) {
    const fd = new FormData()
    fd.set('intent', 'rename-list')
    fd.set('listId', String(listId))
    fd.set('name', name)
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
    setRenamingId(null)
  }

  function handleShareToggle(list: WishlistWithCount) {
    const fd = new FormData()
    fd.set('intent', 'toggle-share')
    fd.set('listId', String(list.id))
    fd.set('shared', list.publicSlug ? 'false' : 'true')
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const fd = new FormData()
    fd.set('intent', 'delete-list')
    fd.set('listId', String(deleteTarget.id))
    mutateFetcher.submit(fd, { method: 'post', action: '/api/wishlist' })
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-6">
      <section className="hidden lg:flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Wishlists <span className="text-sage">♥</span>
          </h1>
          <p className="text-sm text-ink/50 mt-0.5">{customer.email}</p>
        </div>
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="text-sm font-semibold text-white bg-coral px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            + New list
          </button>
        )}
      </section>

      {!showCreate && (
        <div className="flex justify-end lg:hidden">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="text-sm font-semibold text-white bg-coral px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            + New list
          </button>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-white rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3"
        >
          <input
            ref={createInputRef}
            name="name"
            required
            maxLength={100}
            placeholder="List name (e.g. Gifts for him)"
            className="flex-1 rounded-full border border-cream-2 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/40"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-full bg-coral text-white text-sm font-semibold disabled:opacity-60"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-full bg-cream-2 text-ink text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {(createError || mutateError) && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {createError || mutateError}
        </div>
      )}

      {lists.length === 0 ? (
        <EmptyState
          title="No wishlists yet ♥"
          description="Heart a product to start your first list."
          cta={{ label: "See today's deal ♥", to: '/' }}
        />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lists.map(list => (
            <WishlistCard
              key={list.id}
              list={list}
              previewImages={previewImages}
              isRenaming={renamingId === list.id}
              onStartRename={() => setRenamingId(list.id)}
              onCancelRename={() => setRenamingId(null)}
              onRename={name => handleRename(list.id, name)}
              onToggleShare={() => handleShareToggle(list)}
              onDelete={() => setDeleteTarget(list)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        titleId="confirm-delete-list-title"
        title={`Delete "${deleteTarget?.name}"?`}
        description="This will remove the list and all items in it. This can't be undone."
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function WishlistCard({
  list,
  previewImages,
  isRenaming,
  onStartRename,
  onCancelRename,
  onRename,
  onToggleShare,
  onDelete,
}: {
  list: WishlistWithCount
  previewImages: Record<string, { url: string; alt: string }>
  isRenaming: boolean
  onStartRename: () => void
  onCancelRename: () => void
  onRename: (name: string) => void
  onToggleShare: () => void
  onDelete: () => void
}) {
  const [draftName, setDraftName] = useState(list.name)
  const isShared = !!list.publicSlug

  useEffect(() => {
    if (isRenaming) setDraftName(list.name)
  }, [isRenaming, list.name])

  return (
    <li className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <form
              onSubmit={e => {
                e.preventDefault()
                if (draftName.trim()) onRename(draftName.trim())
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                maxLength={100}
                className="flex-1 rounded-full border border-cream-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage/40"
              />
              <button
                type="submit"
                className="text-xs font-semibold text-sage px-2"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onCancelRename}
                className="text-xs font-semibold text-ink/50 px-2"
              >
                Cancel
              </button>
            </form>
          ) : (
            <h2
              className="text-base font-bold text-ink truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {list.name}
              {list.isDefault && (
                <span className="ml-2 text-[10px] font-semibold text-sage uppercase tracking-wide">
                  Default
                </span>
              )}
            </h2>
          )}
          <p className="text-xs text-ink/50 mt-0.5">
            {list.itemCount} {list.itemCount === 1 ? 'item' : 'items'}
            <span className="mx-1.5">·</span>
            <span className={isShared ? 'text-sage' : ''}>
              {isShared ? 'Shared' : 'Private'}
            </span>
          </p>
        </div>
      </div>

      {list.previewHandles.length > 0 && (
        <div className="flex gap-1.5">
          {list.previewHandles.slice(0, 3).map(h => {
            const img = previewImages[h]
            return (
              <Link
                key={h}
                to={`/products/${h}`}
                className="w-14 h-14 rounded-lg bg-cream-2 overflow-hidden flex items-center justify-center text-ink/20 text-xl"
                title={h}
              >
                {img ? (
                  <img
                    src={img.url}
                    alt={img.alt}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span>♥</span>
                )}
              </Link>
            )
          })}
          {list.itemCount > 3 && (
            <div className="w-14 h-14 rounded-lg bg-cream-2 flex items-center justify-center text-xs font-semibold text-ink/60">
              +{list.itemCount - 3}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-cream-2">
        <Link
          to={`/account/wishlists/${list.id}`}
          className="text-xs font-semibold text-sage hover:text-sun transition-colors"
        >
          Open &rarr;
        </Link>
        <span className="text-ink/20">·</span>
        {!isRenaming && (
          <button
            type="button"
            onClick={onStartRename}
            className="text-xs font-semibold text-ink/60 hover:text-ink"
          >
            Rename
          </button>
        )}
        <span className="text-ink/20">·</span>
        <button
          type="button"
          onClick={onToggleShare}
          className="text-xs font-semibold text-ink/60 hover:text-ink"
        >
          {isShared ? 'Make private' : 'Share'}
        </button>
        {!list.isDefault && (
          <>
            <span className="text-ink/20">·</span>
            <button
              type="button"
              onClick={onDelete}
              className="text-xs font-semibold text-red-600 hover:text-red-700 ml-auto"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  )
}
