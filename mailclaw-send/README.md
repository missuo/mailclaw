# mailclaw-send

Send-only Cloudflare Worker that wraps the Cloudflare Email Service. Defaults the sender to `hello@ttttt.ai`.

## Endpoints

- `POST /api/emails/send` — send an email (Bearer token required)
- `GET /api/health` — unauthenticated health check

## Send request

```bash
curl -X POST https://mailclaw-send.<subdomain>.workers.dev/api/emails/send \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "you@example.com",
    "subject": "Hello",
    "text": "It works."
  }'
```

`from` defaults to `DEFAULT_FROM` (`hello@ttttt.ai`); override it per-request in the body if needed.

## Prerequisites

1. Onboard `ttttt.ai` at Cloudflare dashboard → **Email Sending → Onboard Domain** (adds SPF/DKIM/DMARC + `cf-bounce` MX).
2. Set the API token secret:

   ```bash
   bunx wrangler secret put API_TOKEN
   ```

3. (Optional) To use Resend instead, set both:

   ```bash
   bunx wrangler secret put RESEND_API_KEY
   bunx wrangler secret put EMAIL_PROVIDER   # enter: resend
   ```

## Deploy

```bash
bun install
bun run cf-typegen
bun run deploy
```
