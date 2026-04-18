import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { db } from '~/lib/db.server'
import { pipelineSettings } from '../../db/schema'

export const meta: MetaFunction = () => [{ title: 'IVR — xdipx Admin' }]

const DEFAULTS: Record<string, string> = {
  ivrGreeting: "Hey, you've reached ex-dip. I'm {feeling} you called. This call may be recorded. What's going on?",
  brandVoice:
    "Brand voice: playful, cheeky, warm, curious. Never clinical. Never sleazy. Write as a trusted, funny friend who isn't embarrassed about the topic. Your goal is to welcome first-time buyers and delight experienced ones. Keep all copy tasteful — suggestive is fine, explicit is not. Always signal discretion, value, and trust. Never use \"sex\" as an adjective — use \"intimate\", \"pleasure\", or \"wellness\". Never assume the reader's experience level.",
  ivrFarewellGoodbye: "Thanks for calling ex-dip — have a great one!",
  ivrFarewellMaxPrompts:
    "I really like you — but it might be easier if you send an email to hello at exdipex dot com and we can help you directly. Once again that's hello at exdipex dot com.",
  ivrFarewellMaxDuration: '',
  ivrFarewellSilent: '',
  ivrFeelings: 'so happy,thrilled,super excited,really glad,pumped,stoked,delighted',
  ivrActivities: 'browsing the vault,curating today\'s deal,testing out some new arrivals,organizing the stockroom',
}

export async function loader(_: LoaderFunctionArgs) {
  const rows = await db.select().from(pipelineSettings)
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) {
    if (row.key in DEFAULTS) settings[row.key] = row.value
  }
  return { settings }
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'save-setting') {
    const key = form.get('key') as string
    const value = form.get('value') as string
    if (!key || value === null) return { ok: false, error: 'Missing key or value' }

    await db
      .insert(pipelineSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: pipelineSettings.key, set: { value, updatedAt: new Date() } })

    return { ok: true, saved: key }
  }

  return null
}

export default function AdminIvrPage() {
  const { settings } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<typeof action>()

  function SaveForm({
    label,
    settingKey,
    type = 'text',
    description,
    multiline,
    rows,
  }: {
    label: string
    settingKey: string
    type?: string
    description?: string
    multiline?: boolean
    rows?: number
  }) {
    return (
      <fetcher.Form method="post" className="space-y-1">
        <input type="hidden" name="intent" value="save-setting" />
        <input type="hidden" name="key" value={settingKey} />
        <label className="block text-sm font-semibold text-brand-charcoal">{label}</label>
        {description && <p className="text-xs text-brand-charcoal/50">{description}</p>}
        <div className={`${multiline ? 'flex flex-col gap-2' : 'flex gap-3 items-center'} pt-1`}>
          {multiline ? (
            <textarea
              name="value"
              defaultValue={settings[settingKey] ?? ''}
              rows={rows ?? 4}
              className="w-full border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30 font-body leading-relaxed"
            />
          ) : (
            <input
              type={type}
              name="value"
              defaultValue={settings[settingKey] ?? ''}
              className="flex-1 border border-brand-mist rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
          )}
          <button
            type="submit"
            className={`text-sm font-semibold px-4 py-2 bg-brand-mist text-brand-purple rounded-full hover:bg-brand-purple/10 transition-colors whitespace-nowrap ${multiline ? 'self-start' : ''}`}
          >
            Save
          </button>
        </div>
      </fetcher.Form>
    )
  }

  // Preview: pick a random feeling and activity to show what the greeting sounds like
  const feelings = (settings.ivrFeelings ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const activities = (settings.ivrActivities ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const greeting = (settings.ivrGreeting ?? '')
    .replace('{feeling}', feelings[Math.floor(Math.random() * feelings.length)] ?? 'happy')
    .replace('{activity}', activities[Math.floor(Math.random() * activities.length)] ?? 'working')

  return (
    <div className="max-w-2xl space-y-8">
      <h1
        className="text-2xl font-bold text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        IVR
      </h1>

      {/* Greeting & Placeholders */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2
          className="text-base font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Greeting
        </h2>

        <SaveForm
          label="IVR Greeting"
          settingKey="ivrGreeting"
          multiline
          rows={3}
          description="What the caller hears first. Use {feeling} and {activity} as placeholders — a random value from the lists below is picked each call."
        />

        <SaveForm
          label="Feelings"
          settingKey="ivrFeelings"
          multiline
          rows={3}
          description="Comma-separated list of feelings for the {feeling} placeholder. e.g. so happy, thrilled, pumped"
        />

        <SaveForm
          label="Activity"
          settingKey="ivrActivities"
          multiline
          rows={3}
          description="Comma-separated list of activities for the {activity} placeholder. e.g. browsing the vault, curating today's deal"
        />

        <div className="rounded-xl bg-brand-mist/50 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-brand-charcoal/60 uppercase tracking-wide">
            Preview (random pick)
          </p>
          <p className="text-sm text-brand-charcoal italic">&ldquo;{greeting}&rdquo;</p>
        </div>
      </section>

      {/* Voice & Personality */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2
          className="text-base font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Voice & Personality
        </h2>

        <SaveForm
          label="Brand Voice"
          settingKey="brandVoice"
          multiline
          rows={6}
          description="How Emma sounds on voice and SMS — tone, style, what to avoid. Technical rules (pronunciation, tool behavior) stay locked in code. Leave blank to use defaults."
        />
      </section>

      {/* Farewells */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2
          className="text-base font-bold text-brand-charcoal"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Farewells
        </h2>

        <SaveForm
          label="Goodbye"
          settingKey="ivrFarewellGoodbye"
          multiline
          rows={2}
          description="Happy-path outro when the caller says bye. Injected into the system prompt so Emma says it naturally."
        />

        <SaveForm
          label="Too Many Turns"
          settingKey="ivrFarewellMaxPrompts"
          multiline
          rows={3}
          description="Spoken when the call hits the prompt-count cap (runaway guard). Written for TTS — spell tricky words phonetically (e.g. 'ex-dip-ex dot com')."
        />

        <SaveForm
          label="Max Call Length"
          settingKey="ivrFarewellMaxDuration"
          multiline
          rows={3}
          description="Spoken when the call hits the duration cap."
        />

        <SaveForm
          label="Silent Caller"
          settingKey="ivrFarewellSilent"
          multiline
          rows={2}
          description="Spoken when the caller stops responding. Leave blank to hang up quietly."
        />
      </section>
    </div>
  )
}
