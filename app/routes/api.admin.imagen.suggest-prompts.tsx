import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let title = '', description = '', tags = '', vendor = ''
  try {
    const body = await request.json() as {
      title?: string; description?: string; tags?: string; vendor?: string
    }
    title       = body.title       ?? ''
    description = body.description ?? ''
    tags        = body.tags        ?? ''
    vendor      = body.vendor      ?? ''
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Strip HTML, truncate description
  const plainDesc = description.replace(/<[^>]*>/g, '').slice(0, 500)

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: `You are a creative director for an adult sexual wellness eCommerce brand called xdipx.
Generate 5 short, evocative image generation prompts for product photography.
Prompts should be clean, tasteful, and lifestyle-focused — not explicit.
Use a modern minimalist studio aesthetic with coral-orange and warm neutral tones.
Return ONLY a JSON array of 5 strings. No preamble, no markdown, no explanation.`,
    messages: [{
      role: 'user',
      content: `Product: ${title}\nBrand: ${vendor}\nDescription: ${plainDesc}\nTags: ${tags}`,
    }],
  })

  const block = msg.content[0]
  if (block?.type !== 'text') {
    return Response.json({ error: 'Unexpected Claude response' }, { status: 502 })
  }

  let prompts: string[]
  try {
    const cleaned = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    prompts = JSON.parse(cleaned) as string[]
    if (!Array.isArray(prompts)) throw new Error('Not an array')
    prompts = prompts.filter(p => typeof p === 'string' && p.trim())
  } catch {
    return Response.json({ error: 'Failed to parse suggestions', raw: block.text }, { status: 502 })
  }

  return Response.json({ prompts })
}
