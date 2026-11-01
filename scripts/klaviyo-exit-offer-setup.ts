/**
 * Create the exit offer's code email and its flow in Klaviyo as a DRAFT.
 *
 *   npx tsx scripts/klaviyo-exit-offer-setup.ts
 *
 * The Create Flow API can only make drafts, and nothing here changes a flow's
 * status or sends an email. The owner sets the flow live. It triggers on the
 * exit offer's own list (app/lib/exit-offer.server.ts), which is separate so
 * these signups skip the CURIOUS15 welcome series.
 */
import 'dotenv/config'
import { createFlow, createTemplate, listFlows, listTemplates } from '../app/lib/klaviyo-flows.server'

const LIST_ID = 'TVq6Jz'
const NAME = 'Exit offer: Gawk code'
const CODE = 'GAWK10'
const TERMS = '10% off one Gawk Gawk 3000. One use per customer. Standard US shipping stays free.'
const URL = `https://curious.xdipx.com/gawk-gawk-3000?utm_source=klaviyo&utm_medium=email&utm_campaign=exit-offer`
const SUBJECT = 'Your Gawk code, as promised'
const PREVIEW = 'Enter it at checkout whenever you are ready.'

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${SUBJECT}</title></head>
<body style="margin:0;padding:0;background-color:#F2EFEB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-top:3px solid #C2350F;">
<tr><td style="padding:32px 28px 8px 28px;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:38px;color:#1A1616;">Here's your code.</td></tr>
<tr><td style="padding:12px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:26px;color:#3E3732;">Soft lips, a full spin, your hand doing nothing but holding on. It's yours whenever you want to come back for it.</td></tr>
<tr><td style="padding:20px 28px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="border:2px dashed #C2350F;padding:14px;font-family:Menlo,Consolas,monospace;font-size:28px;letter-spacing:2px;color:#1A1616;">${CODE}</td></tr></table></td></tr>
<tr><td style="padding:12px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#3E3732;">${TERMS} Enter the code at checkout.</td></tr>
<tr><td align="center" style="padding:24px 28px 8px 28px;"><a href="${URL}" style="display:block;background-color:#C2350F;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;line-height:24px;padding:15px 24px;text-decoration:none;">I'll take it ♥</a></td></tr>
<tr><td style="padding:16px 28px 28px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5E5650;">Plain box. Your statement reads XDIPX. For adults, 18 and over.<br>xdipx, {{ organization.full_address }}<br>{% unsubscribe 'Unsubscribe' %}</td></tr>
</table></td></tr></table></body></html>`

const text = `Here's your code: ${CODE}\n\n${TERMS} Enter the code at checkout.\n\n${URL}\n\nPlain box. Your statement reads XDIPX. For adults, 18 and over.\nxdipx, {{ organization.full_address }}\n{% unsubscribe 'Unsubscribe' %}`

async function main() {
  const flow = (await listFlows()).find(f => f.name === NAME)
  if (flow) {
    console.log(`flow exists: ${flow.id} (${flow.status})`)
    return
  }
  const template = (await listTemplates()).find(t => t.name === NAME) ?? (await createTemplate({ name: NAME, html, text }))
  const created = await createFlow({
    data: {
      type: 'flow',
      attributes: {
        name: NAME,
        definition: {
          triggers: [{ type: 'list', id: LIST_ID }],
          entry_action_id: 'email-1',
          actions: [
            {
              temporary_id: 'email-1',
              type: 'send-email',
              links: { next: null },
              data: {
                message: {
                  name: NAME,
                  subject_line: SUBJECT,
                  preview_text: PREVIEW,
                  from_email: process.env['EMAIL_FROM'] ?? 'hello@xdipx.com',
                  from_label: 'xdipx',
                  reply_to_email: process.env['EMAIL_FROM'] ?? 'hello@xdipx.com',
                  smart_sending_enabled: false,
                  transactional: false,
                  add_tracking_params: true,
                  template_id: template.id,
                },
              },
            },
          ],
        },
      },
    },
  })
  console.log(`created template ${template.id}, flow ${created.id} (${created.status})`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
