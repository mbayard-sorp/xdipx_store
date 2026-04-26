/**
 * MCP server — SEO keyword bank manager.
 *
 * Transport-agnostic. The Express layer (server/index.ts) wires this to
 * Streamable HTTP at /mcp/seo-bank. Same module could be hooked to stdio in a
 * separate entry without code change to tool definitions.
 *
 * Tools (MVP):
 *   1. list_keywords       — browse/filter the bank
 *   2. approve_keyword     — flip status to approved
 *   3. reject_keyword      — flip status to rejected
 *   4. flag_keyword        — mark policy-flagged
 *   5. bank_stats          — counts + last research run
 *   6. trigger_research    — kick off /cron/keyword-research
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { createClient } from '@sanity/client'

const projectId  = process.env['SANITY_PROJECT_ID']
const dataset    = process.env['SANITY_DATASET'] ?? 'production'
const apiVersion = '2024-10-01'

function getWriteClient() {
  if (!projectId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false,
    token: process.env['SANITY_API_TOKEN'],
    perspective: 'raw',
  } as any)
}

function textResult(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text }] }
}

function jsonResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return textResult(JSON.stringify(value, null, 2))
}

/** Resolve a keyword id from either an explicit id or the term string. */
async function resolveKeywordId(idOrTerm: string): Promise<string | null> {
  const client = getWriteClient()
  if (!client) return null
  if (idOrTerm.startsWith('seoKeyword.')) return idOrTerm
  // Treat as term lookup. Lowercase comparison.
  const row = await client.fetch<{ _id: string } | null>(
    `*[_type == "seoKeyword" && lower(term) == lower($term)][0]{ _id }`,
    { term: idOrTerm },
  )
  return row?._id ?? null
}

/**
 * Builds and returns a configured McpServer with all SEO bank tools registered.
 * Caller wires the transport (HTTP, stdio, etc.).
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'xdipx-seo-bank', version: '0.1.0' })

  // ── 1. list_keywords ────────────────────────────────────────────────────
  server.registerTool(
    'list_keywords',
    {
      title: 'List keywords',
      description: 'Browse the SEO keyword bank with filters. Defaults to pending status so the agent triages the gray zone first. Returns the term, status, kind, intent, volume, difficulty, relevanceScore, cluster slug, and tag arrays. Useful for: triage, finding gaps, locating duplicates.',
      inputSchema: {
        status:      z.enum(['pending', 'approved', 'rejected', 'archived']).optional().describe('Defaults to "pending".'),
        kind:        z.enum(['head', 'long-tail', 'question', 'branded']).optional(),
        intent:      z.enum(['informational', 'transactional', 'navigational', 'commercial']).optional(),
        clusterSlug: z.string().optional().describe('Filter to one cluster by slug.'),
        minVolume:   z.number().optional(),
        maxDifficulty: z.number().optional(),
        flagged:     z.boolean().optional(),
        search:      z.string().optional().describe('Substring match on the term.'),
        limit:       z.number().min(1).max(200).optional().describe('Defaults to 50.'),
        offset:      z.number().min(0).optional(),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const status = args.status ?? 'pending'
      const limit  = args.limit  ?? 50
      const offset = args.offset ?? 0
      const filters: string[] = [`_type == "seoKeyword"`, `status == $status`]
      const params: Record<string, unknown> = { status, limit, offset }
      if (args.kind)          { filters.push(`kind == $kind`);     params.kind = args.kind }
      if (args.intent)        { filters.push(`intent == $intent`); params.intent = args.intent }
      if (args.clusterSlug)   { filters.push(`cluster->slug.current == $clusterSlug`); params.clusterSlug = args.clusterSlug }
      if (args.minVolume != null)    { filters.push(`volume >= $minVolume`); params.minVolume = args.minVolume }
      if (args.maxDifficulty != null){ filters.push(`difficulty <= $maxDifficulty`); params.maxDifficulty = args.maxDifficulty }
      if (args.flagged != null)      { filters.push(`flagged == $flagged`); params.flagged = args.flagged }
      if (args.search)        { filters.push(`term match $search`); params.search = `*${args.search}*` }
      const groq = `*[${filters.join(' && ')}] | order(coalesce(relevanceScore, 0) desc, coalesce(volume, 0) desc) [$offset...$offset + $limit] {
        _id, term, kind, intent, volume, difficulty, cpc, relevanceScore,
        productTypeDials, moodTags, audienceTags, mattersTags, contentTypes,
        status, flagged, flagReason,
        "cluster": cluster->{ "slug": slug.current, title, pillarTerm }
      }`
      const rows = await client.fetch(groq, params)
      const total = await client.fetch<number>(`count(*[${filters.join(' && ')}])`, params)
      return jsonResult({ total, returned: Array.isArray(rows) ? rows.length : 0, offset, limit, keywords: rows })
    },
  )

  // ── 2. approve_keyword ──────────────────────────────────────────────────
  server.registerTool(
    'approve_keyword',
    {
      title: 'Approve keyword',
      description: 'Flip a keyword to status="approved" AND clear flagged=false (approval implicitly unflags — the gen-time filter requires both `status="approved"` AND `flagged != true`, so an approved-but-still-flagged keyword would be silently excluded). Pass either the Sanity _id (preferred) or the term string. The optional reason is stored on the doc\'s notes field for audit.',
      inputSchema: {
        idOrTerm: z.string().describe('Sanity _id or the exact term.'),
        reason:   z.string().optional(),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const id = await resolveKeywordId(args.idOrTerm)
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`)
      const patch: Record<string, unknown> = { status: 'approved', flagged: false }
      if (args.reason) patch.notes = args.reason
      await client.patch(id).set(patch).commit()
      return textResult(`✓ approved (unflagged) · ${id}`)
    },
  )

  // ── 3. reject_keyword ───────────────────────────────────────────────────
  server.registerTool(
    'reject_keyword',
    {
      title: 'Reject keyword',
      description: 'Flip a keyword to status="rejected". Rejected terms are excluded from generation and added to the <avoid> list passed to Claude during copy generation. Use for: off-brand, competitor brand names, genuinely irrelevant terms, "not in catalog" mismatches. Does NOT change the flagged field — if a term is rejected AND flagged, it just stays both. Optional reason → notes for audit.',
      inputSchema: {
        idOrTerm: z.string(),
        reason:   z.string().optional(),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const id = await resolveKeywordId(args.idOrTerm)
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`)
      const patch: Record<string, unknown> = { status: 'rejected' }
      if (args.reason) patch.notes = args.reason
      await client.patch(id).set(patch).commit()
      return textResult(`✗ rejected · ${id}`)
    },
  )

  // ── 4. flag_keyword ─────────────────────────────────────────────────────
  server.registerTool(
    'flag_keyword',
    {
      title: 'Flag keyword',
      description: 'Set flagged=true on a keyword. Flagged terms are excluded from generation regardless of status. ONLY use for the three valid policy categories: (1) off-brand competitor name (KY, Womanizer, We-Vibe, etc.), (2) regulated medical/efficacy claim ("treats X", "doctor recommended"), (3) explicit-only term outside the tasteful catalog. NOT for "not in catalog" mismatches (use reject_keyword for those) or "borders on competitor comparison" softness (those are usually category descriptors that should be approved). Use unflag_keyword to undo.',
      inputSchema: {
        idOrTerm: z.string(),
        reason:   z.string().describe('One-line reason. Must fit one of the three policy categories above.'),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const id = await resolveKeywordId(args.idOrTerm)
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`)
      await client.patch(id).set({ flagged: true, flagReason: args.reason }).commit()
      return textResult(`⚑ flagged · ${id} · ${args.reason}`)
    },
  )

  // ── 4b. unflag_keyword ──────────────────────────────────────────────────
  server.registerTool(
    'unflag_keyword',
    {
      title: 'Unflag keyword',
      description: 'Clear flagged=false on a keyword without changing its status (use approve_keyword if you also want to approve in one shot — that does both). Use this when the keyword was over-flagged but you want to leave it in pending for further review, OR to clear a flag on an already-approved keyword that approve_keyword may have missed (older code paths). Optional reason replaces flagReason for audit.',
      inputSchema: {
        idOrTerm: z.string(),
        reason:   z.string().optional().describe('Replaces flagReason on the doc, e.g. "false-positive: category descriptor".'),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const id = await resolveKeywordId(args.idOrTerm)
      if (!id) return textResult(`No keyword found for "${args.idOrTerm}".`)
      const patch: Record<string, unknown> = { flagged: false }
      // Replace flagReason rather than leave the old one stale.
      patch.flagReason = args.reason ?? null
      await client.patch(id).set(patch).commit()
      return textResult(`✓ unflagged · ${id}`)
    },
  )

  // ── 4c. bulk_update_status ──────────────────────────────────────────────
  server.registerTool(
    'bulk_update_status',
    {
      title: 'Bulk update status (mixed verdicts)',
      description: 'Apply MIXED status updates to up to 50 keywords in one tool call. Each update is an independent { idOrTerm, status, reason? } object — so a single call can approve some, reject others, and pending the rest. Much faster than per-keyword calls. When an update sets status="approved", flagged is also cleared on that doc (matches approve_keyword behavior). Other statuses leave flagged untouched. Returns per-update success/failure. Use this for triage batches; use unflag_keyword separately if you want to clear flags without any status change.',
      inputSchema: {
        updates: z.array(z.object({
          idOrTerm: z.string().describe('Sanity _id or exact term.'),
          status:   z.enum(['approved', 'rejected', 'pending', 'archived']),
          reason:   z.string().optional().describe('Stored on the doc\'s notes field.'),
        })).min(1).max(50),
      },
    },
    async (args) => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const results: { idOrTerm: string; status: string; resolvedId: string | null; ok: boolean; error?: string }[] = []
      for (const u of args.updates) {
        try {
          const id = await resolveKeywordId(u.idOrTerm)
          if (!id) {
            results.push({ idOrTerm: u.idOrTerm, status: u.status, resolvedId: null, ok: false, error: 'not found' })
            continue
          }
          const patch: Record<string, unknown> = { status: u.status }
          if (u.status === 'approved') patch.flagged = false
          if (u.reason) patch.notes = u.reason
          await client.patch(id).set(patch).commit()
          results.push({ idOrTerm: u.idOrTerm, status: u.status, resolvedId: id, ok: true })
        } catch (err) {
          results.push({
            idOrTerm: u.idOrTerm,
            status:   u.status,
            resolvedId: null,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
      const byStatus: Record<string, number> = {}
      for (const r of results) {
        if (r.ok) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      }
      const summary = {
        total:    results.length,
        ok:       results.filter(r => r.ok).length,
        failed:   results.filter(r => !r.ok).length,
        byStatus,
      }
      return jsonResult({ summary, results })
    },
  )

  // ── 5. bank_stats ───────────────────────────────────────────────────────
  server.registerTool(
    'bank_stats',
    {
      title: 'Bank statistics',
      description: 'Summary of the keyword bank: total keywords, counts by status, count of clusters, count of flagged terms, and the most-recent research run timestamp. Cheap call — useful as a sanity check before / after triage sessions.',
      inputSchema: {},
    },
    async () => {
      const client = getWriteClient()
      if (!client) return textResult('Sanity not configured.')
      const stats = await client.fetch<{
        total:    number
        approved: number
        pending:  number
        rejected: number
        archived: number
        flagged:  number
        clusters: number
        lastResearched: string | null
      }>(`{
        "total":    count(*[_type == "seoKeyword"]),
        "approved": count(*[_type == "seoKeyword" && status == "approved"]),
        "pending":  count(*[_type == "seoKeyword" && status == "pending"]),
        "rejected": count(*[_type == "seoKeyword" && status == "rejected"]),
        "archived": count(*[_type == "seoKeyword" && status == "archived"]),
        "flagged":  count(*[_type == "seoKeyword" && flagged == true]),
        "clusters": count(*[_type == "seoCluster" && status != "archived"]),
        "lastResearched": *[_type == "seoKeyword"] | order(lastResearchedAt desc)[0].lastResearchedAt
      }`)
      return jsonResult(stats)
    },
  )

  // ── 6. trigger_research ─────────────────────────────────────────────────
  server.registerTool(
    'trigger_research',
    {
      title: 'Trigger keyword research',
      description: 'Run the SEO research pipeline on demand (DataForSEO + LLM clusterer + Sanity write). Defaults to pulling seeds from existing clusters + approved heads + product titles. Pass manualSeeds to research specific terms. Costs ~$0.05 per seed when DataForSEO is configured. Returns a summary including how many candidates were written.',
      inputSchema: {
        manualSeeds: z.array(z.string()).optional().describe('Specific terms to seed the run with. Each gets its own related-keywords expansion.'),
        maxSeeds:    z.number().min(1).max(80).optional().describe('Cap the seed count. Defaults to 80.'),
      },
    },
    async (args) => {
      const cronSecret = process.env['CRON_SECRET']
      const baseUrl    = process.env['MCP_CRON_BASE_URL'] ?? `http://localhost:${process.env['PORT'] ?? 3000}`
      if (!cronSecret) return textResult('CRON_SECRET not set — cannot trigger research.')
      const body: Record<string, unknown> = {}
      if (args.manualSeeds?.length) body.manualSeeds = args.manualSeeds
      if (typeof args.maxSeeds === 'number') body.maxSeeds = args.maxSeeds
      try {
        const res = await fetch(`${baseUrl}/cron/keyword-research`, {
          method: 'POST',
          headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({ raw: 'unparseable response' }))
        if (!res.ok) return jsonResult({ ok: false, status: res.status, ...data })
        return jsonResult(data)
      } catch (err) {
        return textResult(`Research call failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  )

  return server
}
