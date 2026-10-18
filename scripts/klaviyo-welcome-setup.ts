/**
 * Create the welcome email templates and the paid-leads welcome flow draft in
 * Klaviyo (tickets #16143 and #16144).
 *
 *   npx tsx scripts/klaviyo-welcome-setup.ts --dry-run              print what it would do
 *   npx tsx scripts/klaviyo-welcome-setup.ts                        create missing templates and the draft flow
 *   npx tsx scripts/klaviyo-welcome-setup.ts --update-templates     overwrite existing templates with the current render
 *   npx tsx scripts/klaviyo-welcome-setup.ts --family paid-leads    only one family (paid-leads | email-list)
 *
 * The flow is created as a DRAFT (the Create Flow API cannot do otherwise and
 * nothing here changes a flow's status). The email-list family creates saved
 * templates only; the owner swaps them into the existing "Welcome Series
 * (Email)" flow by hand. Nothing in this script sends an email.
 */
import 'dotenv/config'
import {
  createFlow,
  createTemplate,
  getMetricIdsByName,
  listFlows,
  listTemplates,
  updateTemplate,
} from '../app/lib/klaviyo-flows.server'
import {
  WELCOME_FLOW_NAMES,
  buildWelcomeFlowPayload,
  renderWelcomeEmail,
  welcomeEmailsFor,
  type WelcomeFlowSlug,
} from '../app/lib/klaviyo-welcome-templates'

const dryRun = process.argv.includes('--dry-run')
const updateTemplates = process.argv.includes('--update-templates')
const familyArg = process.argv[process.argv.indexOf('--family') + 1]
const families: WelcomeFlowSlug[] =
  process.argv.includes('--family')
    ? [familyArg === 'email-list' ? 'email-list-welcome' : 'paid-leads-welcome']
    : ['paid-leads-welcome', 'email-list-welcome']

async function main() {
  console.log(`klaviyo-welcome-setup ${dryRun ? '(dry run, nothing is created)' : '(live, drafts only)'}`)
  const haveKey = !!process.env['KLAVIYO_API_KEY']
  const listId = process.env['KLAVIYO_LIST_ID_PAID_LEADS'] ?? null
  console.log(`KLAVIYO_API_KEY: ${haveKey ? 'set' : 'MISSING'}  KLAVIYO_LIST_ID_PAID_LEADS: ${listId ?? 'MISSING'}`)

  let templates = new Map<string, string>()
  let flows = new Map<string, { id: string; status: string }>()
  let metrics = new Map<string, string>()
  if (haveKey) {
    templates = new Map((await listTemplates()).map(t => [t.name, t.id]))
    flows = new Map((await listFlows()).map(f => [f.name, { id: f.id, status: f.status }]))
    metrics = await getMetricIdsByName()
  }

  const templateIds: Record<string, string> = {}
  for (const family of families) {
    console.log(`\nTEMPLATES ${family}`)
    for (const spec of welcomeEmailsFor(family)) {
      const r = renderWelcomeEmail(spec)
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
        console.log(`  would create ${r.name}  html=${r.html.length}b text=${r.text.length}b  subject=${JSON.stringify(spec.subject)}`)
        continue
      }
      const created = await createTemplate({ name: r.name, html: r.html, text: r.text })
      templateIds[spec.key] = created.id
      console.log(`  created  ${created.name} (${created.id})`)
    }
  }

  if (families.includes('paid-leads-welcome')) {
    console.log('\nFLOW (always draft)')
    const name = WELCOME_FLOW_NAMES['paid-leads-welcome']
    const existing = flows.get(name)
    if (existing) {
      console.log(`  exists   ${name} (${existing.id}, status ${existing.status})`)
    } else if (!listId) {
      console.log(`  BLOCKED  ${name}: KLAVIYO_LIST_ID_PAID_LEADS is not set in this environment.`)
    } else {
      const payload = buildWelcomeFlowPayload({
        listId,
        placedOrderMetricId: metrics.get('Placed Order') ?? null,
        templateIds,
        fromEmail: process.env['EMAIL_FROM'] ?? 'hello@xdipx.com',
        fromLabel: 'xdipx',
      })
      if (dryRun) {
        console.log(`  would create ${name} (status draft) trigger=list:${listId} steps=[0h:welcome-0h, 72h:welcome-3d] filter=${metrics.get('Placed Order') ? 'zero Placed Order in 30d' : 'none (metric unknown)'}`)
      } else {
        const created = await createFlow(payload)
        console.log(`  created  ${created.name} (${created.id}, status ${created.status})`)
      }
    }
  }
  if (families.includes('email-list-welcome')) {
    console.log('\nEMAIL LIST: templates only. Owner swaps them into flow "Welcome Series (Email)" (XpAtS7) in Klaviyo > Flows, one message at a time, then sets the flow live.')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
