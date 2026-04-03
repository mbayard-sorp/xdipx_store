/**
 * /admin/reviews/settings — Review system configuration.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, Form } from 'react-router'
import { requireAdmin }        from '~/lib/session.server'
import { getReviewSettings, updateReviewSettings } from '~/lib/reviews.server'

export const meta: MetaFunction = () => [{ title: 'Review Settings — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdmin(request)
  const settings = await getReviewSettings()
  return { settings }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)
  const form = await request.formData()

  await updateReviewSettings({
    autoApprove:           form.get('autoApprove')           === 'true',
    spamThreshold:         parseFloat(form.get('spamThreshold')  as string ?? '0.75'),
    minBodyLength:         parseInt(form.get('minBodyLength')    as string ?? '0', 10),
    requireTitle:          form.get('requireTitle')          === 'true',
    inviteDelayDays:       parseInt(form.get('inviteDelayDays')  as string ?? '3', 10),
    reminderDelayDays:     parseInt(form.get('reminderDelayDays') as string ?? '5', 10),
    remindersEnabled:      form.get('remindersEnabled')      === 'true',
    reviewsPerPage:        parseInt(form.get('reviewsPerPage')   as string ?? '10', 10),
    defaultSort:           form.get('defaultSort') as string ?? 'newest',
    showAiSummaries:       form.get('showAiSummaries')       === 'true',
    showIncentivizedLabel: form.get('showIncentivizedLabel') === 'true',
    digestEmail:           (form.get('digestEmail') as string | null) || null,
    webhookUrl:            (form.get('webhookUrl')  as string | null) || null,
  })

  return Response.json({ ok: true, saved: true })
}

function Toggle({
  name, label, defaultChecked, description,
}: { name: string; label: string; defaultChecked: boolean; description?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-brand-mist last:border-0">
      <div>
        <p className="text-sm font-medium text-brand-charcoal">{label}</p>
        {description && <p className="text-xs text-brand-charcoal/50 mt-0.5">{description}</p>}
      </div>
      <div className="flex gap-3 shrink-0">
        <label className="inline-flex items-center gap-1.5 text-xs text-brand-charcoal/60">
          <input type="radio" name={name} value="true"  defaultChecked={defaultChecked}  className="accent-brand-purple" />
          On
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-brand-charcoal/60">
          <input type="radio" name={name} value="false" defaultChecked={!defaultChecked} className="accent-brand-purple" />
          Off
        </label>
      </div>
    </div>
  )
}

export default function AdminReviewSettings() {
  const { settings } = useLoaderData<typeof loader>()

  return (
    <div className="max-w-2xl">
      <h1
        className="text-2xl font-bold text-brand-charcoal mb-8"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Review Settings
      </h1>

      <Form method="post" className="space-y-6">
        {/* 1. Moderation */}
        <section className="bg-white rounded-2xl border border-brand-mist p-5">
          <p className="font-semibold text-brand-charcoal mb-4 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Moderation
          </p>
          <Toggle name="autoApprove" label="Auto-approve reviews" defaultChecked={settings.autoApprove}
            description="AI-approved reviews publish automatically unless spam score exceeds threshold." />
          <div className="py-3 border-b border-brand-mist">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Spam threshold</label>
            <p className="text-xs text-brand-charcoal/50 mb-2">Reviews scoring above this are auto-flagged as spam (0–1)</p>
            <input
              name="spamThreshold"
              type="number"
              min="0" max="1" step="0.05"
              defaultValue={settings.spamThreshold}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-32 focus:outline-none focus:border-brand-purple"
            />
          </div>
          <div className="py-3">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Min body length (chars)</label>
            <input
              name="minBodyLength"
              type="number"
              min="0" step="1"
              defaultValue={settings.minBodyLength}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-32 focus:outline-none focus:border-brand-purple"
            />
          </div>
          <Toggle name="requireTitle" label="Require review title" defaultChecked={settings.requireTitle} />
        </section>

        {/* 2. Invite settings */}
        <section className="bg-white rounded-2xl border border-brand-mist p-5">
          <p className="font-semibold text-brand-charcoal mb-4 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Email Invites
          </p>
          <div className="py-3 border-b border-brand-mist">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Invite delay (days after fulfillment)</label>
            <input
              name="inviteDelayDays"
              type="number"
              min="1" step="1"
              defaultValue={settings.inviteDelayDays}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-24 focus:outline-none focus:border-brand-purple"
            />
          </div>
          <Toggle name="remindersEnabled" label="Send reminder emails" defaultChecked={settings.remindersEnabled} />
          <div className="py-3">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Reminder delay (days after invite)</label>
            <input
              name="reminderDelayDays"
              type="number"
              min="1" step="1"
              defaultValue={settings.reminderDelayDays}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-24 focus:outline-none focus:border-brand-purple"
            />
          </div>
        </section>

        {/* 3. Display */}
        <section className="bg-white rounded-2xl border border-brand-mist p-5">
          <p className="font-semibold text-brand-charcoal mb-4 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Display
          </p>
          <div className="py-3 border-b border-brand-mist">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Reviews per page</label>
            <input
              name="reviewsPerPage"
              type="number"
              min="5" max="50" step="5"
              defaultValue={settings.reviewsPerPage}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-24 focus:outline-none focus:border-brand-purple"
            />
          </div>
          <div className="py-3 border-b border-brand-mist">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Default sort</label>
            <select
              name="defaultSort"
              defaultValue={settings.defaultSort}
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-brand-purple"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="highest">Highest rated</option>
              <option value="helpful">Most helpful</option>
            </select>
          </div>
          <Toggle name="showAiSummaries"       label="Show AI summaries"         defaultChecked={settings.showAiSummaries} />
          <Toggle name="showIncentivizedLabel" label="Show incentivized label"   defaultChecked={settings.showIncentivizedLabel} />
        </section>

        {/* 4. Notifications */}
        <section className="bg-white rounded-2xl border border-brand-mist p-5">
          <p className="font-semibold text-brand-charcoal mb-4 text-sm" style={{ fontFamily: 'var(--font-display)' }}>
            Notifications
          </p>
          <div className="py-3 border-b border-brand-mist">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Digest email</label>
            <p className="text-xs text-brand-charcoal/50 mb-2">Receive daily new review digest</p>
            <input
              name="digestEmail"
              type="email"
              defaultValue={settings.digestEmail ?? ''}
              placeholder="admin@xdipx.com"
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:border-brand-purple"
            />
          </div>
          <div className="py-3">
            <label className="text-sm font-medium text-brand-charcoal block mb-1">Webhook URL</label>
            <p className="text-xs text-brand-charcoal/50 mb-2">POST on each new review (optional)</p>
            <input
              name="webhookUrl"
              type="url"
              defaultValue={settings.webhookUrl ?? ''}
              placeholder="https://..."
              className="border border-brand-mist rounded-xl px-3 py-2 text-sm w-full focus:outline-none focus:border-brand-purple"
            />
          </div>
        </section>

        <button
          type="submit"
          className="bg-brand-gradient text-white font-semibold px-8 py-3 rounded-full hover:opacity-90 transition-opacity"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Save Settings ♥
        </button>
      </Form>
    </div>
  )
}
