/**
 * First-time admin setup — creates the initial owner account.
 *
 * Usage:
 *   npx tsx scripts/setup-admin.ts
 *
 * Environment variables (or set in .env):
 *   ADMIN_SEED_EMAIL    — email for the first admin
 *   ADMIN_SEED_PASSWORD — password (8+ chars)
 *   ADMIN_SEED_NAME     — display name
 *
 * If env vars are not set, the script reads from stdin prompts.
 */
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import 'dotenv/config'
import * as readline from 'readline'

const sql = neon(process.env['DATABASE_URL']!)
const db  = drizzle(sql, { schema })

const NEON_AUTH_URL = process.env['NEON_AUTH_BASE_URL']?.replace(/\/$/, '')

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  if (!NEON_AUTH_URL) {
    console.error('ERROR: NEON_AUTH_BASE_URL is not set in your .env')
    process.exit(1)
  }

  // Check if any admin already exists
  const existing = await db.select().from(schema.adminRoles).limit(1)
  if (existing.length > 0) {
    console.log('Admin users already exist:')
    const all = await db.select().from(schema.adminRoles)
    for (const u of all) {
      console.log(`  - ${u.name} <${u.email}> (${u.role})`)
    }
    console.log('\nTo add more users, use the admin panel at /admin/users')
    process.exit(0)
  }

  // Gather credentials
  const email    = process.env['ADMIN_SEED_EMAIL']    || await prompt('Admin email: ')
  const name     = process.env['ADMIN_SEED_NAME']     || await prompt('Admin name: ')
  const password = process.env['ADMIN_SEED_PASSWORD'] || await prompt('Admin password (8+ chars): ')

  if (!email || !name || !password) {
    console.error('ERROR: Email, name, and password are all required.')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('ERROR: Password must be at least 8 characters.')
    process.exit(1)
  }

  // Create user in Neon Auth
  console.log(`\nCreating Neon Auth user for ${email}...`)
  const origin = process.env['SITE_URL'] || 'http://localhost:3000'
  const res = await fetch(`${NEON_AUTH_URL}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password, name }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`ERROR: Neon Auth sign-up failed (${res.status}): ${body}`)
    process.exit(1)
  }

  const data = await res.json() as { user?: { id: string } }
  const neonUserId = data.user?.id
  if (!neonUserId) {
    console.error('ERROR: Neon Auth response missing user ID:', JSON.stringify(data))
    process.exit(1)
  }

  // Insert into admin_roles as owner
  console.log(`Neon Auth user created (ID: ${neonUserId})`)
  console.log('Inserting into admin_roles as owner...')

  await db.insert(schema.adminRoles).values({
    neonAuthUserId: neonUserId,
    email,
    name,
    role: 'owner',
  })

  console.log(`\nDone! ${name} <${email}> is now the admin owner.`)
  console.log('Log in at /admin/login with your email and password.')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
