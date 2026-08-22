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
      className="flex-none bg-paper border-t border-line px-5 py-4 flex items-center gap-2"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Tell Emma what you're after"
        disabled={disabled}
        autoComplete="off"
        className={[
          'flex-1 bg-paper-3 rounded-full px-4 py-2.5 text-[14px] text-ink',
          'placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-ink/20',
          'border border-transparent transition-all',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      />
      <button
        type="submit"
        disabled={!canSubmit}
        aria-label="Send message"
        className={[
          'flex-none h-9 px-4 rounded-full inline-flex items-center justify-center text-[13px]',
          'transition-colors',
          canSubmit
            ? 'bg-ink text-paper hover:bg-plum-2'
            : 'bg-paper-3 text-ink-4 cursor-not-allowed border border-line-2',
        ].join(' ')}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        Send
      </button>
    </form>
  )
}
