/**
 * admin.ad-studio.tsx — Ad Studio: zeely-style creative batches + the first
 * admin surface for ad_campaigns proposals.
 *
 * Pick a product (search, or paste its /products/{slug} URL), write the
 * policy note, generate a batch of paid-register static variants (1:1, 4:5,
 * 9:16), edit hook copy, approve/reject per creative, and push approved
 * creatives to a platform as a PAUSED draft. Pushes are inert stubs today and
 * Meta/TikTok are policy-blocked for the pleasure catalog regardless of keys
 * (docs/ads-policy.md); Google restricted-serving is the viable lane.
 */

import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { Form, useLoaderData, useNavigation } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import {
  generateAdBatch,
  listCampaignsWithCreatives,
  updateCreative,
  getCampaign,
  type CampaignWithCreatives,
} from '~/lib/ad-creative.server'
import { getAdPusher } from '~/lib/ad-publish/registry.server'
import { decideAdCampaign } from '~/lib/team.server'
import { db } from '~/lib/db.server'
import { adCampaigns, adCreatives } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { ResponsiveTable } from '~/components/admin/ResponsiveTable'

export const meta: MetaFunction = () => [{ title: 'Ad Studio — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const campaigns = await listCampaignsWithCreatives(20).catch(() => [] as CampaignWithCreatives[])
  return { campaigns }
}

/** Accept a raw handle or a pasted /products/{slug} URL (zeely-style input). */
function parseProductHandle(raw: string): string {
  const trimmed = raw.trim()
  const m = /\/products\/([a-z0-9-]+)/i.exec(trimmed)
  return (m?.[1] ?? trimmed).toLowerCase()
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')

  try {
    if (intent === 'generate') {
      const handle = parseProductHandle(String(form.get('product') ?? ''))
      const policyCheck = String(form.get('policyCheck') ?? '').trim()
      const platform = String(form.get('platform') ?? 'google') as 'google' | 'meta' | 'tiktok' | 'other'
      if (!handle) return Response.json({ error: 'Product handle or URL required' }, { status: 400 })
      const result = await generateAdBatch({ productHandle: handle, policyCheck, platform })
      return Response.json({ ok: true, ...result })
    }

    if (intent === 'creative-status') {
      const id = Number(form.get('creativeId'))
      const status = String(form.get('status'))
      if (!Number.isFinite(id) || !['approved', 'rejected'].includes(status)) {
        return Response.json({ error: 'Bad creative update' }, { status: 400 })
      }
      await updateCreative(id, { status: status as 'approved' | 'rejected' })
      return Response.json({ ok: true })
    }

    if (intent === 'hook-copy') {
      const id = Number(form.get('creativeId'))
      if (!Number.isFinite(id)) return Response.json({ error: 'Bad creative id' }, { status: 400 })
      await updateCreative(id, { hookCopy: String(form.get('hookCopy') ?? '') })
      return Response.json({ ok: true })
    }

    if (intent === 'campaign-decide') {
      const id = Number(form.get('campaignId'))
      const status = String(form.get('status'))
      if (!Number.isFinite(id) || !['approved', 'rejected'].includes(status)) {
        return Response.json({ error: 'Bad decision' }, { status: 400 })
      }
      await decideAdCampaign(id, status as 'approved' | 'rejected')
      return Response.json({ ok: true })
    }

    if (intent === 'push') {
      const campaignId = Number(form.get('campaignId'))
      const platform = String(form.get('platform') ?? '')
      const campaign = await getCampaign(campaignId)
      if (!campaign) return Response.json({ error: 'Campaign not found' }, { status: 404 })
      if (campaign.status !== 'approved') {
        return Response.json({ error: 'Approve the campaign proposal before pushing' }, { status: 400 })
      }
      const pusher = getAdPusher(platform)
      if (!pusher) return Response.json({ error: `No connector for ${platform}` }, { status: 400 })
      const approved = await db
        .select({ id: adCreatives.id, format: adCreatives.format, hookCopy: adCreatives.hookCopy })
        .from(adCreatives)
        .where(and(eq(adCreatives.adCampaignId, campaignId), eq(adCreatives.status, 'approved')))
      if (!approved.length) return Response.json({ error: 'No approved creatives to push' }, { status: 400 })
      const rows = await listCampaignsWithCreatives(50)
      const full = rows.find(r => r.campaign.id === campaignId)
      const result = await pusher.pushPausedDraft({
        campaignId,
        campaignName: campaign.name,
        policyCheck: campaign.policyCheck,
        creatives: approved.map(c => ({
          format: c.format,
          url: full?.creatives.find(fc => fc.id === c.id)?.blobUrl ?? '',
          hookCopy: c.hookCopy,
        })),
      })
      if (result.ok) {
        await db.update(adCampaigns)
          .set({ externalCampaignId: result.externalCampaignId, updatedAt: new Date() })
          .where(eq(adCampaigns.id, campaignId))
        return Response.json({ ok: true, externalCampaignId: result.externalCampaignId })
      }
      return Response.json({
        ok: false,
        reason: result.reason,
        error: result.detail ?? (result.reason === 'not_configured'
          ? `${platform} API keys are not configured; the push connector is a stub until then.`
          : 'Push blocked'),
      })
    }

    return Response.json({ error: `Unknown intent ${intent}` }, { status: 400 })
  } catch (err) {
    console.error('[ad-studio]', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Action failed' }, { status: 500 })
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdStudioPage() {
  const { campaigns } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const busy = navigation.state !== 'idle'
  const generating = busy && navigation.formData?.get('intent') === 'generate'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
          Ad Studio
        </h1>
        <p className="mt-1 text-xs text-ink-4">
          Paid creative runs the education register (charter 3-4), never the desire-forward organic register.
          Meta and TikTok pushes are policy-blocked for the pleasure catalog; Google restricted-serving and
          adult networks are the real lanes. Pushing creates a PAUSED draft; launching stays a human action.
        </p>
      </div>

      {/* ── Generate a batch ────────────────────────────────────────────── */}
      <section className="rounded-[22px] border border-line bg-paper-2 p-4 md:p-6">
        <h2 className="font-display text-lg text-ink">New creative batch</h2>
        <Form method="post" className="mt-3 space-y-3">
          <input type="hidden" name="intent" value="generate" />
          <div className="flex flex-col gap-3 md:flex-row">
            <label className="flex-1 text-xs text-ink-3">
              Product handle or URL
              <input
                name="product"
                placeholder="satin-blindfold or https://xdipx.com/products/satin-blindfold"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
                required
              />
            </label>
            <label className="text-xs text-ink-3">
              Proposal platform
              <select name="platform" defaultValue="google" className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm md:w-40">
                <option value="google">Google (viable lane)</option>
                <option value="other">Adult network / other</option>
                <option value="meta">Meta (health carve-out only)</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-ink-3">
            Policy check (required, cites docs/ads-policy.md)
            <textarea
              name="policyCheck"
              rows={2}
              required
              minLength={20}
              placeholder="Category fit, why this complies with the platform's restricted-serving rules, residual risk."
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink"
            />
          </label>
          <button type="submit" disabled={busy} className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-paper disabled:opacity-40">
            {generating ? 'Generating batch…' : 'Generate 3 formats (~$0.08)'}
          </button>
        </Form>
      </section>

      {/* ── Batches ─────────────────────────────────────────────────────── */}
      {campaigns.map(({ campaign, creatives }) => (
        <section key={campaign.id} className="rounded-[22px] border border-line bg-paper-2 p-4 md:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-ink">{campaign.name}</h3>
              <p className="text-xs text-ink-3">
                {campaign.platform} · {campaign.objective} ·{' '}
                <span className={campaign.status === 'approved' ? 'text-sage' : campaign.status === 'rejected' ? 'text-coral' : 'text-ink-3'}>
                  {campaign.status}
                </span>
              </p>
            </div>
            {campaign.status === 'proposed' && (
              <div className="flex gap-2">
                {(['approved', 'rejected'] as const).map(s => (
                  <Form key={s} method="post">
                    <input type="hidden" name="intent" value="campaign-decide" />
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="status" value={s} />
                    <button
                      type="submit"
                      disabled={busy}
                      className={`rounded-full px-4 py-1.5 text-sm disabled:opacity-40 ${s === 'approved' ? 'bg-ink text-paper' : 'border border-line text-ink-3'}`}
                    >
                      {s === 'approved' ? 'Approve proposal' : 'Reject'}
                    </button>
                  </Form>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-ink-4">Policy: {campaign.policyCheck.slice(0, 220)}</p>

          {creatives.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {creatives.map(c => (
                <div key={c.id} className="rounded-[14px] border border-line bg-paper p-2">
                  {c.kind === 'video' ? (
                    <video src={c.blobUrl} controls playsInline className="w-full rounded-lg" />
                  ) : (
                    <img src={c.blobUrl} alt="" className="w-full rounded-lg object-cover" />
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-ink-3">{c.format}</span>
                    <span className={`text-xs ${c.status === 'approved' ? 'text-sage' : c.status === 'rejected' ? 'text-coral' : 'text-ink-4'}`}>
                      {c.status}
                    </span>
                  </div>
                  <Form method="post" className="mt-1 flex gap-1">
                    <input type="hidden" name="intent" value="hook-copy" />
                    <input type="hidden" name="creativeId" value={c.id} />
                    <input
                      name="hookCopy"
                      defaultValue={c.hookCopy ?? ''}
                      placeholder="Hook copy overlay"
                      className="min-w-0 flex-1 rounded border border-line bg-paper-2 px-2 py-1 text-xs"
                    />
                    <button type="submit" disabled={busy} className="rounded border border-line px-2 text-xs text-ink-3">Save</button>
                  </Form>
                  {c.status === 'draft' && (
                    <div className="mt-1 flex gap-1">
                      {(['approved', 'rejected'] as const).map(s => (
                        <Form key={s} method="post" className="flex-1">
                          <input type="hidden" name="intent" value="creative-status" />
                          <input type="hidden" name="creativeId" value={c.id} />
                          <input type="hidden" name="status" value={s} />
                          <button type="submit" disabled={busy} className={`w-full rounded px-2 py-1 text-xs disabled:opacity-40 ${s === 'approved' ? 'bg-ink text-paper' : 'border border-line text-ink-3'}`}>
                            {s === 'approved' ? 'Approve' : 'Reject'}
                          </button>
                        </Form>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {campaign.status === 'approved' && (
            <PushRow campaignId={campaign.id} busy={busy} />
          )}
        </section>
      ))}

      {!campaigns.length && (
        <ResponsiveTable>
          <div className="min-w-[320px] py-8 text-center text-sm text-ink-4">
            No creative batches yet. Generate one above, or ads-manager proposals will appear here too.
          </div>
        </ResponsiveTable>
      )}
    </div>
  )
}

function PushRow({ campaignId, busy }: { campaignId: number; busy: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span className="text-xs text-ink-3">Push approved creatives as a PAUSED draft:</span>
      {(['google', 'meta', 'tiktok'] as const).map(p => (
        <Form key={p} method="post">
          <input type="hidden" name="intent" value="push" />
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="platform" value={p} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-ink-3 hover:text-ink disabled:opacity-40"
          >
            {p}
          </button>
        </Form>
      ))}
      <span className="text-xs text-ink-4">(meta/tiktok are policy-blocked for the pleasure catalog)</span>
    </div>
  )
}
