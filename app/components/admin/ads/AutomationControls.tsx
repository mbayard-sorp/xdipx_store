/**
 * Automation section on /admin/ads/settings (ads control plane plan, sections 5 and
 * 9.4). Four owner-only valves: the auto-apply switch and three limits. Same
 * shape as CapControl: admins see the values and "Owner only", the owner gets
 * Edit, and every save goes through the audited settings setter on the server.
 * The switch saves on its own; the three numbers save together.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFetcher } from 'react-router'
import { useAdsToast } from './AdsToast'
import { formatMoney } from '~/lib/ad-metrics-core'

export interface AutomationControlsData {
  spendEnabled: boolean
  autoApplyEnabled: boolean
  autoApplyAllowed: boolean
  autoActionsMaxPerDay: number
  budgetMaxStepPct: number
  leadCplCeilingCents: number
}

type ActionData = { ok: true; intent: string; message: string } | { ok: false; intent?: string; error: string }

function plainDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

const INPUT = 'min-h-11 w-full rounded-xl border border-line bg-paper px-3 font-mono text-base tabular-nums text-ink focus:border-ink focus:outline-none'

function AutoApplySwitch({ data, isOwner, actionPath }: { data: AutomationControlsData; isOwner: boolean; actionPath: string }) {
  const fetcher = useFetcher<ActionData>()
  const toast = useAdsToast()
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const on = pending && fetcher.formData ? fetcher.formData.get('next') === 'true' : data.autoApplyEnabled
  const result = fetcher.data

  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) toast.show({ message: result.message })
  }, [fetcher.state, result, toast])

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper-2 p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">
          Auto-apply: <span className={on ? 'text-plum' : 'text-ink-3'}>{on ? 'on' : 'off'}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          Lets rules pause ads and cut budgets without asking you. Anything that raises spend still waits for your tap.
        </p>
        {on && !data.spendEnabled && (
          <p className="mt-1 text-xs text-amber-800">Spend is off, so nothing applies until both are on.</p>
        )}
        {result && !result.ok && !pending && <p role="alert" className="mt-1 text-xs text-red-700">{result.error}</p>}
      </div>
      {isOwner ? (
        <fetcher.Form method="post" action={actionPath} className="shrink-0">
          <input type="hidden" name="intent" value="toggle-auto-apply" />
          <input type="hidden" name="next" value={String(!data.autoApplyEnabled)} />
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
          >
            {pending ? 'Saving' : data.autoApplyEnabled ? 'Turn off' : 'Turn on'}
          </button>
        </fetcher.Form>
      ) : (
        <span className="text-xs text-ink-3">Owner only</span>
      )}
    </div>
  )
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-ink-3">{label}</span>
      <span className="mt-1 flex items-center gap-2">{children}</span>
      <span className="mt-1 block text-xs text-ink-4">{help}</span>
    </label>
  )
}

const HELP = {
  actions: 'The most changes rules may make on their own in one day.',
  step: 'The biggest budget change one action may make, as a percent of the current budget.',
  cpl: 'What you will pay for one new email signup. Lead campaign rules compare cost per lead to this.',
}

export function AutomationControls({ data, isOwner, actionPath }: { data: AutomationControlsData; isOwner: boolean; actionPath: string }) {
  const fetcher = useFetcher<ActionData>()
  const toast = useAdsToast()
  const [editing, setEditing] = useState(false)
  const [actions, setActions] = useState(String(data.autoActionsMaxPerDay))
  const [step, setStep] = useState(String(data.budgetMaxStepPct))
  const [cpl, setCpl] = useState(plainDollars(data.leadCplCeilingCents))
  const handled = useRef<unknown>(null)
  const pending = fetcher.state !== 'idle'
  const result = fetcher.data
  const error = result && !result.ok && !pending ? result.error : null

  useEffect(() => {
    if (fetcher.state !== 'idle' || !result || handled.current === result) return
    handled.current = result
    if (result.ok) {
      setEditing(false)
      toast.show({ message: result.message })
    }
  }, [fetcher.state, result, toast])

  function startEdit() {
    setActions(String(data.autoActionsMaxPerDay))
    setStep(String(data.budgetMaxStepPct))
    setCpl(plainDollars(data.leadCplCeilingCents))
    setEditing(true)
  }

  return (
    <section aria-label="Automation" className="rounded-2xl border border-line bg-paper p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="kicker">Automation</p>
        {isOwner && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
          >
            Edit limits
          </button>
        )}
      </div>

      <div className="mt-3">
        <AutoApplySwitch data={data} isOwner={isOwner} actionPath={actionPath} />
      </div>

      {!editing ? (
        <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { label: 'Actions per day', value: String(data.autoActionsMaxPerDay), help: HELP.actions },
            { label: 'Budget step', value: `${data.budgetMaxStepPct}%`, help: HELP.step },
            { label: 'Lead price ceiling', value: formatMoney(data.leadCplCeilingCents), help: HELP.cpl },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-line bg-paper-2 p-3">
              <dt className="text-xs text-ink-3">{item.label}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-ink">{item.value}</dd>
              <dd className="mt-1 text-xs text-ink-4">{item.help}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <fetcher.Form method="post" action={actionPath} className="mt-3 space-y-3" aria-busy={pending}>
          <input type="hidden" name="intent" value="save-automation" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Actions per day" help={HELP.actions}>
              <input name="maxActionsPerDay" inputMode="numeric" autoComplete="off" value={actions} readOnly={pending}
                onChange={e => setActions(e.target.value)} aria-invalid={!!error} className={INPUT} />
            </Field>
            <Field label="Budget step" help={HELP.step}>
              <input name="maxStepPct" inputMode="numeric" autoComplete="off" value={step} readOnly={pending}
                onChange={e => setStep(e.target.value)} aria-invalid={!!error} className={INPUT} />
              <span className="font-mono text-ink-3" aria-hidden="true">%</span>
            </Field>
            <Field label="Lead price ceiling" help={HELP.cpl}>
              <span className="font-mono text-ink-3" aria-hidden="true">$</span>
              <input name="leadCplCeiling" inputMode="decimal" autoComplete="off" value={cpl} readOnly={pending}
                onChange={e => setCpl(e.target.value)} aria-invalid={!!error} className={INPUT} />
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className="min-h-11 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 disabled:opacity-60 touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-full bg-ink px-4 text-sm font-semibold text-paper disabled:opacity-60 touch-manipulation"
            >
              {pending ? 'Saving' : 'Save limits'}
            </button>
          </div>
        </fetcher.Form>
      )}

      {!isOwner && <p className="mt-3 text-sm text-ink-3">Owner only.</p>}
    </section>
  )
}
