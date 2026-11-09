# MailClaw API Contract

The public REST API contract between a MailClaw server and its clients (iOS app, Rust CLI, dashboard, or anything else). Because MailClaw is self-hosted, old and new servers coexist in the wild — clients MUST negotiate features via `/api/health` capabilities instead of assuming them.

**Versioning rule:** within a major version, changes are additive only (new endpoints, new optional fields, new capabilities). Breaking changes bump the major version. Clients declare a minimum supported server version and should prompt the user to upgrade their deployment when the server is older.

Current server version: **2.1.0**.

## Conventions

- Base URL: the deployment's Workers URL (e.g. `https://mailclaw.example.com`).
- Auth: `Authorization: Bearer <API_TOKEN>` on everything under `/api/emails` and `/api/devices`. `/api/health` is unauthenticated.
- Envelope: JSON responses are `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`. The attachment download endpoint returns raw bytes instead.
- Timestamps are Unix seconds unless noted (`/api/health` `timestamp` is milliseconds).
- Booleans in email rows (`read`, `starred`, `archived`, `has_attachments`) are JSON booleans.

## GET /api/health

```json
{
	"success": true,
	"data": {
		"status": "ok",
		"timestamp": 1753900000000,
		"version": "2.0.0",
		"capabilities": [
			"read-state", "threads", "sent-storage", "soft-delete",
			"delta-sync", "send-attachments", "devices", "settings",
			"push", "server-ai", "otp", "server-compose", "filter-rules"
		]
	}
}
```

`push` is present only when the server has its APNs secrets configured. `server-ai`, `otp` and `server-compose` are present only when the Workers AI binding is configured. Servers older than 2.0.0 return neither `version` nor `capabilities` — clients must treat both as absent and fall back to the 1.x feature set (list/export/get/delete/send/attachments only).

## Email object

```json
{
	"id": "cuid",
	"from_address": "Alice <alice@example.com>",
	"to_address": "me@uid.si",
	"subject": "Hello",
	"received_at": 1753900000,
	"html_content": "<p>…</p>",
	"text_content": "…",
	"has_attachments": false,
	"attachment_count": 0,
	"direction": "inbound",
	"message_id": "<abc@example.com>",
	"in_reply_to": null,
	"references_header": null,
	"read": false,
	"starred": false,
	"archived": false,
	"deleted_at": null,
	"updated_at": 1753900000,
	"summary": "…",
	"summary_lang": "简体中文",
	"translation": "…",
	"translation_lang": "简体中文",
	"otp": null,
	"attachments": [ { "id", "email_id", "filename", "mime_type", "size", "created_at" } ]
}
```

- List endpoints omit `html_content` / `text_content`; `attachments` appears only on the detail endpoint.
- `direction` is `inbound` (received) or `outbound` (sent via the API and persisted).
- `message_id` / `in_reply_to` / `references_header` are the RFC 5322 threading headers; for outbound rows `message_id` holds the provider's message id. Clients build conversation threads by chaining these.
- `deleted_at` non-null means the email is in Trash.
- `summary` / `translation` (capability `server-ai`) are generated on the server by Workers AI when the email arrives, using the languages from `/api/settings`. They are `null` until enrichment finishes (summary ~2–3 s after receipt, translation later) and stay `null` on servers without AI, or for emails hidden by the app's filter rules — clients should treat them as optional. `translation` is `"SKIP"` when the email is already in the target language. Writing them bumps `updated_at`, so delta-sync clients pick them up on their next sync.
- `otp` (capability `otp`) is the one-time code (verification / sign-in / 2FA) the AI found in the email, copied exactly (letters and case preserved, spaces removed), or `null`. When present, `summary` is `"<Service> OTP: <code>"` (e.g. `"ChatGPT OTP: 770496"`).

## GET /api/emails · GET /api/emails/export

List emails — metadata only (`/api/emails`) or with full bodies (`/export`). Response: `{ emails, total, limit, offset }`.

Query parameters (all optional):

| Param | Meaning |
|---|---|
| `from`, `to`, `q` | Substring match (SQL `LIKE %v%`); `q` searches subject + text body |
| `after`, `before` | `received_at` range; Unix seconds or ISO 8601 |
| `limit`, `offset` | Pagination; limit 1–100, default 20 |
| `mailbox` | `inbox` \| `sent` \| `archive` \| `trash` \| `starred` \| `all` |
| `updated_after` | Delta-sync cursor (see below) |

Mailbox semantics: `inbox` = inbound, not archived, not deleted; `sent` = outbound, not deleted; `archive` / `starred` = flag set, not deleted; `trash` = deleted only; `all` = everything. **Default (no `mailbox`)**: everything except Trash — this preserves 1.x behavior for old clients.

### Delta sync

`updated_after=<cursor>` returns rows with `updated_at > cursor`, ordered by `updated_at` **ascending**, *including* soft-deleted rows (tombstones — check `deleted_at`). Page until fewer than `limit` rows return; the last row's `updated_at` is the next cursor. Every mutation (receipt, flag change, trash/restore) bumps `updated_at`, so one cursor per account captures all changes. Purged Trash rows (30 days) disappear without a tombstone — clients that synced within 30 days have already seen the deletion.

## GET /api/emails/:id

Full email including `attachments` metadata. 404 if unknown.

## PATCH /api/emails/:id

Capability: `read-state` (and `soft-delete` for `deleted`). Body: any subset of

```json
{ "read": true, "starred": false, "archived": false, "deleted": false }
```

`deleted: true` moves to Trash, `deleted: false` restores. Returns the updated email object. `400` if no known field is present or a value isn't boolean.

## DELETE /api/emails/:id

- Default: **soft delete** — moves to Trash (idempotent; deleting a trashed email returns success). Trash is purged by a daily server cron after 30 days, including R2 attachments.
- `?permanent=true`: hard delete — removes the row and its R2 attachments immediately.

## GET /api/emails/:id/attachments · GET /api/emails/:id/attachments/:attachmentId

Attachment metadata list, and raw content download (binary body with `Content-Type` / `Content-Disposition`, not the JSON envelope).

## POST /api/emails/send

```json
{
	"from": "Vincent Yang <me@uid.si>",
	"to": ["alice@example.com"],
	"subject": "Re: Hello",
	"html": "<p>…</p>",
	"text": "…",
	"cc": [], "bcc": [], "reply_to": [],
	"headers": { "In-Reply-To": "<abc@example.com>", "References": "<abc@example.com>" },
	"attachments": [
		{
			"filename": "invoice.pdf",
			"type": "application/pdf",
			"content": "<base64>",
			"disposition": "attachment",
			"content_id": null
		}
	]
}
```

- `from` accepts RFC 5322 name-addr; the display name is passed to the provider unmodified.
- `headers` sets threading headers on replies. Note: the Cloudflare provider allows only whitelisted headers (`In-Reply-To` and `References` are whitelisted).
- `attachments` (capability `send-attachments`): base64 `content`; `disposition: "inline"` + `content_id` for `cid:` images. Total decoded size ≤ 25 MiB (`CONTENT_TOO_LARGE` otherwise). Invalid base64 → `INVALID_ATTACHMENT`.
- At least one of `html` / `text` is required.

Response (capability `sent-storage` adds `email_id`, the persisted Sent row):

```json
{ "success": true, "data": { "id": "<provider-id>", "provider": "cloudflare", "email_id": "cuid" } }
```

If persisting the Sent copy fails, the send still succeeds and `email_id` is absent.

## GET /api/settings · PUT /api/settings

Capability: `settings`. Every non-secret app preference lives here so a new device inherits it (API tokens never do):

```json
{
	"summary_language": "简体中文",
	"translation_language": "简体中文",
	"primary_language": "简体中文",
	"auto_summarize": true,
	"auto_translate": false,
	"otp_detection": true,
	"show_translation": true,
	"signature": "",
	"compose_rules": "",
	"templates": [{ "name": "…", "to": "…", "subject": "…", "body": "…" }],
	"identities": [{ "display_name": "Vincent Yang", "address": "me@uid.si" }],
	"default_identity": "me@uid.si",
	"filter_rules": [{ "mode": "exclude", "field": "from", "pattern": "maggie@uid.si" }]
}
```

`PUT` accepts any subset and returns the merged result. Unknown keys are ignored (so newer clients can talk to older servers); a known key with an invalid value is `400 INVALID_SETTINGS`. `templates` and `identities` items may carry extra client-defined fields.

### Filter rules (capability `filter-rules`)

`filter_rules` are **app-only** Include/Exclude rules. They never filter the REST API or the web dashboard. Each rule matches `from_address` or `to_address` (`field`) against `pattern`, case-insensitively:

- `user@example.com` — that exact address;
- `@example.com` or `example.com` — that domain and its subdomains (`bounce@mail.example.com`).

An inbound email is **hidden in the app** when any `exclude` rule matches it, or when at least one `include` rule exists and none matches. Clients hide such emails locally using exactly this logic (so rule changes apply to existing mail immediately). On the server, an email that is hidden at arrival gets no AI enrichment and no push. If a rule change later reveals it, clients can fill in the summary with `POST /api/emails/:id/summarize`.

## POST /api/emails/:id/summarize · POST /api/emails/:id/translate

Capability: `server-ai`. Regenerates the summary or translation for one email — after a language change, when the user asks for a redo, or for an email that was hidden by a filter rule when it arrived. Optional body `{"language": "日本語"}` overrides the stored preference for this call (and is what gets persisted with the result).

Returns `{"summary", "summary_lang", "otp"}` or `{"translation", "translation_lang"}`. `501 AI_NOT_CONFIGURED` without the Workers AI binding; `502 AI_FAILED` when the model call fails.

## POST /api/ai/complete

Capability: `server-compose`. A generic completion for client-side AI features (drafting, polishing, tone changes, subject suggestions). Clients own the prompts; the server owns the model, so no client needs an LLM key.

```json
{
	"system": "optional system prompt",
	"messages": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
	"stream": true,
	"max_tokens": 4096
}
```

- `stream: false` (default) → `{"success": true, "data": {"text": "…"}}`.
- `stream: true` → `text/event-stream` of `data: {"delta":"…"}` frames, ending with `data: [DONE]`.

### Server-side AI configuration

AI runs on [Workers AI](https://developers.cloudflare.com/workers-ai/) through the `ai` binding in `wrangler.jsonc` — no API keys; usage is billed to the Cloudflare account that owns the Worker. Default models:

| Task | Default model | Override var |
|---|---|---|
| Summary + OTP (gates the push) | `@cf/google/gemma-4-26b-a4b-it` | `AI_ANALYSIS_MODEL` |
| Translation | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | `AI_TRANSLATION_MODEL` |
| `/api/ai/complete` | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | `AI_COMPOSE_MODEL` |

Override with plain `vars` in `wrangler.jsonc` when Cloudflare retires a model. Translation sends only the email's text to the model (markup, CSS and links are kept verbatim and restored afterwards), capped at 40,000 characters per email.

## POST /api/devices

Capability: `devices`. Registers (or refreshes — upsert by token) an APNs device token:

```json
{ "token": "<hex device token>", "platform": "ios", "environment": "production" }
```

`environment` is `production` (default) or `sandbox` (Xcode development builds; routes pushes through `api.sandbox.push.apple.com`). Re-register on every app launch — registration also bumps `last_seen_at`.

## DELETE /api/devices/:token

Unregisters a device token. 404 if unknown.

## Push notifications

Capability: `push`. When configured (secrets `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`), the server pushes to every registered device on each inbound email:

```json
{
	"aps": {
		"alert": { "title": "<from_address>", "body": "<subject, or \"<Service> OTP: <code>\">" },
		"sound": "default",
		"mutable-content": 1,
		"thread-id": "<from_address>"
	},
	"email_id": "cuid",
	"from": "…", "to": "…", "subject": "…",
	"otp": "770496"
}
```

The push waits up to 8 s for AI analysis so a one-time code can lead the notification (`otp` is `null` when there is none or analysis timed out). Emails hidden by the app's filter rules are not pushed.

Clients deep-link `email_id` to the message (fetch via `GET /api/emails/:id` if not yet synced). Stale tokens (APNs 410 / `BadDeviceToken` / `Unregistered`) are removed automatically.

## Error codes

`NOT_FOUND`, `INVALID_BODY`, `INVALID_SETTINGS`, `AI_NOT_CONFIGURED`, `AI_FAILED`, `MISSING_FIELDS`, `MISSING_CONTENT`, `INVALID_FIELD`, `INVALID_ATTACHMENT`, `CONTENT_TOO_LARGE`, `SEND_FAILED`, `D1_ERROR`, `INTERNAL_ERROR`, plus `UNAUTHORIZED` (401) from auth. HTTP status mirrors the class of error (400/401/404/500).

## Upgrading an older deployment

Run only the migrations newer than your current version (2.0.x → from v3, 2.1.x → v4 only):

```sh
bun run db:upgrade      # one-time: sql/upgrade-v2.sql (ALTERs + devices table)
bun run db:upgrade-v3   # one-time: sql/upgrade-v3.sql (AI columns + settings table)
bun run db:upgrade-v4   # one-time: sql/upgrade-v4.sql (otp column)
bun run db:indexes      # idempotent: new indexes
bun run deploy
```

Fresh installs: `bun run db:tables && bun run db:indexes` as before (schema.sql already includes everything).
