# xdipx IVR (Fly.io)

Conversational IVR bridge. Accepts Twilio ConversationRelay WebSocket
connections, runs the Claude turn loop, and streams text back to Twilio for
ElevenLabs TTS.

Lives outside the React Router app because it needs a sustained WebSocket for
the duration of each call — Vercel serverless is not a good fit for that.

## Phase A (current)

Minimal WebSocket server that:

- Accepts `wss://.../relay` connections from Twilio
- Logs every `setup` / `prompt` / `interrupt` / `dtmf` frame
- Replies to the first utterance with a hardcoded line so TTS can be verified

Phase B replaces the hardcoded reply with a streaming Claude loop.

## Develop locally

```bash
cd ivr
cp .env.example .env
npm install
npm run dev
```

Then expose via ngrok and point Twilio at it:

```bash
ngrok http 8080
# Set IVR_WS_URL=wss://<ngrok-host>/relay in the parent app's .env
```

## Deploy to Fly

First time:

```bash
fly launch --no-deploy      # creates the app; keep fly.toml values
fly secrets set ANTHROPIC_API_KEY=... TWILIO_AUTH_TOKEN=... \
               SHOPIFY_ADMIN_ACCESS_TOKEN=... DATABASE_URL=... \
               INTERNAL_API_SECRET=... SENTRY_DSN=...
fly deploy
```

Subsequent deploys: `fly deploy`.

Health check: `curl https://xdipx-ivr.fly.dev/health` → `ok`.
