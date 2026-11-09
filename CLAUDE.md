# MailClaw

Cloudflare Workers email inbox service with a Rust CLI. Receives emails via Email Routing (catch-all), stores in D1, exposes token-protected REST API for AI agents.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono.js + TypeScript
- **Database**: Cloudflare D1
- **Attachment storage**: Cloudflare R2 (`ATTACHMENTS` bucket)
- **Email Parsing**: postal-mime + html-to-text
- **CLI**: Rust (clap + reqwest + serde)
- **Package Manager**: Bun
- **Linter/Formatter**: Biome (tabs, double quotes, semicolons, 100 char width)

## Scripts

- `bun run dev` — Local dev (remote mode)
- `bun run deploy` — Deploy to Cloudflare
- `bun run tsc` — Type check
- `bun run check` — Biome lint + format check
- `bun run check:fix` — Biome lint + format with auto-fix
- `bun run lint` — Biome lint only
- `bun run lint:fix` — Biome lint with auto-fix
- `bun run format` — Biome format only
- `bun run tail` — Wrangler tail (live logs)
- `bun run cf-typegen` — Generate Cloudflare binding types
- `bun run r2:create` — Create R2 attachment bucket
- `bun run db:create` — Create D1 database
- `bun run db:tables` — Apply schema (idempotent; fresh installs get all tables incl. `devices`)
- `bun run db:indexes` — Apply indexes (idempotent)
- `bun run db:upgrade` — One-time v2 migration for pre-existing deployments (ALTERs; do not run twice)
- `bun run db:upgrade-v3` — One-time v3 migration: AI enrichment columns + `settings` table
- `bun run db:upgrade-v4` — One-time v4 migration: `otp` column

## Project Structure

```
src/                            # Cloudflare Worker (TypeScript)
├── index.ts                    # Worker entry (fetch + email handlers)
├── app.ts                      # Hono app setup, middleware, routes
├── env.d.ts                    # CloudflareBindings secret extensions
├── types.ts                    # TypeScript types
├── version.ts                  # SERVER_VERSION + capability list
├── middleware/auth.ts          # Bearer token auth
├── ai/llm.ts                   # Server LLM client (chat/responses/messages)
├── ai/workers-ai.ts            # Workers AI wrapper (models, JSON + streaming)
├── ai/enrich.ts                # Summary + OTP + translation at ingest
├── ai/segments.ts              # HTML/text → translatable segments and back
├── routes/ai.ts                # POST /api/ai/complete (client AI features)
├── utils/filter-rules.ts       # App-only Include/Exclude rule matching
├── routes/emails.ts            # Email CRUD + PATCH + export + send + regenerate
├── routes/devices.ts           # APNs device token registration
├── routes/settings.ts          # User preferences (languages, auto-enrichment)
├── routes/health.ts            # Health check (version + capabilities)
├── database/d1.ts              # All D1 query functions
├── database/settings.ts        # Preferences key/value store
├── handlers/email.ts           # Email Routing handler (parse + store + push)
├── push/apns.ts                # APNs push (ES256 JWT; no-op without APNS_* secrets)
├── providers/                  # Email send providers
│   ├── types.ts                # EmailProvider interface
│   ├── resend.ts               # Resend API provider
│   ├── cloudflare.ts           # Cloudflare Email Service provider
│   └── index.ts                # Provider factory
└── utils/                      # http, helpers, mail processing

rust-cli/                       # Rust CLI
└── main.rs                     # CLI entry (list, export, get, delete, send, health, config)

skills/mailclaw/SKILL.md        # Claude Code skill definition
install.sh                      # Cross-platform CLI install script
.github/workflows/
└── release-cli.yml             # CI: build + publish CLI binaries on tag push
```

## API Endpoints

The full public contract (envelope, capabilities, delta sync, push payload) lives in `API.md` — keep it in sync with any API change. All `/api/emails*` and `/api/devices*` routes require `Authorization: Bearer <token>`.

- `GET /api/emails` — List (metadata only, paginated)
- `GET /api/emails/export` — List with full content (paginated)
- `GET /api/emails/:id` — Single email detail (includes `attachments` metadata)
- `PATCH /api/emails/:id` — Update flags: `read`, `starred`, `archived`, `deleted` (trash/restore)
- `DELETE /api/emails/:id` — Soft delete to Trash; `?permanent=true` hard-deletes (incl. R2 attachments)
- `GET /api/emails/:id/attachments` — List attachment metadata
- `GET /api/emails/:id/attachments/:attachmentId` — Download raw attachment bytes (not the JSON envelope)
- `POST /api/emails/send` — Send email (Resend or Cloudflare provider); persists a `direction=outbound` copy; supports base64 `attachments` (≤25 MiB total)
- `POST /api/emails/:id/summarize` / `POST /api/emails/:id/translate` — Regenerate AI enrichment (optional `{"language"}` override)
- `GET /api/settings` / `PUT /api/settings` — All synced app preferences (languages, AI toggles, signature, templates, identities, `filter_rules`)
- `POST /api/ai/complete` — Generic completion for client AI features (JSON or SSE stream)
- `POST /api/devices` / `DELETE /api/devices/:token` — APNs device token registration
- `GET /api/health` — Health check (no auth); returns `version` + `capabilities`

Inbound emails are enriched at ingest with Workers AI (`AI` binding, no keys): one call returns the summary, any one-time code (`otp`) and whether translation is needed; the push waits up to 8 s for it so OTPs show in the notification ("ChatGPT OTP: 770496"). Translation runs afterwards on text segments only. Emails hidden by the app's `filter_rules` get no AI and no push, but the API/dashboard still return them unfiltered. Enrichment writes bump `updated_at`. Models are overridable via `AI_ANALYSIS_MODEL` / `AI_TRANSLATION_MODEL` / `AI_COMPOSE_MODEL` vars. See API.md.

A daily cron (03:00 UTC) purges Trash older than 30 days. Inbound emails trigger APNs pushes to registered devices when the `APNS_KEY`/`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_TOPIC` secrets are set.

### Filter params (for list + export)

`from`, `to`, `q` (all substring/keyword match), `after`, `before` (date), `limit`, `offset`, `mailbox` (`inbox`/`sent`/`archive`/`trash`/`starred`/`all`; default hides Trash), `updated_after` (delta-sync cursor; includes tombstones, ordered by `updated_at` ASC)

`from`, `to`, and `q` all match by substring (SQL `LIKE %value%`), so `to=me.edu.ge` matches `hi@me.edu.ge` (by domain), and `from=acme` matches any sender containing `acme`.

## CLI

The Rust CLI (`mailclaw`) wraps the REST API. Config is stored in `~/.mailclaw/config.json`.

- `mailclaw config set --host <URL> --api-token <TOKEN>` — Save credentials
- `mailclaw config show` — Show current config
- `mailclaw list` / `export` / `get <id>` / `delete <id>` / `send` / `health` — API operations
- `mailclaw attachments <id>` — List an email's attachments
- `mailclaw download <email_id> <attachment_id> [-o path]` — Download one attachment
- All commands support `--json` for machine-readable output

### Release

Push a tag (`v*`) to trigger `release-cli.yml`, which builds binaries for linux-x86_64, linux-aarch64, macos-x86_64, macos-aarch64, and windows-x86_64, then uploads them to the GitHub Release.
