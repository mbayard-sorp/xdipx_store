/**
 * EmmaChatPanel sub-components: Bubble, TypingDots, QuickReplyRow, FilterActionCard.
 *
 * These are purely presentational. All state lives in EmmaChatPanel.tsx.
 * No server imports. No .server.ts imports. Safe in client/SSR bundles.
 */

import { useEffect, useRef, useState } from 'react'
import type { ToolCallPayload } from './EmmaChatPanel'

/* ─── Motion helpers ────────────────────────────────────────────────────── */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ─── Bubble ──────────────────────────────────────────────────────────────
 * Animate on mount: translateY(8px)→0 + opacity 0→1 over 180ms.
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
    // Defer one frame so the initial (not-entered) styles are applied first.
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
            'bg-coral text-paper rounded-[20px] rounded-br-[6px] px-4 py-2.5 max-w-[85%]',
            'text-[15px] leading-[22px] font-semibold',
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
          'bg-cream-2 text-ink rounded-[20px] rounded-bl-[6px] px-4 py-2.5 max-w-[85%]',
          'text-[15px] leading-[22px]',
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
        className="bg-cream-2 text-ink rounded-[20px] rounded-bl-[6px] px-4 py-3 flex items-center gap-1.5"
        aria-label="Emma is typing"
        role="status"
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-ink/40 rounded-full animate-pulse"
            style={{ animationDelay: `${i * 0.4}s` }}
          />
        ))}
      </div>
    </div>
  )
}

/* ─── QuickReplyRow ───────────────────────────────────────────────────────
 * Chips rendered below the most recent Emma bubble.
 * Tap submits the chip label as a user message.
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
    // 250ms coral-pulse flash before submitting
    setFlushing(reply)
    setTimeout(() => {
      setFlushing(null)
      onSelect(reply)
    }, 250)
  }

  return (
    <div className="flex flex-wrap gap-2 pl-0 pt-2" role="group" aria-label="Quick replies">
      {replies.map(reply => (
        <button
          key={reply}
          type="button"
          disabled={disabled}
          onClick={() => handleTap(reply)}
          className={[
            'bg-paper border border-line text-ink rounded-full px-3 py-1.5 text-[13px] font-semibold',
            'transition-colors duration-150',
            flushing === reply
              ? 'bg-coral text-paper border-coral'
              : 'hover:bg-cream-2',
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {reply}
        </button>
      ))}
    </div>
  )
}

/* ─── FilterActionCard ────────────────────────────────────────────────────
 * Rendered inside an Emma bubble when a propose_chips or set_budget
 * tool_call event arrives. Lets the user apply individual chips or all at once.
 *
 * Props:
 *   toolCall  - the tool call payload from the SSE stream
 *   onApply   - called with the list of applied labels after any apply action
 *   disabled  - suppress interaction while streaming
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

export function FilterActionCard({ toolCall, onApply, disabled = false }: FilterActionCardProps) {
  const [applied, setApplied] = useState(false)

  // ── set_budget ─────────────────────────────────────────────────────────
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
      <div className="mt-2 p-3 bg-paper border border-line rounded-xl">
        <p
          className="text-[12px] italic text-sage mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Budget suggestion
        </p>
        {applied ? (
          <p className="text-[13px] text-sage" style={{ fontFamily: 'var(--font-body)' }}>
            Budget set. ♥
          </p>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={handleBudget}
            className={[
              'bg-paper border border-line text-ink rounded-full px-3 py-1.5 text-[13px] font-semibold',
              'hover:bg-cream-2 transition-colors',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Set budget to ${budget}
          </button>
        )}
      </div>
    )
  }

  // ── propose_chips ──────────────────────────────────────────────────────
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
      <div className="mt-2 p-3 bg-paper border border-line rounded-xl">
        <p
          className="text-[12px] italic text-sage mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Try these together
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {chips.map((chip, i) => (
            <button
              key={`${chip.group}-${chip.value}-${i}`}
              type="button"
              disabled={disabled || applied}
              onClick={() => handleSingle(chip)}
              className={[
                'bg-paper border border-line text-ink rounded-full px-3 py-1.5 text-[13px] font-semibold',
                'hover:bg-cream-2 transition-colors',
                (disabled || applied) ? 'opacity-40 cursor-not-allowed' : '',
              ].join(' ')}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {chip.action === 'remove' ? '[−]' : '[+]'} {chip.value}
            </button>
          ))}
        </div>
        {applied ? (
          <p className="text-[13px] text-sage" style={{ fontFamily: 'var(--font-body)' }}>
            Applied. ♥
          </p>
        ) : chips.length > 1 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={handleApplyAll}
            className={[
              'text-coral text-[13px] font-semibold hover:underline',
              disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Apply all
          </button>
        ) : null}
      </div>
    )
  }

  return null
}
