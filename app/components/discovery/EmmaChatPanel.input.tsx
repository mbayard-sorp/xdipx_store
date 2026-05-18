/**
 * EmmaChatPanel input row.
 *
 * Pill text input + coral send button (♥ glyph).
 * Enter key submits. Send disabled when input is empty or streaming.
 *
 * No server imports. No .server.ts imports. Safe in client/SSR bundles.
 */

import { useRef } from 'react'

interface EmmaChatInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: (message: string) => void
  disabled?: boolean
}

export function EmmaChatInput({ value, onChange, onSubmit, disabled = false }: EmmaChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const canSubmit = !disabled && value.trim().length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const trimmed = value.trim()
    onChange('')
    onSubmit(trimmed)
    // Return focus to input after submit
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) {
        const trimmed = value.trim()
        onChange('')
        onSubmit(trimmed)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-0 bg-paper border-t border-line px-4 py-3 flex items-center gap-3"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tell Emma what you're after…"
        disabled={disabled}
        autoComplete="off"
        className={[
          'flex-1 bg-cream-2 rounded-full px-4 py-2.5 text-[14px] text-ink',
          'placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-coral/30',
          'border border-transparent focus:border-coral/30 transition-all',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      />
      <button
        type="submit"
        disabled={!canSubmit}
        aria-label="Send message"
        className={[
          'flex-none w-9 h-9 rounded-full flex items-center justify-center',
          'text-[14px] font-semibold transition-colors',
          canSubmit
            ? 'bg-coral text-paper hover:bg-coral-2 active:bg-coral-deep'
            : 'bg-coral/30 text-paper/60 cursor-not-allowed',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        ♥
      </button>
    </form>
  )
}
