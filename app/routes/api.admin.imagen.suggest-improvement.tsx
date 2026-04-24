import type { ActionFunctionArgs } from 'react-router'
import { requireAdmin } from '~/lib/session.server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']?.trim() })

export async function action({ request }: ActionFunctionArgs) {
  await requireAdmin(request)

  let imageUrl = '', productContext = ''
  try {
    const body = await request.json() as { imageUrl?: string; productContext?: string }
    imageUrl       = body.imageUrl       ?? ''
    productContext = body.productContext ?? ''
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: `You are a creative director for a premium wellness eCommerce brand.
Suggest 3 concise image improvement directions for a product photo.
Directions should be about lighting, background, mood, composition, or color.
Return ONLY a JSON array of 3 short strings (under 15 words each). No preamble, no markdown.`,
    messages: [{
      role: 'user',
      content: `Product: ${productContext || 'premium wellness product'}\nImage URL: ${imageUrl || '(not provided)'}`,
    }],
  })

  const block = msg.content[0]
  if (block?.type !== 'text') {
    return Response.json({ error: 'Unexpected Claude response' }, { status: 502 })
  }

  let suggestions: string[]
  try {
    const cleaned = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()
    suggestions = JSON.parse(cleaned) as string[]
    if (!Array.isArray(suggestions)) throw new Error('Not an array')
    suggestions = suggestions.filter(s => typeof s === 'string' && s.trim()).slice(0, 3)
  } catch {
    return Response.json({ error: 'Failed to parse suggestions', raw: block.text }, { status: 502 })
  }

  return Response.json({ suggestions })
}
