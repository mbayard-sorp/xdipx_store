import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { useState } from 'react'
import { eq, inArray, ne } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { ivrVoices, pipelineSettings } from '../../db/schema'

type VoiceRow = {
  id: number | null
  name: string
  voiceId: string
  notes: string
  active: boolean
}

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
  ivrActivities: 'browsing the shelf,curating Emma\'s next pick,testing out some new arrivals,organizing the stockroom',
}

export async function loader(_: LoaderFunctionArgs) {
  const rows = await db.select().from(pipelineSettings)
  const settings: Record<string, string> = { ...DEFAULTS }
  for (const row of rows) {
    if (row.key in DEFAULTS) settings[row.key] = row.value
  }

  let voices = await db.select().from(ivrVoices).orderBy(ivrVoices.id)
  if (voices.length === 0) {
    const seedVoiceId = process.env['ELEVENLABS_VOICE_ID_IVR']
    if (seedVoiceId) {
      try {
        await db
          .insert(ivrVoices)
          .values({
            name: 'Default (from env)',
            voiceId: seedVoiceId,
            notes: 'Seeded from ELEVENLABS_VOICE_ID_IVR on first load',
            active: true,
          })
          .onConflictDoNothing({ target: ivrVoices.voiceId })
        voices = await db.select().from(ivrVoices).orderBy(ivrVoices.id)
      } catch (err) {
        console.error('[admin.ivr] failed to seed initial voice', err)
      }
    }
  }

  return { settings, voices }
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

  if (intent === 'save-voices') {
    const payload = form.get('voices') as string
    if (!payload) return { ok: false, error: 'Missing voices payload' }

    let parsed: Array<VoiceRow & { _delete?: boolean }>
    try {
      parsed = JSON.parse(payload)
    } catch {
      return { ok: false, error: 'Invalid JSON payload' }
    }

    const deleteIds = parsed.filter((r) => r._delete && r.id != null).map((r) => r.id as number)
    if (deleteIds.length > 0) {
      await db.delete(ivrVoices).where(inArray(ivrVoices.id, deleteIds))
    }

    const keep = parsed.filter((r) => !r._delete)
    const cleaned = keep.map((r) => ({
      ...r,
      name: (r.name ?? '').trim(),
      voiceId: (r.voiceId ?? '').trim(),
      notes: (r.notes ?? '').trim(),
      active: Boolean(r.active),
    }))

    const activeRows = cleaned.filter((r) => r.active && r.voiceId)
    const activeWinner = activeRows[activeRows.length - 1] ?? null

    const now = new Date()
    let winnerPersistedId: number | null = activeWinner?.id ?? null

    for (const row of cleaned) {
      if (!row.name || !row.voiceId) continue
      const isWinner = activeWinner ? row === activeWinner : false
      const active = isWinner
      if (row.id == null) {
        const inserted = await db
          .insert(ivrVoices)
          .values({ name: row.name, voiceId: row.voiceId, notes: row.notes, active, updatedAt: now })
          .onConflictDoUpdate({
            target: ivrVoices.voiceId,
            set: { name: row.name, notes: row.notes, active, updatedAt: now },
          })
          .returning({ id: ivrVoices.id })
        if (isWinner && inserted[0]) winnerPersistedId = inserted[0].id
      } else {
        await db
          .update(ivrVoices)
          .set({ name: row.name, voiceId: row.voiceId, notes: row.notes, active, updatedAt: now })
          .where(eq(ivrVoices.id, row.id))
        if (isWinner) winnerPersistedId = row.id
      }
    }

    if (winnerPersistedId != null) {
      await db.update(ivrVoices).set({ active: false, updatedAt: now }).where(ne(ivrVoices.id, winnerPersistedId))
    }

    return { ok: true, saved: 'voices' }
  }

  return null
}

type SaveFormProps = {
  fetcher: ReturnType<typeof useFetcher<typeof action>>
  settings: Record<string, string>
  label: string
  settingKey: string
  type?: string
  description?: string
  multiline?: boolean
  rows?: number
}

function SaveForm({
  fetcher,
  settings,
  label,
  settingKey,
  type = 'text',
  description,
  multiline,
  rows,
}: SaveFormProps) {
  return (
    <fetcher.Form method="post" className="space-y-1">
      <input type="hidden" name="intent" value="save-setting" />
      <input type="hidden" name="key" value={settingKey} />
      <label className="block text-sm font-semibold text-ink">{label}</label>
      {description && <p className="text-xs text-ink/50">{description}</p>}
      <div className={`${multiline ? 'flex flex-col gap-2' : 'flex gap-3 items-center'} pt-1`}>
        {multiline ? (
          <textarea
            name="value"
            defaultValue={settings[settingKey] ?? ''}
            rows={rows ?? 4}
            className="w-full border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 font-body leading-relaxed"
          />
        ) : (
          <input
            type={type}
            name="value"
            defaultValue={settings[settingKey] ?? ''}
            className="flex-1 border border-cream-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
          />
        )}
        <button
          type="submit"
          className={`text-sm font-semibold px-4 py-2 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors whitespace-nowrap ${multiline ? 'self-start' : ''}`}
        >
          Save
        </button>
      </div>
    </fetcher.Form>
  )
}

export default function AdminIvrPage() {
  const { settings, voices } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<typeof action>()
  const voicesFetcher = useFetcher<typeof action>()

  const [voiceRows, setVoiceRows] = useState<Array<VoiceRow & { _delete?: boolean }>>(
    () => voices.map((v) => ({ id: v.id, name: v.name, voiceId: v.voiceId, notes: v.notes, active: v.active })),
  )

  function updateRow(idx: number, patch: Partial<VoiceRow & { _delete?: boolean }>) {
    setVoiceRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function setActive(idx: number) {
    setVoiceRows((rows) => rows.map((r, i) => ({ ...r, active: i === idx })))
  }

  function addRow() {
    setVoiceRows((rows) => [...rows, { id: null, name: '', voiceId: '', notes: '', active: false }])
  }

  function markDelete(idx: number) {
    setVoiceRows((rows) => {
      const row = rows[idx]
      if (!row) return rows
      // New unsaved row → drop locally. Existing row → mark for deletion on save.
      if (row.id == null) return rows.filter((_, i) => i !== idx)
      return rows.map((r, i) => (i === idx ? { ...r, _delete: true } : r))
    })
  }

  function saveVoices() {
    voicesFetcher.submit(
      { intent: 'save-voices', voices: JSON.stringify(voiceRows) },
      { method: 'post' },
    )
  }

  const visibleRows = voiceRows
    .map((r, i) => ({ row: r, idx: i }))
    .filter(({ row }) => !row._delete)

  // Preview: pick a random feeling and activity to show what the greeting sounds like
  const feelings = (settings.ivrFeelings ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const activities = (settings.ivrActivities ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const greeting = (settings.ivrGreeting ?? '')
    .replace('{feeling}', feelings[Math.floor(Math.random() * feelings.length)] ?? 'happy')
    .replace('{activity}', activities[Math.floor(Math.random() * activities.length)] ?? 'working')

  return (
    <div className="max-w-2xl space-y-8">
      <h1
        className="text-2xl font-bold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        IVR
      </h1>

      {/* ElevenLabs Voice Library */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2
            className="text-base font-bold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            IVR Voice
          </h2>
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-semibold px-3 py-1.5 bg-cream-2 text-sage rounded-full hover:bg-sage/10 transition-colors"
          >
            + Add Voice
          </button>
        </div>
        <p className="text-xs text-ink/50">
          The row marked <strong>Active</strong> is used for live calls. Swap anytime — no deploy needed.
          If nothing is active, the IVR falls back to the <code>ELEVENLABS_VOICE_ID_IVR</code> env var.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-cream-2">
                <th className="py-2 pr-3 w-16">Active</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Voice ID</th>
                <th className="py-2 pr-3">Notes</th>
                <th className="py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-ink/50">
                    No voices yet. Click <strong>+ Add Voice</strong> to get started.
                  </td>
                </tr>
              )}
              {visibleRows.map(({ row, idx }) => (
                <tr key={row.id ?? `new-${idx}`} className="border-b border-cream-2/50 last:border-0">
                  <td className="py-2 pr-3 align-top">
                    <input
                      type="radio"
                      name="activeVoice"
                      checked={row.active}
                      onChange={() => setActive(idx)}
                      className="mt-2 h-4 w-4 accent-sage"
                    />
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(idx, { name: e.target.value })}
                      placeholder="e.g. George"
                      className="w-full border border-cream-2 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30"
                    />
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <input
                      type="text"
                      value={row.voiceId}
                      onChange={(e) => updateRow(idx, { voiceId: e.target.value })}
                      placeholder="e.g. JBFqnCBsd6RMkjVDRZzb"
                      className="w-full border border-cream-2 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sage/30"
                    />
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <textarea
                      value={row.notes}
                      onChange={(e) => updateRow(idx, { notes: e.target.value })}
                      rows={1}
                      placeholder="warm male narrator"
                      className="w-full border border-cream-2 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 resize-y"
                    />
                  </td>
                  <td className="py-2 align-top">
                    <button
                      type="button"
                      onClick={() => markDelete(idx)}
                      className="text-ink/40 hover:text-coral transition-colors px-2 py-1"
                      title="Delete voice"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={saveVoices}
            disabled={voicesFetcher.state !== 'idle'}
            className="text-sm font-semibold px-4 py-2 bg-sage text-white rounded-full hover:bg-sage/90 transition-colors disabled:opacity-50"
          >
            {voicesFetcher.state !== 'idle' ? 'Saving…' : 'Save Voices'}
          </button>
          {voicesFetcher.data?.ok && (
            <span className="text-xs text-ink/50">Saved.</span>
          )}
          {voicesFetcher.data && 'error' in voicesFetcher.data && voicesFetcher.data.error && (
            <span className="text-xs text-coral">{voicesFetcher.data.error}</span>
          )}
        </div>
      </section>

      {/* Greeting & Placeholders */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Greeting
        </h2>

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="IVR Greeting"
          settingKey="ivrGreeting"
          multiline
          rows={3}
          description="What the caller hears first. Use {feeling} and {activity} as placeholders — a random value from the lists below is picked each call."
        />

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="Feelings"
          settingKey="ivrFeelings"
          multiline
          rows={3}
          description="Comma-separated list of feelings for the {feeling} placeholder. e.g. so happy, thrilled, pumped"
        />

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="Activity"
          settingKey="ivrActivities"
          multiline
          rows={3}
          description="Comma-separated list of activities for the {activity} placeholder. e.g. browsing the shelf, curating Emma's next pick"
        />

        <div className="rounded-xl bg-cream-2/50 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-ink/60 uppercase tracking-wide">
            Preview (random pick)
          </p>
          <p className="text-sm text-ink italic">&ldquo;{greeting}&rdquo;</p>
        </div>
      </section>

      {/* Voice & Personality */}
      <section className="bg-white rounded-2xl p-6 shadow-sm space-y-6">
        <h2
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Voice & Personality
        </h2>

        <SaveForm
          fetcher={fetcher}
          settings={settings}
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
          className="text-base font-bold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Farewells
        </h2>

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="Goodbye"
          settingKey="ivrFarewellGoodbye"
          multiline
          rows={2}
          description="Happy-path outro when the caller says bye. Injected into the system prompt so Emma says it naturally."
        />

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="Too Many Turns"
          settingKey="ivrFarewellMaxPrompts"
          multiline
          rows={3}
          description="Spoken when the call hits the prompt-count cap (runaway guard). Written for TTS — spell tricky words phonetically (e.g. 'ex-dip-ex dot com')."
        />

        <SaveForm
          fetcher={fetcher}
          settings={settings}
          label="Max Call Length"
          settingKey="ivrFarewellMaxDuration"
          multiline
          rows={3}
          description="Spoken when the call hits the duration cap."
        />

        <SaveForm
          fetcher={fetcher}
          settings={settings}
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
