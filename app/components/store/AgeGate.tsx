import { useState } from 'react'
import { useAgeVerified } from '~/lib/use-age-verified'

export type VerificationLevel = 'click_through' | 'dob_entry' | 'id_verify'

interface AgeGatePanelProps {
  verificationLevel?: VerificationLevel
}

// ── Click-through (default) ──────────────────────────────────────────────────
function ClickThroughGate({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 fade-in text-center">
      <p
        className="text-xl md:text-2xl font-semibold text-white leading-snug max-w-sm"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Hey there. xdipx is a grown-ups-only kind of place.
        <br />
        <span className="opacity-90">Are you 18 or older?</span>
      </p>

      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <button
          onClick={onConfirm}
          className="flex-1 bg-white text-coral font-bold py-3 px-6 rounded-full text-lg transition-all hover:scale-105 hover:shadow-lg"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Yes, let me in ♥
        </button>
        <a
          href="https://google.com"
          className="flex-1 bg-white/40 hover:bg-white/55 border border-white/60 text-white font-semibold py-3 px-6 rounded-full text-lg text-center transition-all focus-ring"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Not yet
        </a>
      </div>
    </div>
  )
}

// ── DOB entry ────────────────────────────────────────────────────────────────
function DobEntryGate({ onConfirm }: { onConfirm: () => void }) {
  const [month, setMonth] = useState('')
  const [day,   setDay]   = useState('')
  const [year,  setYear]  = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const dob  = new Date(`${year}-${month}-${day}`)
    const now  = new Date()
    const age  = now.getFullYear() - dob.getFullYear()
             - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0)

    if (isNaN(dob.getTime())) { setError('Please enter a valid date.'); return }
    if (age < 18)             { setError("Sorry, you must be 18 or older."); return }
    onConfirm()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col items-center gap-5 fade-in text-center"
    >
      <p
        className="text-xl md:text-2xl font-semibold text-white leading-snug max-w-sm"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Enter your date of birth to continue.
      </p>

      <div className="flex gap-2">
        {[
          { placeholder: 'MM', value: month, onChange: setMonth, max: 2 },
          { placeholder: 'DD', value: day,   onChange: setDay,   max: 2 },
          { placeholder: 'YYYY', value: year, onChange: setYear, max: 4 },
        ].map(({ placeholder, value, onChange, max }) => (
          <input
            key={placeholder}
            type="text"
            inputMode="numeric"
            maxLength={max}
            placeholder={placeholder}
            aria-label={placeholder === 'MM' ? 'Month' : placeholder === 'DD' ? 'Day' : 'Year'}
            value={value}
            onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
            className="w-16 text-center bg-white/20 border border-white/30 text-white placeholder-white/50 rounded-xl py-3 text-xl font-bold focus-ring"
            style={{ fontFamily: 'var(--font-display)' }}
          />
        ))}
      </div>

      {error && <p className="text-white/80 text-sm">{error}</p>}

      <button
        type="submit"
        className="bg-white text-coral font-bold py-3 px-8 rounded-full text-lg transition-all hover:scale-105 hover:shadow-lg"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Enter ♥
      </button>

      <a href="https://google.com" className="text-white/80 text-sm underline">
        Not old enough
      </a>
    </form>
  )
}

// ── AgeGatePanel ─────────────────────────────────────────────────────────────
// Embeddable gradient panel with no fixed-overlay shell. Used inside the cart
// drawer to gate cart contents until the visitor confirms 18+.
export function AgeGatePanel({ verificationLevel = 'click_through' }: AgeGatePanelProps) {
  const { confirm } = useAgeVerified()

  return (
    <div
      className="relative w-full max-w-md mx-auto rounded-3xl shadow-xl px-6 py-8 sm:px-8 sm:py-10 flex flex-col items-center"
      style={{ background: 'linear-gradient(135deg, #F04E37 0%, #FF8C38 50%, #7B2FBE 100%)' }}
      role="region"
      aria-label="Age verification"
    >
      <div className="mb-6 fade-in">
        <span
          className="text-white text-3xl md:text-4xl font-black tracking-tight select-none block text-center"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          xdipx
        </span>
        <span className="text-white/70 text-xs block text-center -mt-1 tracking-widest uppercase">
          daily wellness deals
        </span>
      </div>

      {verificationLevel === 'dob_entry' ? (
        <DobEntryGate onConfirm={confirm} />
      ) : (
        <ClickThroughGate onConfirm={confirm} />
      )}

      {verificationLevel === 'id_verify' && (
        <p className="mt-6 text-white/60 text-xs text-center max-w-xs">
          ID verification required in your state. Integration pending.
        </p>
      )}
    </div>
  )
}
