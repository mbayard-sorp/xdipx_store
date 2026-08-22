/**
 * EmmaChatPanel sub-components: Bubble, TypingDots, QuickReplyRow, FilterActionCard.
 *
 * Style Guide Nº 01: white paper surfaces, Newsreader (display serif), DM Sans
 * (body), JetBrains Mono (kicker). Emma bubble = paper-3 off-white. User
 * bubble = coral. Chips follow the Chip.tsx pattern (paper / line-2 border /
 * ink-fill-on with coral dot prefix).
 *
 * Purely presentational. No state lives here.
 */

import { useEffect, useRef, useState } from 'react'
import type { ToolCallPayload } from './EmmaChatPanel'

/* ─── Motion helpers ────────────────────────────────────────────────────── */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ─── Bubble ──────────────────────────────────────────────────────────────
 * Mount-in: translateY(8px)→0 + opacity 0→1 over 180ms.
 * Reduced-motion: opacity-only.
 */

interface BubbleProps {
  role: 'user' | 'assistant'
  children: React.ReactNode
}

export function Bubble({ role, children }: BubbleProps) {
  const [entered, setEntered] = useState(false)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = prefersReducedMotion()
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const baseTransition = 'transition-[opacity,transform] duration-[180ms] ease-out'
  const enteredStyle = entered
    ? 'opacity-100 translate-y-0'
    : reduced.current
    ? 'opacity-0'
    : 'opacity-0 translate-y-2'

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className={[
            'bg-coral text-paper rounded-[18px] rounded-br-[8px] px-4 py-2.5 max-w-[85%]',
            'text-[14px] leading-[20px] font-medium',
            baseTransition,
            enteredStyle,
          ].join(' ')}
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div
        className={[
          'bg-paper-3 text-ink rounded-[18px] rounded-bl-[8px] px-4 py-2.5 max-w-[85%]',
          'text-[14px] leading-[20px]',
          baseTransition,
          enteredStyle,
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {children}
      </div>
    </div>
  )
}

/* ─── TypingDots ──────────────────────────────────────────────────────────
 * Three 6px dots in an Emma-style bubble, staggered 0.4s pulse.
 */

export function TypingDots() {
  return (
    <div className="flex justify-start">
      <div
        className="bg-paper-3 rounded-[18px] rounded-bl-[8px] px-4 py-3 flex items-center gap-1.5"
        aria-label="Emma is typing"
        role="status"
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-ink-3 rounded-full animate-pulse"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        ))}
      </div>
    </div>
  )
}

/* ─── QuickReplyRow ───────────────────────────────────────────────────────
 * Quick-reply chips below Emma's most recent bubble. Match the Chip.tsx
 * pattern: paper bg, line-2 border, ink text off-state; ink fill, paper
 * text, coral dot prefix on-state.
 */

interface QuickReplyRowProps {
  replies: string[]
  onSelect: (reply: string) => void
  disabled?: boolean
}

export function QuickReplyRow({ replies, onSelect, disabled = false }: QuickReplyRowProps) {
  const [flushing, setFlushing] = useState<string | null>(null)

  function handleTap(reply: string) {
    if (disabled) return
    setFlushing(reply)
    setTimeout(() => {
      setFlushing(null)
      onSelect(reply)
    }, 220)
  }

  return (
    <div className="flex flex-wrap gap-2 pt-2" role="group" aria-label="Quick replies">
      {replies.map(reply => {
        const isFlushing = flushing === reply
        return (
          <button
            key={reply}
            type="button"
            disabled={disabled}
            onClick={() => handleTap(reply)}
            className={[
              'inline-flex items-center rounded-full px-3 py-1.5 text-[13px] border transition-colors',
              isFlushing
                ? 'bg-ink text-paper border-ink font-medium before:content-[""] before:w-1.5 before:h-1.5 before:rounded-full before:bg-coral before:mr-2 before:inline-block'
                : 'bg-paper text-ink border-line-2 hover:border-ink/60',
              disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {reply}
          </button>
        )
      })}
    </div>
  )
}

/* ─── FilterActionCard ────────────────────────────────────────────────────
 * Rendered when a propose_chips or set_budget tool_call arrives. Mini-card
 * inside an Emma bubble. Mono kicker header, chip-pattern mini-buttons,
 * link-coral "Apply all".
 */

export interface FilterChipItem {
  group: 'mood' | 'audience' | 'matters'
  value: string
  action: 'add' | 'remove'
}

export interface FilterActionCardProps {
  toolCall: ToolCallPayload
  onApply: (chips: FilterChipItem[], isBudget: boolean, budgetValue?: number) => void
  disabled?: boolean
}

const KICKER_CLASS = 'uppercase text-[10px] tracking-[0.18em] text-ink-3 mb-2'

export function FilterActionCard({ toolCall, onApply, disabled = false }: FilterActionCardProps) {
  const [applied, setApplied] = useState(false)

  /* ── set_budget ─────────────────────────────────────────────────────── */
  if (toolCall.name === 'set_budget') {
    const budgetInput = toolCall.input as { budget?: number }
    const budget = typeof budgetInput.budget === 'number' ? budgetInput.budget : null
    if (budget === null) return null

    function handleBudget() {
      if (applied || disabled) return
      setApplied(true)
      onApply([], true, budget!)
    }

    return (
      <div className="mt-2 p-3 bg-paper-2 border border-line-2 rounded-[14px]">
        <p className={KICKER_CLASS} style={{ fontFamily: 'var(--font-mono)' }}>
          Budget · suggested
        </p>
        {applied ? (
          <p className="text-[13px] text-ink-3" style={{ fontFamily: 'var(--font-body)' }}>
            Budget set.
          </p>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={handleBudget}
            className={[
              'inline-flex items-center rounded-full border bg-paper text-ink border-line-2 px-3 py-1.5 text-[13px]',
              'hover:border-ink/60 transition-colors',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Cap at ${budget}
          </button>
        )}
      </div>
    )
  }

  /* ── propose_chips ──────────────────────────────────────────────────── */
  if (toolCall.name === 'propose_chips') {
    const chipInput = toolCall.input as {
      chips?: Array<{ group: string; value: string; action?: string }>
      reason?: string
    }
    const chips: FilterChipItem[] = (chipInput.chips ?? []).map(c => ({
      group: (c.group as 'mood' | 'audience' | 'matters') || 'mood',
      value: c.value ?? '',
      action: (c.action as 'add' | 'remove') ?? 'add',
    })).filter(c => c.value)

    if (chips.length === 0) return null

    function handleSingle(chip: FilterChipItem) {
      if (applied || disabled) return
      onApply([chip], false)
    }

    function handleApplyAll() {
      if (applied || disabled) return
      setApplied(true)
      onApply(chips, false)
    }

    return (
      <div className="mt-2 p-3 bg-paper-2 border border-line-2 rounded-[14px]">
        <p className={KICKER_CLASS} style={{ fontFamily: 'var(--font-mono)' }}>
          Try · together
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((chip, i) => (
            <button
              key={`${chip.group}-${chip.value}-${i}`}
              type="button"
              disabled={disabled || applied}
              onClick={() => handleSingle(chip)}
              className={[
                'inline-flex items-center rounded-full border bg-paper text-ink border-line-2 px-3 py-1.5 text-[13px]',
                'hover:border-ink/60 transition-colors',
                (disabled || applied) ? 'opacity-40 cursor-not-allowed' : '',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <span
                className="text-ink-3 mr-1.5"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
              >
                {chip.action === 'remove' ? '−' : '+'}
              </span>
              {chip.value}
            </button>
          ))}
        </div>
        {applied ? (
          <p className="text-[13px] text-ink-3" style={{ fontFamily: 'var(--font-body)' }}>
            Applied.
          </p>
        ) : chips.length > 1 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleApplyAll}
            className={[
              'text-[13px] text-ink',
              'border-b border-coral pb-px',
              disabled ? 'opacity-40 cursor-not-allowed' : 'hover:text-coral',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-body)' }}
          >
            Apply all
          </button>
        ) : null}
      </div>
    )
  }

  return null
}
