/**
 * Google OAuth 2.0 PKCE helpers.
 *
 * Required env vars:
 *   GOOGLE_OAUTH_CLIENT_ID      — GCP Console → APIs & Services → Credentials → OAuth 2.0 Client ID
 *   GOOGLE_OAUTH_CLIENT_SECRET  — same credential above
 *
 * Setup:
 *   1. GCP Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web app)
 *   2. Authorized redirect URI: https://yourdomain.com/api/google-callback
 *      (and http://localhost:3000/api/google-callback for dev)
 */

import crypto from 'node:crypto'

const CLIENT_ID     = process.env['GOOGLE_OAUTH_CLIENT_ID']     ?? ''
const CLIENT_SECRET = process.env['GOOGLE_OAUTH_CLIENT_SECRET'] ?? ''

export const GOOGLE_OAUTH_ENABLED = !!(CLIENT_ID && CLIENT_SECRET)

// ── PKCE helpers (re-exported for use in action handlers) ─────────────────────

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return Buffer.from(hash).toString('base64url')
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

export async function getGoogleLoginUrl(
  redirectUri: string,
  state: string,
  codeVerifier: string,
): Promise<string> {
  const challenge = await generateCodeChallenge(codeVerifier)
  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri,
    response_type:         'code',
    scope:                 'openid email profile',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
    access_type:           'online',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// ── Token exchange + profile ──────────────────────────────────────────────────

export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ email: string; firstName: string; lastName: string; sub: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  })
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json() as { access_token: string }

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!profileRes.ok) throw new Error(`Google profile fetch failed: ${await profileRes.text()}`)
  const profile = await profileRes.json() as {
    sub: string; email?: string; given_name?: string; family_name?: string
  }
  if (!profile.email) throw new Error('Google did not return an email address')

  return {
    sub:       profile.sub,
    email:     profile.email,
    firstName: profile.given_name  ?? '',
    lastName:  profile.family_name ?? '',
  }
}
