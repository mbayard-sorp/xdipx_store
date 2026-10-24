/**
 * /admin/collections-review — owner review of generated collection heroes
 * (collections audit 2026-10-23, plan step 3f).
 *
 * Every candidate is shown at the three crops one master image has to survive:
 * the 16:6 PLP hero, the 200px-tall hub card, and the 4:3 category masthead.
 * Approve sets it as the collection's Shopify image (which feeds all three);
 * Reject and Redo record the verdict and the note for the next generation run.
 * Nothing reaches the storefront until it is approved here.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router'
import { Form, useFetcher, useLoaderData } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  getCollectionHeroCandidate,
  listCollectionHeroCandidates,
  setCollectionHeroCandidateStatus,
  supersedeOtherApprovedHeroes,
  type CollectionHeroCandidate,
  type HeroCandidateStatus,
} from '~/lib/sanity.server'
import { getCollection, updateCollectionImage } from '~/lib/shopify.server'

export const meta: MetaFunction = () => [{ title: 'Collection heroes — xdipx Admin' }]

const STATUS_FILTERS: ReadonlyArray<{ value: HeroCandidateStatus | 'all'; label: string }> = [
  { value: 'candidate', label: 'Waiting' },
  { value: 'redo', label: 'Redo' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

function parseStatus(raw: string | null): HeroCandidateStatus | 'all' {
  return STATUS_FILTERS.some(f => f.value === raw) ? (raw as HeroCandidateStatus | 'all') : 'candidate'
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const url = new URL(request.url)
  const status = parseStatus(url.searchParams.get('status'))
  const batch = url.searchParams.get('batch') || null
  const candidates = await listCollectionHeroCandidates({ status, batch })
  return { candidates, status, batch }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const id = String(form.get('id') ?? '')
  const intent = String(form.get('intent') ?? '')
  const note = String(form.get('note') ?? '').trim() || null
  if (!id) return { ok: false, id, error: 'Missing candidate id' }

  try {
    if (intent === 'approve') {
      const candidate = await getCollectionHeroCandidate(id)
      if (!candidate) return { ok: false, id, error: 'Candidate not found' }
      const collection = await getCollection(candidate.collectionHandle)
      if (!collection) return { ok: false, id, error: `No live collection "${candidate.collectionHandle}"` }
      await updateCollectionImage(
        collection.id,
        { url: candidate.imageUrl },
        candidate.alt ?? `${collection.title} collection`,
      )
      await setCollectionHeroCandidateStatus(id, 'approved', note)
      await supersedeOtherApprovedHeroes(candidate.collectionHandle, id)
      return { ok: true, id, status: 'approved' as const }
    }
    if (intent === 'reject' || intent === 'redo') {
      if (intent === 'redo' && !note) return { ok: false, id, error: 'Say what to change for a redo' }
      await setCollectionHeroCandidateStatus(id, intent === 'reject' ? 'rejected' : 'redo', note)
      return { ok: true, id, status: intent === 'reject' ? 'rejected' as const : 'redo' as const }
    }
    return { ok: false, id, error: `Unknown intent "${intent}"` }
  } catch (err) {
    return { ok: false, id, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

function sized(url: string, width: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}width=${width}`
}

function CandidateCard({ c }: { c: CollectionHeroCandidate }) {
  const fetcher = useFetcher<typeof action>()
  const busy = fetcher.state !== 'idle'
  const result = fetcher.data
  const status = result?.ok ? result.status : c.status

  return (
    <li className="rounded-[var(--radius-md)] border border-line bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <a
          href={`/collections/${c.collectionHandle}`}
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-ink hover:text-coral"
        >
          /collections/{c.collectionHandle}
        </a>
        <span className="kicker text-ink-3">{status}{c.batch ? ` · ${c.batch}` : ''}</span>
      </div>

      <div className="flex flex-col gap-3 md:grid md:grid-cols-[2fr_1fr] md:gap-4">
        <figure>
          <div className="aspect-[16/6] overflow-hidden rounded-[var(--radius-sm)] bg-paper-3">
            <img src={sized(c.imageUrl, 1200)} alt={c.alt ?? ''} className="h-full w-full object-cover object-center" />
          </div>
          <figcaption className="mt-1 text-xs text-ink-3">Collection page hero, 16:6</figcaption>
        </figure>
        <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
          <figure className="flex-1">
            <div className="h-[200px] overflow-hidden rounded-[var(--radius-sm)] bg-paper-3">
              <img src={sized(c.imageUrl, 768)} alt="" className="h-full w-full object-cover object-center" />
            </div>
            <figcaption className="mt-1 text-xs text-ink-3">Hub card, 200px tall</figcaption>
          </figure>
          <figure className="flex-1">
            <div className="aspect-[4/3] overflow-hidden rounded-[var(--radius-sm)] bg-paper-3">
              <img src={sized(c.imageUrl, 768)} alt="" className="h-full w-full object-cover object-center" />
            </div>
            <figcaption className="mt-1 text-xs text-ink-3">Category masthead, 4:3</figcaption>
          </figure>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-ink-2 md:grid-cols-3">
        {c.story && <div className="md:col-span-3"><dt className="inline font-semibold">Story: </dt><dd className="inline">{c.story}</dd></div>}
        {c.castSlugs.length > 0 && <div><dt className="inline font-semibold">Cast: </dt><dd className="inline">{c.castSlugs.join(', ')}</dd></div>}
        {c.productHandles.length > 0 && (
          <div className="md:col-span-2">
            <dt className="inline font-semibold">Products: </dt>
            <dd className="inline">
              {c.productHandles.map((h, i) => (
                <span key={h}>{i > 0 && ', '}<a href={`/products/${h}`} target="_blank" rel="noreferrer" className="link-coral">{h}</a></span>
              ))}
            </dd>
          </div>
        )}
        {c.note && <div className="md:col-span-3"><dt className="inline font-semibold">Last note: </dt><dd className="inline">{c.note}</dd></div>}
      </dl>

      <fetcher.Form method="post" className="mt-3 flex flex-col gap-3 md:flex-row md:items-start">
        <input type="hidden" name="id" value={c.id} />
        <textarea
          name="note"
          rows={2}
          placeholder="Note (required for a redo): what to change"
          className="w-full flex-1 rounded-[var(--radius-sm)] border border-line px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" name="intent" value="approve" disabled={busy}
            className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50">
            Approve and set live
          </button>
          <button type="submit" name="intent" value="redo" disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
            Redo
          </button>
          <button type="submit" name="intent" value="reject" disabled={busy}
            className="rounded-full border border-line px-4 py-2 text-sm text-ink-3 disabled:opacity-50">
            Reject
          </button>
        </div>
      </fetcher.Form>
      {result && !result.ok && <p className="mt-2 text-sm text-coral">{result.error}</p>}
      {result?.ok && <p className="mt-2 text-sm text-sage">Saved: {result.status}.</p>}
    </li>
  )
}

export default function CollectionsReview() {
  const { candidates, status, batch } = useLoaderData<typeof loader>()

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
            Collection heroes
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Each candidate at the three crops it has to survive. Approve sets it live on the collection.
          </p>
        </div>
        <Form method="get" className="flex flex-col gap-3 md:flex-row md:items-center">
          <select name="status" defaultValue={status} className="rounded-[var(--radius-sm)] border border-line px-3 py-2 text-sm">
            {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input name="batch" defaultValue={batch ?? ''} placeholder="Batch (optional)"
            className="rounded-[var(--radius-sm)] border border-line px-3 py-2 text-sm" />
          <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm font-semibold">Filter</button>
        </Form>
      </header>

      {candidates.length === 0 ? (
        <p className="text-ink-3">Nothing here for this filter.</p>
      ) : (
        <ul className="flex flex-col gap-6">
          {candidates.map(c => <CandidateCard key={c.id} c={c} />)}
        </ul>
      )}
    </div>
  )
}
