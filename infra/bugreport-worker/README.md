# Custos bug-report intake worker

Receives the app's bug-report POST and forwards it to **CustosService@outlook.com** as an email (via
Resend) with the screenshots attached — so testers get one-click "Send report" instead of dragging
files into a mail draft (ADR-058). Until this is deployed and the URL is baked into the app, the app
automatically uses the old two-step email flow, so nothing is broken in the meantime.

Everything below is free at friends-cohort scale (Cloudflare Workers free: 100k requests/day; Resend
free: ~100 emails/day).

## Step 0 — Resend account (~5 min)

1. Go to **resend.com** → Sign up — **use CustosService@outlook.com as the signup email.** This is
   what makes the no-domain setup work: Resend's built-in sender (`onboarding@resend.dev`) delivers
   only *to the account owner's own address* — which is exactly where reports should land.
2. Verify the email, log in → **API Keys** → **Create API Key** (name: `custos-worker`, sending
   access is enough). Copy the `re_…` key — it's shown once.

## Step 1 — Cloudflare account (~5 min)

1. **dash.cloudflare.com/sign-up** → sign up (CustosService@outlook.com again keeps the app-service
   accounts together). Verify the email.
2. Done — the free plan needs no credit card for Workers, and no domain (you get `*.workers.dev`).

## Step 2 — Log the CLI in (one-time)

From a terminal **in this folder** (`infra/bugreport-worker/`):

```
npx wrangler login
```

A browser tab opens → **Allow** → the terminal reports success. (`npx` fetches Wrangler on demand.)

## Step 3 — Deploy

```
npx wrangler deploy
```

- First-ever deploy: it asks you to pick your free `*.workers.dev` subdomain — choose anything
  (e.g. `custos`).
- It prints the live URL, e.g. `https://custos-bugreport.custos.workers.dev` —
  **copy it; this is one of the two values to bake into the app.**

## Step 4 — Set the two secrets

```
npx wrangler secret put RESEND_API_KEY
```
→ paste the `re_…` key from Step 0 (input hidden).

```
npx wrangler secret put REPORT_TOKEN
```
→ paste exactly this value (it is already baked into the app as `BUG_REPORT_TOKEN`):

```
f0b29921746fe8f452087dc11d768e20e80ce7d8bf76ed28
```

Secrets are stored encrypted on Cloudflare and take effect immediately. (The token is a spam gate,
not a true secret — it ships inside the app; its job is keeping random internet noise out of the
inbox.)

## Step 5 — Smoke test

```
curl -X POST https://custos-bugreport.<your-subdomain>.workers.dev/ \
  -H "content-type: application/json" \
  -H "x-custos-report: f0b29921746fe8f452087dc11d768e20e80ce7d8bf76ed28" \
  -d "{\"name\":\"Smoke test\",\"description\":\"Hello from the worker\",\"diagnostics\":\"none\",\"screenshots\":[]}"
```

Expected: `{"ok":true}` and an email in CustosService@outlook.com within seconds (check junk the
first time). Re-run without the `x-custos-report` header to confirm you get a `401`.

## Step 6 — Turn auto-send on in the app

Paste the worker URL into `BUG_REPORT_ENDPOINT` in `src/shared/ipc-types.ts` (the token is already
there). Restart the dev app (shared-file change) — the dialog's button becomes **Send report** and
submissions deliver themselves; the bundle + mail-draft flow remains as the automatic offline/failure
fallback.
