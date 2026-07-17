/* global Response, fetch */
// Custos feedback intake (ADR-058/064). Receives the app's POST, gates on a shared token, and forwards
// it to the dev inbox via Resend. TWO kinds share this worker/token/inbox: a BUG REPORT (default —
// description + diagnostics + screenshot attachments) and a FEATURE REQUEST (`kind:'feature'` — a
// problem + a proposed feature, no attachments), each with its own subject + body. Deploy from this
// folder with `npx wrangler deploy` — README.md has the full walkthrough.
//
// Secrets (set once each with `npx wrangler secret put <NAME>`):
//   RESEND_API_KEY — from resend.com → API Keys. Lives only on Cloudflare, never in the app.
//   REPORT_TOKEN   — must equal BUG_REPORT_TOKEN in src/shared/ipc-types.ts (the spam gate).
// Optional plain vars (uncomment in wrangler.toml to override): TO_EMAIL, FROM_EMAIL.

const MAX_SHOTS = 5
const MAX_TOTAL_BASE64 = 12_000_000 // ~9 MB of decoded images — plenty for five window snaps

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
    if (request.headers.get('x-custos-report') !== env.REPORT_TOKEN)
      return json({ ok: false, error: 'unauthorized' }, 401)

    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: 'invalid JSON' }, 400)
    }

    // `kind` is absent on older app builds ⇒ treated as a bug report (backward-compatible).
    const kind = str(body.kind, 20)
    const isFeature = kind === 'feature'
    const name = str(body.name, 200).trim()
    const replyTo = str(body.replyTo, 200).trim()
    const description = str(body.description, 20_000).trim()
    const diagnostics = str(body.diagnostics, 120_000)
    const appVersion = str(body.appVersion, 50)
    const problem = str(body.problem, 20_000).trim()
    const proposedFeature = str(body.proposedFeature, 20_000).trim()

    if (isFeature) {
      if (!problem && !proposedFeature)
        return json({ ok: false, error: 'problem or proposedFeature required' }, 400)
    } else if (!description) {
      return json({ ok: false, error: 'description required' }, 400)
    }

    // Screenshots (bug reports only) arrive as { filename, content(base64) }; cap count + total size.
    const attachments = []
    let total = 0
    const shots = isFeature || !Array.isArray(body.screenshots) ? [] : body.screenshots.slice(0, MAX_SHOTS)
    for (const s of shots) {
      if (!s || typeof s.filename !== 'string' || typeof s.content !== 'string') continue
      total += s.content.length
      if (total > MAX_TOTAL_BASE64) break
      attachments.push({
        filename: s.filename.replace(/[^\w.-]/g, '_').slice(0, 80),
        content: s.content
      })
    }

    const text = (
      isFeature
        ? [
            'Custos feature request',
            `From: ${name || 'anonymous'}`,
            replyTo ? `Reply-to: ${replyTo}` : null,
            appVersion ? `App: v${appVersion}` : null,
            '',
            '--- Problem ---',
            problem || '(none given)',
            '',
            '--- Proposed feature ---',
            proposedFeature || '(none given)'
          ]
        : [
            'Custos bug report',
            `From: ${name || 'anonymous'}`,
            replyTo ? `Reply-to: ${replyTo}` : null,
            appVersion ? `App: v${appVersion}` : null,
            '',
            '--- What went wrong ---',
            description,
            diagnostics ? '' : null,
            diagnostics ? '--- Diagnostics ---' : null,
            diagnostics || null
          ]
    )
      .filter((line) => line !== null)
      .join('\n')

    const subject = isFeature
      ? `[Custos] Feature request${name ? ` from ${name}` : ''}`
      : `[Custos] Bug report${name ? ` from ${name}` : ''}`

    const email = {
      // Resend's built-in test sender delivers only TO the Resend account owner's address — which is
      // exactly the intake inbox, since the account is created with it (see README step 0).
      from: env.FROM_EMAIL || 'Custos Reports <onboarding@resend.dev>',
      // Lowercased: Resend's no-domain restriction compares the recipient against the account
      // owner's address CASE-SENSITIVELY (custosservice@outlook.com) — mixed case gets a 403.
      to: [(env.TO_EMAIL || 'custosservice@outlook.com').toLowerCase()],
      subject,
      text,
      attachments
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) email.reply_to = replyTo

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(email)
    })
    if (!res.ok)
      return json(
        { ok: false, error: `resend ${res.status}: ${(await res.text()).slice(0, 300)}` },
        502
      )
    return json({ ok: true })
  }
}
