import type { ActionFunctionArgs, MetaFunction, LoaderFunctionArgs } from 'react-router'
import { useActionData, redirect, Form } from 'react-router'
import { loginAdmin, logoutAdmin, getSession } from '~/lib/session.server'
import { checkRateLimit, rateLimited, getClientIp } from '~/lib/rate-limit.server'
import { kvIncr, kvSet } from '~/lib/kv.server'

export const meta: MetaFunction = () => [{ title: 'Admin Login — xdipx' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get('Cookie'))
  if (session.get('admin_user_id')) return redirect('/admin')
  return null
}

export async function action({ request }: ActionFunctionArgs) {
  // IP-level throttle — blunt but effective against distributed credential stuffing from one source
  const rl = await checkRateLimit(request, 'admin-login', 20, 900)
  if (!rl.ok) return rateLimited()

  const form   = await request.formData()
  const intent = form.get('intent')

  if (intent === 'logout') {
    const headers = await logoutAdmin(request)
    return redirect('/admin/login', { headers })
  }

  const email    = (form.get('email') as string ?? '').trim().toLowerCase()
  const password = form.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  // Per-(email+ip) failed-attempt lockout: 5 fails / 15min
  const ip = getClientIp(request)
  const failKey = `admin-login:fails:${email}:${ip}`
  const fails = await kvIncr(failKey)
  if (fails === 1) await kvSet(failKey, fails, 900)
  if (fails > 5) {
    return { error: 'Too many failed attempts. Try again in 15 minutes.' }
  }

  const headers = await loginAdmin(request, email, password)
  if (!headers) return { error: 'Invalid email or password.' }

  // Success — clear fail counter
  await kvSet(failKey, 0, 60)

  return redirect('/admin', { headers })
}

export default function AdminLogin() {
  const data = useActionData<{ error?: string }>()

  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl">
        <div className="text-center mb-8">
          <span
            className="text-3xl font-black text-coral"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            xdipx
          </span>
          <p className="text-ink/50 text-sm mt-1">admin</p>
        </div>

        <Form method="post" className="space-y-4">
          <input
            type="email"
            name="email"
            placeholder="Email"
            autoFocus
            required
            autoComplete="email"
            className="w-full px-4 py-3 rounded-xl border border-cream-2 bg-cream text-ink placeholder-ink/40 focus:outline-none focus:ring-2 focus:ring-coral/30"
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            required
            autoComplete="current-password"
            className="w-full px-4 py-3 rounded-xl border border-cream-2 bg-cream text-ink placeholder-ink/40 focus:outline-none focus:ring-2 focus:ring-coral/30"
          />

          {data?.error && (
            <p className="text-red-500 text-sm text-center">{data.error}</p>
          )}

          <button
            type="submit"
            className="w-full bg-coral text-white font-bold py-3 rounded-xl hover:opacity-90 transition-opacity"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Sign in ♥
          </button>
        </Form>
      </div>
    </div>
  )
}
