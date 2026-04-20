import type { Bundle } from '~/types'
import { BundleHero } from './BundleHero'

interface BundleSaveCardProps {
  bundle: Bundle
  buyButtonText?: string
}

export function BundleSaveCard({ bundle, buyButtonText }: BundleSaveCardProps) {
  return (
    <section className="mt-12 mb-6">
      <h2
        className="text-2xl font-bold text-ink mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Bundle &amp; Save ♥
      </h2>
      <div className="rounded-2xl border-2 border-sage/20 bg-cream-2/40 p-5 md:p-6">
        <BundleHero bundle={bundle} compact {...(buyButtonText ? { buyButtonText } : {})} />
      </div>
    </section>
  )
}

export default BundleSaveCard
