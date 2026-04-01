interface BothWaysSectionProps {
  forHim: string
  forHer: string
}

export function BothWaysSection({ forHim, forHer }: BothWaysSectionProps) {
  return (
    <section className="py-12 px-4 bg-brand-mist">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <span className="text-brand-purple text-2xl" aria-hidden="true">♥</span>
          <h2
            className="text-2xl font-bold text-brand-charcoal mt-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Both Ways
          </h2>
          <p className="text-brand-charcoal/60 text-sm mt-1">
            Because xdipx works from every angle.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3
              className="text-brand-charcoal font-bold mb-3 flex items-center gap-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <span className="text-brand-purple">♥</span> For Him
            </h3>
            <p className="text-brand-charcoal/80 leading-relaxed text-sm">{forHim}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h3
              className="text-brand-charcoal font-bold mb-3 flex items-center gap-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <span className="text-brand-purple">♥</span> For Her
            </h3>
            <p className="text-brand-charcoal/80 leading-relaxed text-sm">{forHer}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
