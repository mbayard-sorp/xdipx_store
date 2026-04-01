import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { useActionData, redirect, Form } from 'react-router'
import { loginAdmin, logoutAdmin, getSession } from '~/lib/session.server'

export const meta: MetaFunction = () => [{ title: 'Admin Login — xdipx' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get('Cookie'))
  if (session.get('admin_authed')) return redirect('/admin')
  return null
}

export async function action({ request }: ActionFunctionArgs) {
  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'logout') {
    const headers = await logoutAdmin(request)
    return redirect('/admin/login', { headers })
  }

  const password = form.get('password') as string
  const headers  = await loginAdmin(request, password)
  if (!headers) return { error: 'Wrong password. Try again.' }

  return redirect('/admin', { headers })
}

export default function AdminLogin() {
  const data = useActionData<{ error?: string }>()

  return (
    <div className="min-h-screen bg-brand-charcoal flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <div className="text-center mb-8">
          <span
            className="text-3xl font-black text-brand-gradient"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            xdipx
          </span>
          <p className="text-brand-charcoal/50 text-sm mt-1">admin</p>
        </div>

        <Form method="post" className="space-y-4">
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            required
            className="w-full px-4 py-3 rounded-xl border border-brand-mist bg-brand-cream text-brand-charcoal placeholder-brand-charcoal/40 focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          />

          {data?.error && (
            <p className="text-red-500 text-sm text-center">{data.error}</p>
          )}

          <button
            type="submit"
            className="w-full bg-brand-gradient text-white font-bold py-3 rounded-xl hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sign in ♥
          </button>
        </Form>
      </div>
    </div>
  )
}
