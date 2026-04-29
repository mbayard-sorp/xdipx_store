// Side-effect-only env loader. Imported FIRST by scripts so the override
// applies before any other module reads `process.env` at evaluation time
// (e.g. db.server.ts builds a Neon client at module scope).
//
// Why override: a shell that exports `ANTHROPIC_API_KEY=""` (empty) shadows
// the real key from .env unless dotenv is told to override. Default load() does
// NOT override pre-set vars, which silently breaks tsx-invoked scripts run
// inside sandboxed shells.
import { config as dotenvConfig } from 'dotenv'
dotenvConfig({ override: true })
