import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from 'react-router'
import { useLoaderData, useFetcher } from 'react-router'
import { eq, count } from 'drizzle-orm'
import { db } from '~/lib/db.server'
import { adminRoles } from '../../db/schema'
import { requireOwner } from '~/lib/session.server'
import { neonAuthSignUp } from '~/lib/neon-auth.server'

export const meta: MetaFunction = () => [{ title: 'Users — xdipx Admin' }]

export async function loader({ request }: LoaderFunctionArgs) {
  const currentUser = await requireOwner(request)
  const users = await db.select().from(adminRoles).orderBy(adminRoles.createdAt)
  return { users, currentUserId: currentUser.id }
}

export async function action({ request }: ActionFunctionArgs) {
  const currentUser = await requireOwner(request)
  const form   = await request.formData()
  const intent = form.get('intent') as string

  if (intent === 'invite') {
    const email    = (form.get('email') as string ?? '').trim().toLowerCase()
    const name     = (form.get('name') as string ?? '').trim()
    const password = form.get('password') as string
    const role     = (form.get('role') as string) === 'owner' ? 'owner' : 'admin'

    if (!email || !name || !password) {
      return { ok: false, error: 'All fields are required.' }
    }
    if (password.length < 8) {
      return { ok: false, error: 'Password must be at least 8 characters.' }
    }

    // Create user in Neon Auth
    const neonUser = await neonAuthSignUp(email, password, name)
    if (!neonUser) {
      return { ok: false, error: 'Failed to create user. Email may already exist in Neon Auth.' }
    }

    // Insert into admin_roles
    await db.insert(adminRoles).values({
      neonAuthUserId: neonUser.id,
      email,
      name,
      role,
    })

    return { ok: true, message: `${name} has been added as ${role}.` }
  }

  if (intent === 'update-role') {
    const userId  = parseInt(form.get('userId') as string)
    const newRole = (form.get('role') as string) === 'owner' ? 'owner' : 'admin'

    if (userId === currentUser.id) {
      return { ok: false, error: "You can't change your own role." }
    }

    // Prevent removing the last owner
    if (newRole === 'admin') {
      const ownerRows = await db
        .select({ value: count() })
        .from(adminRoles)
        .where(eq(adminRoles.role, 'owner'))
      const ownerCount = ownerRows[0]?.value ?? 0

      const [target] = await db.select().from(adminRoles).where(eq(adminRoles.id, userId)).limit(1)
      if (target?.role === 'owner' && ownerCount <= 1) {
        return { ok: false, error: 'Cannot remove the last owner.' }
      }
    }

    await db.update(adminRoles).set({ role: newRole }).where(eq(adminRoles.id, userId))
    return { ok: true, message: 'Role updated.' }
  }

  if (intent === 'remove') {
    const userId = parseInt(form.get('userId') as string)

    if (userId === currentUser.id) {
      return { ok: false, error: "You can't remove yourself." }
    }

    // Prevent removing the last owner
    const [target] = await db.select().from(adminRoles).where(eq(adminRoles.id, userId)).limit(1)
    if (target?.role === 'owner') {
      const ownerRows = await db
        .select({ value: count() })
        .from(adminRoles)
        .where(eq(adminRoles.role, 'owner'))
      const ownerCount = ownerRows[0]?.value ?? 0
      if (ownerCount <= 1) {
        return { ok: false, error: 'Cannot remove the last owner.' }
      }
    }

    await db.delete(adminRoles).where(eq(adminRoles.id, userId))
    return { ok: true, message: 'User removed.' }
  }

  return { ok: false, error: 'Unknown action.' }
}

export default function AdminUsers() {
  const { users, currentUserId } = useLoaderData<typeof loader>()
  const fetcher = useFetcher<{ ok?: boolean; error?: string; message?: string }>()
  const busy = fetcher.state !== 'idle'

  return (
    <div className="max-w-4xl space-y-8">
      <h1
        className="text-2xl font-bold text-brand-charcoal"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Admin Users
      </h1>

      {/* ─── Invite Form ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2
          className="text-lg font-semibold text-brand-charcoal mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Add Admin User
        </h2>
        <fetcher.Form method="post" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <input type="hidden" name="intent" value="invite" />
          <input
            name="name"
            placeholder="Full name"
            required
            className="px-4 py-2.5 rounded-xl border border-brand-mist bg-brand-cream text-brand-charcoal placeholder-brand-charcoal/40 focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="px-4 py-2.5 rounded-xl border border-brand-mist bg-brand-cream text-brand-charcoal placeholder-brand-charcoal/40 focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          />
          <input
            name="password"
            type="password"
            placeholder="Temporary password (8+ chars)"
            required
            minLength={8}
            className="px-4 py-2.5 rounded-xl border border-brand-mist bg-brand-cream text-brand-charcoal placeholder-brand-charcoal/40 focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          />
          <select
            name="role"
            className="px-4 py-2.5 rounded-xl border border-brand-mist bg-brand-cream text-brand-charcoal focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
          >
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="bg-brand-gradient text-white font-bold px-6 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {busy ? 'Adding...' : 'Add User'}
            </button>
          </div>
        </fetcher.Form>

        {fetcher.data?.error && (
          <p className="mt-3 text-red-500 text-sm">{fetcher.data.error}</p>
        )}
        {fetcher.data?.message && (
          <p className="mt-3 text-green-600 text-sm">{fetcher.data.message}</p>
        )}
      </div>

      {/* ─── User List ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <h2
          className="text-lg font-semibold text-brand-charcoal mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Current Users ({users.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-brand-charcoal/50 border-b border-brand-mist">
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Email</th>
                <th className="pb-3 font-medium">Role</th>
                <th className="pb-3 font-medium">Last Login</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-mist/50">
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  isCurrentUser={user.id === currentUserId}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function UserRow({
  user,
  isCurrentUser,
}: {
  user: typeof adminRoles.$inferSelect
  isCurrentUser: boolean
}) {
  const roleFetcher   = useFetcher()
  const removeFetcher = useFetcher()

  return (
    <tr className="text-brand-charcoal">
      <td className="py-3 pr-4">
        <span className="font-medium">{user.name}</span>
        {isCurrentUser && (
          <span className="ml-2 text-xs text-brand-purple bg-brand-mist px-2 py-0.5 rounded-full">
            you
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-brand-charcoal/70">{user.email}</td>
      <td className="py-3 pr-4">
        {isCurrentUser ? (
          <span className="capitalize">{user.role}</span>
        ) : (
          <roleFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="update-role" />
            <input type="hidden" name="userId" value={user.id} />
            <select
              name="role"
              defaultValue={user.role}
              onChange={(e) => e.target.form?.requestSubmit()}
              className="bg-transparent border border-brand-mist rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-coral/30"
            >
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </roleFetcher.Form>
        )}
      </td>
      <td className="py-3 pr-4 text-brand-charcoal/50 text-xs">
        {user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : 'Never'}
      </td>
      <td className="py-3">
        {!isCurrentUser && (
          <removeFetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="userId" value={user.id} />
            <button
              type="submit"
              onClick={(e) => {
                if (!confirm(`Remove ${user.name}?`)) e.preventDefault()
              }}
              className="text-red-400 hover:text-red-600 text-xs font-medium transition-colors"
            >
              Remove
            </button>
          </removeFetcher.Form>
        )}
      </td>
    </tr>
  )
}
