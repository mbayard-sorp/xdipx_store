/**
 * Reusable skeleton shimmer primitives for loading states.
 */

function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-brand-mist ${className}`}
      aria-hidden="true"
    />
  )
}

/** Skeleton for the product image gallery (square image + thumbnail strip) */
export function GallerySkeleton() {
  return (
    <div className="space-y-3">
      <Shimmer className="aspect-square rounded-2xl" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="w-16 h-16 rounded-xl shrink-0" />
        ))}
      </div>
    </div>
  )
}

/** Skeleton for a product card in a carousel */
export function ProductCardSkeleton() {
  return (
    <div className="w-48 shrink-0 space-y-2">
      <Shimmer className="aspect-square rounded-xl" />
      <Shimmer className="h-4 w-3/4" />
      <Shimmer className="h-3 w-1/2" />
    </div>
  )
}

/** Skeleton for tab content area */
export function TabContentSkeleton() {
  return (
    <div className="space-y-3 py-4" aria-busy="true" aria-label="Loading content">
      <Shimmer className="h-4 w-full" />
      <Shimmer className="h-4 w-5/6" />
      <Shimmer className="h-4 w-4/6" />
      <Shimmer className="h-4 w-full" />
      <Shimmer className="h-4 w-3/4" />
    </div>
  )
}
