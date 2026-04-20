import type { MetaFunction } from 'react-router'

export const meta: MetaFunction = () => [{ title: 'Email Previews — xdipx Admin' }]

export default function AdminEmails() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-4" style={{ fontFamily: 'var(--font-display)' }}>
        Email Flows
      </h1>
      <p className="text-ink/60 mb-8">
        Klaviyo manages all email flows. Log in to Klaviyo to preview and edit.
      </p>
      <div className="grid gap-4">
        {[
          { name: 'Welcome Series',       desc: '3 emails: Welcome → How it works → Discretion & trust', status: 'Active' },
          { name: "Emma's Pick",          desc: 'Triggered when Emma\'s featured pick rotates',         status: 'Active' },
          { name: 'Back In Stock',        desc: 'Triggered when waitlist product becomes available',    status: 'Active' },
          { name: 'Abandoned Checkout',   desc: '"You got so close. Your cart is waiting. ♥"',         status: 'Active' },
          { name: 'Post-Purchase',        desc: 'Order confirm + discreet descriptor notice + preview', status: 'Active' },
        ].map(flow => (
          <div key={flow.name} className="bg-white rounded-xl p-5 shadow-sm flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink">{flow.name}</p>
              <p className="text-sm text-ink/60 mt-0.5">{flow.desc}</p>
            </div>
            <span className="text-xs font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full">
              {flow.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
