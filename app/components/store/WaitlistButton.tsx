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
            <input
              id="waitlist-email"
              ref={inputRef}
              type="email"
              placeholder="your@email.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'waitlist-error' : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNotifyClick() } }}
              className="flex-1 min-w-0 px-3 py-2 text-sm rounded-full border border-cream-2 bg-white text-ink placeholder:text-ink/50 focus:outline-none focus:border-sage transition-colors"
            />
          </>
        )}
        <button
          type="button"
          onClick={handleNotifyClick}
          disabled={isPending}
          className={[
            'text-sm font-semibold px-4 py-2 rounded-full transition-all disabled:opacity-60',
            showInput
              ? 'shrink-0 bg-sage text-white hover:bg-sun'
              : 'border-2 border-sage text-sage hover:bg-sage hover:text-white',
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
