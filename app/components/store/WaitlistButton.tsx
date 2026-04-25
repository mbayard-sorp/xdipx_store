import { useFetcher } from 'react-router'
import { useEffect, useRef, useState } from 'react'

interface WaitlistButtonProps {
  productHandle: string
  className?: string
}

export function WaitlistButton({ productHandle, className = '' }: WaitlistButtonProps) {
  const fetcher = useFetcher()
  const [showInput, setShowInput] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    const data = fetcher.data as { ok?: boolean; error?: string } | undefined
    if (!data) return
    if (data.ok) setJoined(true)
    if (data.error) setError(data.error)
  }, [fetcher.data])

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  function handleNotifyClick() {
    if (!showInput) {
      setShowInput(true)
      return
    }

    const email = inputRef.current?.value?.trim()
    if (!email) {
      setError('Please enter your email')
      return
    }

    setError('')
    const formData = new FormData()
    formData.set('intent', 'waitlist')
    formData.set('handle', productHandle)
    formData.set('email', email)
    fetcher.submit(formData, { method: 'post', action: '/api/waitlist' })
  }

  if (joined) {
    return (
      <div className={`rounded-xl border border-sage/20 bg-cream-2 px-4 py-3 ${className}`}>
        <p className="flex items-center gap-2 text-sm font-semibold text-sage" style={{ fontFamily: 'var(--font-display)' }}>
          <CheckIcon />
          You're on the list!
        </p>
        <p className="text-xs text-ink/60 mt-1">
          We'll email you as soon as this product is back in stock.
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-2">
        {showInput && (
          <>
            <label htmlFor="waitlist-email" className="sr-only">Email address</label>
            <div className="relative flex-1 min-w-0 self-center">
              <input
                id="waitlist-email"
                ref={inputRef}
                type="email"
                placeholder="your@email.com"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'waitlist-error' : undefined}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNotifyClick() } }}
                className="block w-full h-11 pl-4 pr-10 text-sm rounded-full border border-cream-2 bg-white text-ink placeholder:text-ink/50 focus:outline-none focus:border-sage transition-colors"
              />
              <button
                type="button"
                onClick={() => {
                  setShowInput(false)
                  setError('')
                  if (inputRef.current) inputRef.current.value = ''
                }}
                aria-label="Close notify-me form"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-ink/50 hover:text-ink hover:bg-cream-2 flex items-center justify-center transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={handleNotifyClick}
          disabled={isPending}
          className={[
            'py-4 rounded-full font-bold text-lg transition-all disabled:opacity-60 shadow-md shadow-muted/20',
            showInput
              ? 'shrink-0 px-6 bg-muted text-white hover:opacity-90'
              : 'flex-1 bg-muted text-white hover:opacity-90 hover:scale-[1.01]',
          ].join(' ')}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {isPending ? 'Joining...' : showInput ? 'Notify Me' : 'Notify me when it returns ♥'}
        </button>
      </div>

      {error && (
        <p id="waitlist-error" role="alert" className="text-xs text-red-500 pl-3">{error}</p>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
