export function EmmaContextualAsideSkeleton() {
  return (
    <div
      className="flex items-start gap-3 bg-cream-2/40 border border-line px-4 py-3 rounded-[8px]"
      aria-hidden="true"
    >
      <span className="shrink-0 w-8 h-8 rounded-full bg-coral/10" />
      <div className="flex-1 pt-1 space-y-1.5">
        <div className="h-3 bg-ink/10 rounded-[4px] w-11/12 animate-pulse" />
        <div className="h-3 bg-ink/10 rounded-[4px] w-3/4 animate-pulse" />
      </div>
    </div>
  )
}
