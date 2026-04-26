/**
 * MCP Streamable HTTP route — bearer-auth gated.
 *
 * Stateless mode: each request gets a fresh transport + server pair. Simpler
 * for tools-only servers (no session continuity needed). The cost is a tiny
 * per-request setup overhead — negligible vs the LLM call any tool ends up
 * driving.
 *
 * Auth: requires `Authorization: Bearer $MCP_BEARER_TOKEN`. Without that env
 * var set, the route returns 503 — fail-closed prevents accidental exposure.
 */
import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from '../app/lib/mcp-seo-bank.server.js'

function safeBearerCheck(req: Request): boolean {
  const expected = process.env['MCP_BEARER_TOKEN']
  if (!expected || expected.length === 0) return false
  const auth = req.headers['authorization']
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return false
  const provided = auth.slice('Bearer '.length).trim()
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function createMcpRoutes() {
  const router = Router()

  // Health check (no auth) — quick way to confirm the route is wired.
  router.get('/health', (_req, res) => {
    const enabled = !!process.env['MCP_BEARER_TOKEN']
    res.json({ ok: true, enabled, server: 'xdipx-seo-bank', version: '0.1.0' })
  })

  // MCP endpoint. Streamable HTTP supports both POST (client → server message)
  // and GET (server → client SSE stream); the transport handles both via
  // handleRequest. We accept ALL HTTP methods so the SDK chooses what to do.
  router.all('/seo-bank', async (req: Request, res: Response) => {
    if (!process.env['MCP_BEARER_TOKEN']) {
      res.status(503).json({ error: 'MCP not configured (MCP_BEARER_TOKEN unset)' })
      return
    }
    if (!safeBearerCheck(req)) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      // Stateless mode: explicitly pass `sessionIdGenerator: undefined`. The
      // SDK's runtime supports this (see SDK Streamable HTTP docs) even though
      // the published TypeScript signature with exactOptionalPropertyTypes
      // doesn't model it cleanly — hence the cast.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as any)
      const server = buildMcpServer()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await server.connect(transport as any)
      // The SDK reads the body; Express's express.json() upstream populates req.body.
      await transport.handleRequest(req, res, req.body)
      // Clean up — connect/handleRequest tear down naturally when the response ends.
    } catch (err) {
      console.error('[mcp:seo-bank]', err)
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) })
      }
    }
  })

  return router
}
