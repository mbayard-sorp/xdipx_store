/**
 * Twilio REST wrapper for outbound SMS — no twilio npm package, just fetch.
 * Used by the sendDealLinkSMS tool when a caller asks us to text them the link.
 */
const ACCOUNT_SID = process.env['TWILIO_ACCOUNT_SID'] ?? ''
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? ''
const FROM_NUMBER = process.env['TWILIO_PHONE_NUMBER'] ?? ''

export async function sendSms(to: string, body: string): Promise<string> {
  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    throw new Error('Twilio credentials missing')
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
  const form = new URLSearchParams({ To: to, From: FROM_NUMBER, Body: body })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio SMS failed ${res.status}: ${text}`)
  }
  const data = (await res.json()) as { sid: string }
  return data.sid
}

export async function sendDealLinkSMS(
  toNumber: string,
  deal: { title: string; url: string },
): Promise<void> {
  await sendSms(toNumber, `Today at xdipx: ${deal.title} — ${deal.url}`)
}
