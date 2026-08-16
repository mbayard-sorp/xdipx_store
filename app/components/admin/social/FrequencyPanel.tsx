import { useFetcher } from 'react-router'
import { PLATFORM_LABELS } from './types'

/**
 * Per-platform posting frequency (posts/day, 0 = platform off) backed by the
 * social_freq_* pipeline_settings keys, plus a read-only view of the
 * graduation valves. Frequencies size the social team's per-platform draft
 * quota; the valves stay a deliberate flip on /admin/homepage-team.
 */
export function FrequencyPanel({ frequencies, igAutopublish, xAutopublish }: {
  frequencies: Record<string, number>
  igAutopublish: boolean
  xAutopublish: boolean
}) {
  const anyAutopublish = igAutopublish || xAutopublish
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-coral-soft border border-coral/20 p-4">
        <p className="text-sm font-semibold text-ink">
          {anyAutopublish ? 'Autopublish is ON' : 'Internal review mode'}
        </p>
        <p className="text-xs text-ink-3 mt-1">
          {anyAutopublish ? (
            <>
              Approved drafts publish on their own for{' '}
              {[igAutopublish && 'Instagram', xAutopublish && 'X'].filter(Boolean).join(' and ')},
              hourly, without waiting for you. The pre-publish gate is what approves them. Turn a
              platform off on the Agent Teams page.
            </>
          ) : (
            <>
              Nothing posts publicly. Every draft waits for your review here. Flip a platform's
              autopublish valve on the Agent Teams page to let approved drafts go out on their own.
              TikTok and YouTube have no publisher and are always posted by hand.
            </>
          )}
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-line p-4 md:p-6">
        <h3 className="text-sm font-semibold text-ink mb-1">Posts per day, per platform</h3>
        <p className="text-xs text-ink-4 mb-4">
          Sets how many drafts the team writes for each platform on its daily run. 0 turns a platform off.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(frequencies).map(([platform, value]) => (
            <FrequencyStepper key={platform} platform={platform} value={value} />
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-line p-4 md:p-6 space-y-3">
        <h3 className="text-sm font-semibold text-ink">Autopublish valves (read-only)</h3>
        <ValveStatus
          label="instagram_autopublish_enabled"
          on={igAutopublish}
          note="Approved Instagram drafts publish hourly. Flip on the Agent Teams page."
        />
        <ValveStatus
          label="x_autopublish_enabled"
          on={xAutopublish}
          note="Approved X drafts publish hourly, capped by x_publish_max_per_day and a monthly spend ceiling. X bills per post."
        />
      </section>
    </div>
  )
}

function FrequencyStepper({ platform, value }: { platform: string; value: number }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>()
  const pendingValue = fetcher.formData?.get('value')
  const shown = pendingValue != null ? Number(pendingValue) : value
  const isSubmitting = fetcher.state !== 'idle'

  function set(next: number) {
    if (next < 0 || next > 5) return
    fetcher.submit(
      { intent: 'set-frequency', key: `social_freq_${platform}`, value: String(next) },
      { method: 'post' },
    )
  }

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border border-line p-3 ${shown === 0 ? 'opacity-60' : ''}`}>
      <div>
        <p className="text-sm font-medium text-ink">{PLATFORM_LABELS[platform] ?? platform}</p>
        <p className="text-[11px] text-ink-4">{shown === 0 ? 'Off' : `${shown}/day`}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => set(shown - 1)}
          disabled={isSubmitting || shown <= 0}
          className="w-8 h-8 rounded-full border border-line text-ink hover:border-ink-4 disabled:opacity-40"
          aria-label={`Fewer ${platform} posts`}
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-semibold text-ink tabular-nums">{shown}</span>
        <button
          onClick={() => set(shown + 1)}
          disabled={isSubmitting || shown >= 5}
          className="w-8 h-8 rounded-full border border-line text-ink hover:border-ink-4 disabled:opacity-40"
          aria-label={`More ${platform} posts`}
        >
          +
        </button>
      </div>
      {fetcher.data?.ok === false && (
        <p className="text-xs text-red-500">{fetcher.data.error}</p>
      )}
    </div>
  )
}

function ValveStatus({ label, on, note }: { label: string; on: boolean; note: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <code className="text-xs text-ink">{label}</code>
        <p className="text-[11px] text-ink-4">{note}</p>
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
        on ? 'bg-green-100 text-green-700' : 'bg-paper-3 text-ink-4'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-green-500' : 'bg-ink-4'}`} />
        {on ? 'On' : 'Off'}
      </span>
    </div>
  )
}
