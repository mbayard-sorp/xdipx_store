'use client'

import { useEffect, useState } from 'react'

export type VerificationLevel = 'click_through' | 'dob_entry' | 'id_verify'

interface AgeGateProps {
  verificationLevel?: VerificationLevel
}

const STORAGE_KEY   = 'xdipx_age_verified'
const EXPIRY_DAYS   = 30
const POLICY_VERSION = '1.0'

function isVerified(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw) as { verified: boolean; timestamp: number; version: string }
    const age  = Date.now() - data.timestamp
    return data.verified && age < EXPIRY_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function setVerified(): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ verified: true, timestamp: Date.now(), version: POLICY_VERSION }),
  )
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
          className="flex-1 bg-white text-brand-coral font-bold py-3 px-6 rounded-full text-lg transition-all hover:scale-105 hover:shadow-lg"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Yes, let me in ♥
        </button>
        <a
          href="https://google.com"
          className="flex-1 bg-white/20 text-white font-semibold py-3 px-6 rounded-full text-lg text-center transition-all hover:bg-white/30"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Not yet
        </a>
      </div>

      <p className="text-white/50 text-xs max-w-xs">
        We don't track this. Just keeping things responsible.
      </p>
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
            value={value}
            onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
            className="w-16 text-center bg-white/20 border border-white/30 text-white placeholder-white/50 rounded-xl py-3 text-xl font-bold focus:outline-none focus:border-white"
            style={{ fontFamily: 'var(--font-display)' }}
          />
        ))}
      </div>

      {error && <p className="text-white/80 text-sm">{error}</p>}

      <button
        type="submit"
        className="bg-white text-brand-coral font-bold py-3 px-8 rounded-full text-lg transition-all hover:scale-105 hover:shadow-lg"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Enter ♥
      </button>

      <a href="https://google.com" className="text-white/50 text-sm underline">
        Not old enough
      </a>
    </form>
  )
}

// ── Main AgeGate ─────────────────────────────────────────────────────────────
export function AgeGate({ verificationLevel = 'click_through' }: AgeGateProps) {
  const [visible, setVisible] = useState(false)

  // Only check localStorage on the client; never show gate during SSR
  useEffect(() => {
    if (!isVerified()) setVisible(true)
  }, [])

  function handleConfirm() {
    setVerified()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(135deg, #F04E37 0%, #FF8C38 50%, #7B2FBE 100%)' }}
      aria-modal="true"
      aria-label="Age verification"
    >
      {/* Logo */}
      <div className="mb-10 fade-in">
        <span
          className="text-white text-4xl md:text-5xl font-black tracking-tight select-none"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          xdipx
        </span>
        <span className="text-white/70 text-sm block text-center -mt-1 tracking-widest uppercase">
          daily wellness deals
        </span>
      </div>

      {verificationLevel === 'dob_entry' ? (
        <DobEntryGate onConfirm={handleConfirm} />
      ) : (
        <ClickThroughGate onConfirm={handleConfirm} />
      )}

      {/* id_verify level: placeholder — integrate third-party SDK here when needed */}
      {verificationLevel === 'id_verify' && (
        <p className="mt-6 text-white/60 text-xs text-center max-w-xs">
          ID verification required in your state. Integration pending.
        </p>
      )}
    </div>
  )
}
