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
        className="text-2xl font-bold text-brand-charcoal mb-4"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Bundle &amp; Save ♥
      </h2>
      <div className="rounded-2xl border-2 border-brand-purple/20 bg-brand-mist/40 p-5 md:p-6">
        <BundleHero bundle={bundle} compact {...(buyButtonText ? { buyButtonText } : {})} />
      </div>
    </section>
  )
}

export default BundleSaveCard
