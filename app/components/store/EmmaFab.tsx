import { useEffect, useState } from 'react'
import { EmmaChatSheet } from '~/components/store/EmmaChatSheet'

interface EmmaFabProps {
  /** Extra bottom offset (e.g. to sit above the mobile tab bar). Default 72px. */
  bottomOffset?: number
}

export function EmmaFab({ bottomOffset = 72 }: EmmaFabProps) {
  const [open, setOpen] = useState(false)
  const [textNumber, setTextNumber] = useState<string | null>(null)

  useEffect(() => {
    const num = (window as unknown as { ENV?: { EMMA_TEXT_NUMBER?: string } }).ENV?.EMMA_TEXT_NUMBER
    if (num) setTextNumber(num)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask Emma"
        className="md:hidden fixed right-4 z-[56] w-14 h-14 rounded-full bg-coral text-white shadow-lg shadow-coral/30 active:scale-95 transition-transform flex flex-col items-center justify-center font-bold"
        style={{
          fontFamily: 'var(--font-display)',
          bottom:     `calc(${bottomOffset}px + env(safe-area-inset-bottom))`,
        }}
      >
        <span className="text-lg leading-none">E</span>
        <span className="text-[8px] tracking-wider opacity-90 mt-0.5">ASK</span>
      </button>
      <EmmaChatSheet open={open} onClose={() => setOpen(false)} textNumber={textNumber} />
    </>
  )
}
