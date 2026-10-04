import './_load-env'
import {
  FLOW_EMAILS,
  renderFlowEmail,
  flowTemplateName,
  type FlowSlug,
} from '../app/lib/klaviyo-flow-templates'
import {
  FLOW_NAMES,
  FLOW_TRIGGER_METRICS,
  MANUAL_FLOW_STEPS,
  buildFlowPayload,
  createFlow,
  createTemplate,
  emailsForFlow,
  getMetricIdsByName,
  listFlows,
  listTemplates,
  updateTemplate,
} from '../app/lib/klaviyo-flows.server'

/**
 * Create the Klaviyo templates and DRAFT flows for Ad Studio v2 PR-F.
 *
 *   npx tsx scripts/klaviyo-flows-setup.ts --dry-run   print what it would do
 *   npx tsx scripts/klaviyo-flows-setup.ts             create what is missing
 *   npx tsx scripts/klaviyo-flows-setup.ts --update-templates
 *                                                      also overwrite existing template HTML
 *                                                      (flows copy a template when created, so
 *                                                      already-built flow emails do not follow)
 *
 * Idempotent: a template or flow whose name already exists is skipped. Nothing
 * here sends. Every flow is created with status draft and every email action
 * with message status draft; the owner sets a flow live in Klaviyo. If the API
 * refuses a flow, the script prints MANUAL_FLOW_STEPS for it and carries on.
 */

const dryRun = process.argv.includes('--dry-run')
const updateTemplates = process.argv.includes('--update-templates')
const FLOWS: FlowSlug[] = ['browse-abandonment', 'cart-abandonment', 'post-purchase']

async function main() {
  console.log(`klaviyo-flows-setup ${dryRun ? '(dry run, nothing is created)' : '(live)'}`)
  const haveKey = !!process.env['KLAVIYO_API_KEY']
  console.log(`KLAVIYO_API_KEY: ${haveKey ? 'set' : 'MISSING'}`)

  // Templates
  let templates = new Map<string, string>()
  let flows = new Map<string, { id: string; status: string }>()
  let metrics = new Map<string, string>()
  if (haveKey) {
    try {
      templates = new Map((await listTemplates()).map(t => [t.name, t.id]))
      flows = new Map((await listFlows()).map(f => [f.name, { id: f.id, status: f.status }]))
      metrics = await getMetricIdsByName()
    } catch (err) {
      console.log(`read check failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  const templateIds: Record<string, string> = {}
  console.log('\nTEMPLATES')
  for (const spec of FLOW_EMAILS) {
    const r = renderFlowEmail(spec)
    const existing = templates.get(r.name)
    if (existing) {
      templateIds[spec.key] = existing
      if (updateTemplates && !dryRun) {
        await updateTemplate(existing, { html: r.html, text: r.text })
        console.log(`  updated  ${r.name} (${existing})`)
      } else {
        console.log(`  exists   ${r.name} (${existing})`)
      }
      continue
    }
    if (dryRun) {
      templateIds[spec.key] = `<new:${spec.key}>`
      console.log(`  would create ${r.name}  html=${r.html.length}b text=${r.text.length}b`)
      console.log(`     subjects: ${spec.subjects.map(s => JSON.stringify(s)).join(' | ')}`)
      continue
    }
    const created = await createTemplate({ name: r.name, html: r.html, text: r.text })
    templateIds[spec.key] = created.id
    console.log(`  created  ${created.name} (${created.id})`)
  }

  console.log('\nFLOWS (always draft)')
  const placedOrderMetricId = metrics.get('Placed Order') ?? null
  for (const flow of FLOWS) {
    const name = FLOW_NAMES[flow]
    const existing = flows.get(name)
    if (existing) {
      console.log(`  exists   ${name} (${existing.id}, status ${existing.status})`)
      continue
    }
    const triggerName = FLOW_TRIGGER_METRICS[flow]
    const triggerMetricId = metrics.get(triggerName) ?? (dryRun && metrics.size === 0 ? `<metric:${triggerName}>` : null)
    if (!triggerMetricId) {
      console.log(`  BLOCKED  ${name}: metric "${triggerName}" does not exist in Klaviyo yet (a metric appears after its first event).`)
      console.log('           Manual steps:')
      for (const step of MANUAL_FLOW_STEPS[flow]) console.log(`             - ${step}`)
      continue
    }
    const payload = buildFlowPayload(flow, {
      triggerMetricId,
      placedOrderMetricId: placedOrderMetricId ?? (dryRun && metrics.size === 0 ? '<metric:Placed Order>' : null),
      templateIds,
      fromEmail: process.env['EMAIL_FROM'] ?? 'hello@xdipx.com',
      fromLabel: 'xdipx',
    })
    const steps = emailsForFlow(flow).map(e => `${e.delayHours}h:${e.key}`).join(', ')
    if (dryRun) {
      console.log(`  would create ${name} (status draft) trigger=${triggerName} steps=[${steps}]`)
      continue
    }
    try {
      const created = await createFlow(payload)
      console.log(`  created  ${created.name} (${created.id}, status ${created.status})`)
    } catch (err) {
      console.log(`  FAILED   ${name}: ${err instanceof Error ? err.message : err}`)
      console.log('           Manual steps:')
      for (const step of MANUAL_FLOW_STEPS[flow]) console.log(`             - ${step}`)
    }
  }
  console.log('\nTemplate names: ' + FLOW_EMAILS.map(flowTemplateName).join('; '))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
