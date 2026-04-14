import type { ActionFunctionArgs } from 'react-router'
import { getCustomerToken } from '~/lib/customer-session.server'
import { customerAPI } from '~/lib/customer-api.server'
import {
  addItem,
  createList,
  deleteList,
  getAllHandlesForCustomer,
  mergeLocalHearts,
  moveItem,
  removeItem,
  renameList,
  setListShared,
} from '~/lib/wishlist.server'
import {
  syncWishlistProfileProperty,
  trackWishlistAdded,
  trackWishlistRemoved,
} from '~/lib/klaviyo.server'

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = form.get('intent') as string

  const customerToken = await getCustomerToken(request)
  if (!customerToken) {
    return Response.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  let profile
  try {
    profile = await customerAPI(customerToken).getProfile()
  } catch {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401 })
  }
  if (!profile) {
    return Response.json({ ok: false, error: 'Profile unavailable' }, { status: 401 })
  }
  const customerGid = profile.id
  const email = profile.email

  try {
    switch (intent) {
      case 'add': {
        const shopifyProductId = String(form.get('shopifyProductId') ?? '')
        const handle = String(form.get('handle') ?? '')
        const listIdRaw = form.get('listId')
        const listId = listIdRaw ? Number(listIdRaw) : null
        const productTitle = (form.get('productTitle') as string) || undefined
        const price = (form.get('price') as string) || undefined
        if (!shopifyProductId || !handle) {
          return Response.json({ ok: false, error: 'Missing product' }, { status: 400 })
        }
        const { list } = await addItem(customerGid, listId, shopifyProductId, handle)
        void trackWishlistAdded(email, {
          productHandle: handle,
          listName: list.name,
          ...(productTitle !== undefined ? { productTitle } : {}),
          ...(price !== undefined ? { price } : {}),
        })
        void syncAfterMutation(customerGid, email)
        return Response.json({ ok: true, hearted: true, listId: list.id })
      }

      case 'remove': {
        const shopifyProductId = String(form.get('shopifyProductId') ?? '')
        const handle = (form.get('handle') as string) || null
        const listIdRaw = form.get('listId')
        const listId = listIdRaw ? Number(listIdRaw) : null
        if (!shopifyProductId) {
          return Response.json({ ok: false, error: 'Missing product' }, { status: 400 })
        }
        await removeItem(customerGid, listId, shopifyProductId)
        if (handle) {
          void trackWishlistRemoved(email, { productHandle: handle })
        }
        void syncAfterMutation(customerGid, email)
        return Response.json({ ok: true, hearted: false })
      }

      case 'move-item': {
        const shopifyProductId = String(form.get('shopifyProductId') ?? '')
        const fromListId = Number(form.get('fromListId'))
        const toListId = Number(form.get('toListId'))
        if (!shopifyProductId || !fromListId || !toListId) {
          return Response.json({ ok: false, error: 'Missing params' }, { status: 400 })
        }
        await moveItem(customerGid, fromListId, toListId, shopifyProductId)
        return Response.json({ ok: true })
      }

      case 'create-list': {
        const name = String(form.get('name') ?? '').trim()
        const row = await createList(customerGid, name)
        return Response.json({ ok: true, list: row })
      }

      case 'rename-list': {
        const listId = Number(form.get('listId'))
        const name = String(form.get('name') ?? '').trim()
        await renameList(customerGid, listId, name)
        return Response.json({ ok: true })
      }

      case 'delete-list': {
        const listId = Number(form.get('listId'))
        await deleteList(customerGid, listId)
        void syncAfterMutation(customerGid, email)
        return Response.json({ ok: true })
      }

      case 'toggle-share': {
        const listId = Number(form.get('listId'))
        const shared = form.get('shared') === 'true'
        const row = await setListShared(customerGid, listId, shared)
        return Response.json({ ok: true, list: row })
      }

      case 'merge-local': {
        const raw = String(form.get('items') ?? '[]')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return Response.json({ ok: false, error: 'Bad payload' }, { status: 400 })
        }
        if (!Array.isArray(parsed)) {
          return Response.json({ ok: false, error: 'Bad payload' }, { status: 400 })
        }
        const items = parsed
          .filter((x): x is { shopifyProductId: string; handle: string } =>
            !!x && typeof x === 'object' &&
            typeof (x as Record<string, unknown>).shopifyProductId === 'string' &&
            typeof (x as Record<string, unknown>).handle === 'string',
          )
          .slice(0, 100)
        const { merged } = await mergeLocalHearts(customerGid, items)
        if (merged > 0) void syncAfterMutation(customerGid, email)
        return Response.json({ ok: true, merged })
      }

      default:
        return Response.json({ ok: false, error: 'Unknown intent' }, { status: 400 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 400 })
  }
}

async function syncAfterMutation(customerGid: string, email: string): Promise<void> {
  try {
    const handles = await getAllHandlesForCustomer(customerGid)
    await syncWishlistProfileProperty(email, handles)
  } catch (err) {
    console.error('[api.wishlist.syncAfterMutation] failed:', err)
  }
}
