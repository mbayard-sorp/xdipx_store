/**
 * Full-screen sheet that shows a banner at native size (wires 5.2). The banner
 * sits inside this sheet's own overflow-x-auto row, so the page body never
 * scrolls sideways and no card contains a scrolling box.
 */
import { CloseIcon } from '~/components/admin/social/icons'

export function BannerViewer({
  src,
  width,
  height,
  label,
  onClose,
}: {
  src: string
  width: number
  height: number
  label: string
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} at native size`}
      className="fixed inset-0 z-40 bg-paper flex flex-col"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="font-mono text-xs text-ink-3">{label.includes('x') ? label : `${label} · ${width}x${height}`} native</p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-paper px-4 text-sm font-medium text-ink hover:border-ink-4 touch-manipulation"
        >
          <CloseIcon size={12} /> Close
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-paper-3 p-4">
        <div className="overflow-x-auto">
          <img src={src} width={width} height={height} alt={`${label} banner at native size`} className="block max-w-none bg-paper" style={{ width, height }} />
        </div>
      </div>
    </div>
  )
}
