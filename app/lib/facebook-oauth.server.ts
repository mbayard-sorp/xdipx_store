/**
 * Facebook OAuth 2.0 helpers.
 *
 * Required env vars:
 *   FACEBOOK_APP_ID      — Meta Developer Portal → App → Settings → Basic → App ID
 *   FACEBOOK_APP_SECRET  — same page → App Secret
 *
 * Setup:
 *   1. developers.facebook.com → Your App → Facebook Login → Settings
 *   2. Valid OAuth Redirect URIs: https://yourdomain.com/api/facebook-callback
 *      (and http://localhost:3000/api/facebook-callback for dev)
 *   3. Permissions needed: email, public_profile
 *
 * Note: Facebook does not support PKCE — state is used for CSRF protection only.
 */

const APP_ID     = process.env['FACEBOOK_APP_ID']     ?? ''
const APP_SECRET = process.env['FACEBOOK_APP_SECRET'] ?? ''

// Facebook OAuth is temporarily disabled — set back to !!(APP_ID && APP_SECRET) to re-enable
export const FACEBOOK_OAUTH_ENABLED = false

// ── Auth URL ──────────────────────────────────────────────────────────────────

export function getFacebookLoginUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id:     APP_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'email,public_profile',
    state,
  })
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`
}

// ── Token exchange + profile ──────────────────────────────────────────────────

export async function exchangeFacebookCode(
  code: string,
  redirectUri: string,
): Promise<{ email: string; firstName: string; lastName: string; id: string }> {
  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id:     APP_ID,
      client_secret: APP_SECRET,
      redirect_uri:  redirectUri,
      code,
    })}`,
  )
  if (!tokenRes.ok) throw new Error(`Facebook token exchange failed: ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json() as { access_token: string }

  const profileRes = await fetch(
    `https://graph.facebook.com/me?fields=id,email,first_name,last_name&access_token=${access_token}`,
  )
  if (!profileRes.ok) throw new Error(`Facebook profile fetch failed: ${await profileRes.text()}`)
  const profile = await profileRes.json() as {
    id: string; email?: string; first_name?: string; last_name?: string
  }
  if (!profile.email) throw new Error('Facebook did not return an email address — user may not have email permission')

  return {
    id:        profile.id,
    email:     profile.email,
    firstName: profile.first_name ?? '',
    lastName:  profile.last_name  ?? '',
  }
}
