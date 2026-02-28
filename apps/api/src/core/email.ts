/** Email abstraction — logs in dev, uses Resend in production. */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.EMAIL_FROM ?? 'noreply@aar.dev'

  if (!resendKey) {
    // Dev mode: log to console
    console.log(`[email] To: ${to} | Subject: ${subject}\n${body}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${resendKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to,
      subject,
      text: body,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[email] Failed to send to ${to}: ${err}`)
  }
}
