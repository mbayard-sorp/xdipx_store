import type { MetaFunction } from 'react-router'

export const meta: MetaFunction = () => [{ title: 'AI Generator — xdipx Admin' }]

export default function AdminGenerate() {

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-brand-charcoal mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        AI Generator
      </h1>
      <p className="text-brand-charcoal/40 text-sm">
        This tool is no longer needed. Use the Generate All Fields button on the{' '}
        <a href="/admin/today" className="text-brand-purple underline hover:opacity-80">Today's Deal</a> page instead.
      </p>
    </div>
  )
}
