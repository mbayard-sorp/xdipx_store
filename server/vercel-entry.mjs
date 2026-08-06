/*
 * Placeholder for the real Vercel serverless entry. Do not commit a built
 * bundle here.
 *
 * vercel.json uses the legacy builds[] array, and Vercel matches builds[].src
 * against the files in the repo before any build step runs, so this file must
 * exist in git. Its committed content never ships: during a Vercel deploy,
 * npm install runs the postinstall script with VERCEL=1, which runs
 * scripts/build-vercel.mjs and overwrites this file with the real esbuild
 * bundle of server/index.ts before the function is packaged.
 *
 * Tracking the real 1.3MB bundle made every server PR either conflict on it
 * (and GitHub runs zero pull_request workflows on a conflicted PR, a silent
 * CI blackout) or fail CI's artifact-sync assert: 59 rewrites in 21 days.
 * Local and CI builds now write the bundle to build/vercel-entry-local.mjs
 * (gitignored) and never touch this file. See scripts/build-vercel.mjs.
 */
throw new Error(
  'server/vercel-entry.mjs is a committed placeholder, not the real server bundle. ' +
    'The real bundle is generated at deploy time by postinstall (VERCEL=1) running ' +
    'scripts/build-vercel.mjs. Seeing this error in production means the deploy-time ' +
    'rebuild did not run; check the postinstall script in package.json and the Vercel build logs.'
)
