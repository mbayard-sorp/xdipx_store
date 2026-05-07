# ADR-001: Streaming-to-Browser Pattern for Emma Chat

**Date:** 2026-05-07
**Status:** Accepted
**Author:** tech-architect (Phase 6 review)
**Feature:** `/admin/emma-chat` — internal Emma product-SME chat

---

## Context

Emma Chat is the first feature in this codebase that streams LLM output
incrementally to the browser. The repo uses React Router v7 framework mode
(SSR, Express adapter) with Anthropic SDK v0.39.0 as the only LLM client.
No streaming-to-browser pattern existed before this feature.

Three options were evaluated:

1. **Manual SSE via `ReadableStream` in a loader route** (chosen)
2. **WebSocket via a standalone WS server**
3. **Vercel AI SDK (`ai` package) with its built-in `useChat` hook**

---

## Decision

Use **manual Server-Sent Events (SSE)** delivered from a dedicated React Router
loader route (`api.admin.emma-chat.stream.$threadId.tsx`). The loader returns a
`new Response(ReadableStream<Uint8Array>, { headers: { 'content-type':
'text/event-stream' } })`. The client opens an `EventSource` to that URL after
a user-message action resolves.

---

## Why SSE over WebSocket

- **HTTP-native.** SSE is unidirectional server-to-client over plain HTTP/1.1
  or HTTP/2. No protocol upgrade negotiation, no separate WS server process,
  no Vercel Edge Network edge-case with long-lived connections.
- **Browser EventSource API.** Built into every modern browser; no client lib
  needed. Auto-reconnect on disconnect is handled by the browser (though Emma
  Chat closes the connection cleanly on `done` or `error`, so reconnect is not
  a concern here).
- **React Router compatible.** A loader that returns a `Response` with a
  streaming body is idiomatic React Router / Remix; no framework hacks needed.
- **Abort signal propagates cleanly.** `request.signal` from the loader
  `LoaderFunctionArgs` is passed directly into `streamEmmaReply({ signal })`,
  which passes it to `client.messages.stream({ signal })`. When the client
  closes the `EventSource` (tab close, navigate away, manual `.close()`), the
  browser aborts the fetch, the loader signal fires, and the Anthropic HTTP
  stream is cancelled within one event loop tick — no orphaned API calls.

WebSocket would require a separate server-side WS handler, bidirectional
framing overhead, and a non-trivial abort-signal bridge. Not worth it for a
unidirectional stream.

---

## Why no Vercel AI SDK

- The `ai` package has **zero presence** in this repo. Adding it for one
  admin-only internal feature would introduce a foreign dependency pattern
  that every future agent touching this codebase would have to learn alongside
  the raw Anthropic SDK that is used everywhere else.
- The raw `@anthropic-ai/sdk` streaming API (`client.messages.stream`) is
  already well-understood here — the SMS v2 orchestrator and emma-orchestrator
  both use it. The tool-use loop in `emma-chat.server.ts` is a direct copy of
  the battle-tested pattern in `app/lib/emma-orchestrator.server.ts:745-817`.
- The Vercel AI SDK abstracts away the SSE framing and tool-use loop in ways
  that would make the 6-hop cap, per-hop DB persistence, and SSE event
  taxonomy harder to control precisely.
- Decision: **keep on raw SDK, establish this SSE shape as the in-house
  streaming pattern.**

---

## Abort-Signal Flow

```
Browser closes EventSource / navigates away
  └─> fetch AbortSignal fires on the loader request
        └─> request.signal passed to streamEmmaReply({ signal })
              └─> AbortSignal.aborted checked at top of each tool-use hop
                    └─> client.messages.stream({ signal }) passed to Anthropic SDK
                          └─> Anthropic HTTP stream cancelled
```

The `aborted` guard at the top of the `for (hop < MAX_TOOL_HOPS)` loop means
a mid-tool-hop abort does NOT leave a torn assistant row in the DB — the hop
boundary is the write point for tool rows, and the final assistant content
is only written on clean `end_turn`.

---

## Event Taxonomy

All events follow the SSE wire format:

```
event: <type>\ndata: <JSON>\n\n
```

| Event type    | Payload                                              | When emitted                                  |
|---------------|------------------------------------------------------|-----------------------------------------------|
| `token`       | `{ text: string }`                                   | Each text delta from Anthropic stream         |
| `tool_call`   | `{ id, name, input }`                                | When model requests a tool                    |
| `tool_result` | `{ tool_use_id, name, durationMs, resultCount? }`    | After tool executes (not the full JSON result)|
| `done`        | `{ messageId: number }`                              | After final assistant row persisted to DB     |
| `error`       | `{ message: string }`                                | Any unrecoverable error; stream closes after  |

Note: `tool_result` emits only diagnostic metadata (duration, count), NOT the
full tool JSON payload. The full payload is stored in `emma_chat_messages
.tool_results` (JSONB) and surfaced to the UI via the next loader revalidation.
This keeps SSE payloads small and avoids sending catalog JSON twice over the wire.

---

## Consequences

### Positive
- No new npm dependencies.
- Abort propagation is clean and verifiable.
- Event taxonomy is explicit and logged at the DB level (tool rows).
- Pattern is copy-pasteable for future streaming features (e.g., a streaming
  AI copy-generator in the admin deal editor).

### Negative / Watch-outs
- `EventSource` does not send cookies on cross-origin requests. This is fine
  here (same origin, admin-only), but any future public-facing streaming
  endpoint would need to re-evaluate auth.
- `EventSource` automatically reconnects on network drop. Emma Chat calls
  `es.close()` on `done` and `error` to prevent spurious reconnects that would
  re-trigger the stream mid-reply. Future implementors must do the same.
- Vercel's serverless functions have a default 10s timeout; streaming responses
  extend this, but the function must begin writing bytes within that window.
  The first `token` event typically arrives within 1–2s of the Anthropic stream
  opening, which is well within the limit.

---

## Recommendation for Future Streaming Features

Copy this shape:
1. Dedicated `api.*` loader route — never a form action.
2. Pass `request.signal` through to the LLM SDK call.
3. Use the five event types above (`token`, `tool_call`, `tool_result`, `done`,
   `error`). Add new event types only if the existing ones cannot carry the data.
4. Do not persist mid-stream partial content — accumulate in memory, flush on
   `end_turn` / `done`.
5. Client: `useEffect` that opens `EventSource` keyed on a kick-counter
   incremented after the `useFetcher` send action resolves. This keeps the SSE
   lifecycle as a side effect of a state change, not a data-fetch.
