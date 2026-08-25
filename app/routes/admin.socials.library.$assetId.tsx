/**
 * /admin/socials/library/:assetId — the asset drawer, rendered inside the
 * Library's <Outlet/>: full-res image, read-only prompt and provenance,
 * editable tags (tag-add / tag-remove post to this route), usage across
 * posts, and "Edit prompt, regenerate" through /api/admin/social-image.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { Link, useFetcher, useLoaderData, useNavigate, useSearchParams } from 'react-router'
import { useState } from 'react'
import { getAdminUser, requireAdmin } from '~/lib/session.server'
import {
  addAssetTags, archiveAssets, getAssetUsage, getLibraryAsset, removeAssetTag, unarchiveAssets,
} from '~/lib/social-studio.server'
import { getApprovedCastMembers } from '~/lib/sanity.server'
import { TagChipInput } from '~/components/admin/social/TagChipInput'
import { RegenerateModal } from '~/components/admin/social/RegenerateModal'
import { PlatformChip } from '~/components/admin/social/PostPreviewCard'
import { StatusPill, studioStatusOf } from '~/components/admin/social/StatusPill'
import { aspectClassOf } from '~/components/admin/social/LibraryGrid'
import { ArchiveIcon, CloseIcon, ExternalIcon, RefreshIcon, PlusIcon, UndoIcon } from '~/components/admin/social/icons'
import { formatLaWallClock } from '~/lib/social-schedule-ui'

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const id = Number(params['assetId'])
  if (!Number.isInteger(id) || id <= 0) throw new Response('Not found', { status: 404 })
  const asset = await getLibraryAsset(id)
  if (!asset) throw new Response('Not found', { status: 404 })
  const [usage, cast] = await Promise.all([
    getAssetUsage(asset),
    getApprovedCastMembers().catch(() => []),
  ])
  return {
    asset,
    usage,
    roster: cast.map(m => ({ slug: m.slug, name: m.name, photoUrl: m.photoUrl, role: m.role })),
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAdmin(request)
  const id = Number(params['assetId'])
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Bad asset id' }
  const form = await request.formData()
  const intent = form.get('intent')
  if (intent === 'tag-add') {
    const n = await addAssetTags([id], String(form.get('tag') ?? ''))
    return n > 0 ? { ok: true } : { ok: false, error: 'Tag must be 1-40 lowercase letters, digits, spaces or dashes, and not already on the asset' }
  }
  if (intent === 'tag-remove') {
    const ok = await removeAssetTag(id, String(form.get('tag') ?? ''))
    return ok ? { ok: true } : { ok: false, error: 'Tag not found' }
  }
  if (intent === 'archive') {
    const admin = await getAdminUser(request)
    const result = await archiveAssets([id], admin?.email || 'owner')
    if (result.archived.length === 0) {
      return { ok: false, error: result.refused[0]?.reason ?? 'Could not archive' }
    }
    return { ok: true, intent: 'archive', warning: result.warnings[0]?.warning ?? null }
  }
  if (intent === 'unarchive') {
    const n = await unarchiveAssets([id])
    return n > 0 ? { ok: true, intent: 'unarchive' } : { ok: false, error: 'Asset not found' }
  }
  return { ok: false, error: 'Unknown intent' }
}

export default function LibraryAssetDrawer() {
  const { asset, usage, roster } = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [regen, setRegen] = useState(false)
  const back = `/admin/socials/library?${params.toString()}`
  const close = () => navigate(back)
  const archiveFetcher = useFetcher<{ ok: boolean; error?: string; intent?: 'archive' | 'unarchive'; warning?: string | null }>()
  const isArchived = !!asset.archivedAt

  return (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="asset-title">
      <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-ink/40" />
      <aside className="relative w-full md:w-[440px] h-full overflow-y-auto bg-paper border-l border-line">
        <div className="sticky top-0 bg-paper border-b border-line px-4 py-3 flex items-center gap-2">
          <h2 id="asset-title" className="font-display text-lg text-ink">Asset <span className="font-mono text-base">#{asset.id}</span></h2>
          <span className="flex-1" />
          <button type="button" onClick={close} aria-label="Close drawer" className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-paper-2">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          <div className={`rounded-xl overflow-hidden border border-line bg-paper-3 ${aspectClassOf(asset.aspect, asset.width, asset.height)}`}>
            <img src={asset.url} alt={asset.prompt ?? `Asset ${asset.id}`} className="w-full h-full object-contain" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href={asset.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4">
              <ExternalIcon size={14} /> Full size
            </a>
            <Link to={`/admin/socials/compose/new?assets=${asset.id}`} className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4">
              <PlusIcon size={14} /> New post
            </Link>
            <button type="button" onClick={() => setRegen(true)} className="inline-flex items-center gap-1 min-h-11 px-4 rounded-full bg-coral text-white text-sm font-semibold hover:bg-coral-2">
              <RefreshIcon size={14} /> Edit prompt, regenerate
            </button>
            <archiveFetcher.Form method="post">
              <input type="hidden" name="intent" value={isArchived ? 'unarchive' : 'archive'} />
              <button
                type="submit"
                disabled={archiveFetcher.state !== 'idle'}
                className="inline-flex items-center gap-1 min-h-11 px-3 rounded-full border border-line bg-paper text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-50"
              >
                {isArchived ? <UndoIcon size={14} /> : <ArchiveIcon size={14} />}
                {isArchived ? 'Unarchive' : 'Archive'}
              </button>
            </archiveFetcher.Form>
          </div>
          {isArchived && (
            <p className="text-xs text-ink-3">
              Archived{asset.archivedBy ? ` by ${asset.archivedBy}` : ''}. Hidden from the library grid and the Composer picker.
            </p>
          )}
          {archiveFetcher.data?.ok === false && <p className="text-xs text-red-700">{archiveFetcher.data.error}</p>}
          {archiveFetcher.data?.ok && archiveFetcher.data.intent === 'archive' && archiveFetcher.data.warning && (
            <p className="text-xs text-ink-3">{archiveFetcher.data.warning}</p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-ink-4">source</dt><dd className="font-mono text-ink">{asset.source}{asset.provider ? ` / ${asset.provider}` : ''}</dd>
            {asset.model && <><dt className="text-ink-4">model</dt><dd className="font-mono text-ink break-all">{asset.model}</dd></>}
            <dt className="text-ink-4">size</dt><dd className="font-mono text-ink">{asset.width && asset.height ? `${asset.width}x${asset.height}` : 'unknown'}{asset.aspect ? ` (${asset.aspect})` : ''}</dd>
            {asset.archetype && <><dt className="text-ink-4">archetype</dt><dd className="font-mono text-ink">{asset.archetype}</dd></>}
            {asset.productHandle && (
              <><dt className="text-ink-4">product</dt><dd><Link to={`/admin/socials/library?product=${encodeURIComponent(asset.productHandle)}`} className="font-mono text-ink link-coral">{asset.productHandle}</Link></dd></>
            )}
            {asset.castSlugs && asset.castSlugs.length > 0 && <><dt className="text-ink-4">cast</dt><dd className="font-mono text-ink">{asset.castSlugs.join(', ')}</dd></>}
            <dt className="text-ink-4">picked</dt><dd className="font-mono text-ink">{asset.isPicked ? `yes${asset.postId ? `, post #${asset.postId}` : ''}` : 'no'}</dd>
            <dt className="text-ink-4">created</dt><dd className="font-mono text-ink">{formatLaWallClock(asset.createdAt)} by {asset.createdBy}</dd>
            {asset.generationBatchId && <><dt className="text-ink-4">batch</dt><dd className="font-mono text-ink break-all">{asset.generationBatchId}</dd></>}
          </dl>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-1">Prompt</h3>
            {asset.prompt ? (
              <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-paper-2 p-3 text-xs text-ink font-mono">{asset.prompt}</pre>
            ) : (
              <p className="text-xs text-ink-3">No prompt on file{asset.source === 'upload' ? ': this was uploaded, not generated' : '. Older assets predate the index; regenerate to get one.'}.</p>
            )}
            {asset.negativePrompt && (
              <p className="mt-1 text-[11px] text-ink-4 font-mono">negatives: {asset.negativePrompt}</p>
            )}
          </section>

          <TagChipInput assetId={asset.id} tags={asset.tags ?? []} />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-1">Used in</h3>
            {usage.length === 0 ? (
              <p className="text-xs text-ink-3">Not in any post yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line" role="list">
                {usage.map(u => (
                  <li key={u.postId} className="flex items-center gap-2 px-3 min-h-11">
                    <PlatformChip platform={u.platform} />
                    <Link to={`/admin/socials/compose/${u.postId}`} className="font-mono text-xs text-ink link-coral">#{u.postId}</Link>
                    <StatusPill status={studioStatusOf({ status: u.status, reviewStatus: u.reviewStatus })} />
                    <span className="ml-auto font-mono text-[10px] text-ink-4">{u.via === 'slide' ? 'slide' : 'legacy'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>

      {regen && (
        <RegenerateModal
          initialPrompt={asset.prompt ?? ''}
          sourceUrl={asset.url}
          productHandle={asset.productHandle}
          productImageUrl={null}
          roster={roster}
          defaultAspect={asset.aspect === '16:9' ? '16:9' : asset.aspect === '1:1' ? '1:1' : asset.aspect === '9:16' ? '9:16' : '4:5'}
          onClose={() => setRegen(false)}
          onUse={picked => {
            setRegen(false)
            if (picked.assetId) navigate(`/admin/socials/library/${picked.assetId}`)
            else navigate('/admin/socials/library')
          }}
        />
      )}
    </div>
  )
}
