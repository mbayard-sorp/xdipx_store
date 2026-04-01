import { useFetcher } from 'react-router'
import { useEffect, useState } from 'react'

interface WaitlistButtonProps {
  productHandle: string
  className?: string
}

export function WaitlistButton({ productHandle, className = '' }: WaitlistButtonProps) {
  const fetcher = useFetcher()
  const [joined, setJoined] = useState(false)

  const isPending = fetcher.state !== 'idle'

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { ok?: boolean }).ok) setJoined(true)
  }, [fetcher.data])

  if (joined) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm font-medium text-brand-purple ${className}`}>
        <CheckIcon />
        You're on the waitlist ♥
      </span>
    )
  }

  return (
    <fetcher.Form method="post" action="/api/waitlist">
      <input type="hidden" name="handle" value={productHandle} />
      <input type="hidden" name="intent" value="waitlist" />
      <button
        type="submit"
        disabled={isPending}
        className={[
          'text-sm font-semibold px-4 py-2 rounded-full border-2 border-brand-purple text-brand-purple',
          'transition-all hover:bg-brand-purple hover:text-white disabled:opacity-60',
          className,
        ].join(' ')}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {isPending ? 'Joining...' : 'Notify me when it returns ♥'}
      </button>
    </fetcher.Form>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
