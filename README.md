# State 3607 Discord Event Reminders

A standalone Cloudflare Worker with:

- a shared-password dashboard;
- D1-backed event creation, editing and deletion;
- one UTC Cron Trigger running every minute;
- Discord webhook delivery with retry history;
- Bear Trap 1 and Bear Trap 2 preconfigured every 48 hours from 24 August 2026;
- no Discord role mentions.

This Worker and database are separate from existing Cloudflare Pages projects such as Unity Addressables hosting.

## Prerequisites

- Node.js installed.
- A Cloudflare account.
- A replacement Discord webhook URL. Delete the webhook URL that was previously exposed in chat.

## Deploy from PowerShell

### 1. Install and authenticate

```powershell
cd C:\path\to\wos-event-reminders
npm install
npx wrangler login
```

### 2. Create the separate D1 database

```powershell
npx wrangler d1 create wos-event-reminders-db
```

Wrangler prints a `database_id`. Open `wrangler.jsonc` and replace:

```text
REPLACE_WITH_DATABASE_ID
```

with that ID. Keep the quotation marks.

### 3. Create the tables and initial events

```powershell
npx wrangler d1 migrations apply wos-event-reminders-db --remote
```

Confirm with `y` if Wrangler asks permission to apply the migration.

### 4. Prepare the three deployment secrets

Generate a random session-signing secret:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the generated output. Create a local file named `.env.production` in the project directory with these three lines:

```dotenv
DISCORD_WEBHOOK_URL="PASTE_THE_NEW_REPLACEMENT_WEBHOOK_URL"
DASHBOARD_PASSWORD="CHOOSE_A_STRONG_SHARED_PASSWORD"
SESSION_SECRET="PASTE_THE_GENERATED_RANDOM_VALUE"
```

Do not use the webhook URL that was exposed in chat. `.env.production` is excluded by `.gitignore`.

Remove the temporary PowerShell variables:

```powershell
Remove-Variable bytes, rng
```

### 5. Deploy with the secrets encrypted at Cloudflare

```powershell
npx wrangler deploy --secrets-file .env.production
```

After deployment succeeds, delete the local secrets file:

```powershell
Remove-Item .env.production
```

Wrangler prints a URL similar to:

```text
https://wos-event-reminders.YOUR-SUBDOMAIN.workers.dev
```

Open it and sign in with the shared password. Use **Send test** to verify the replacement webhook.

Cron Trigger changes can require several minutes to propagate. The Worker automatically advances old seeded dates to the next valid 48-hour occurrence and never intentionally sends an event that is more than five minutes late.

## Updating the application

Edit the source and deploy again:

```powershell
npx wrangler deploy
```

The D1 data and encrypted secrets remain attached to the Worker.

## Isolated non-production previews

Feature branches must use the named `staging` environment. It creates the
separate `wos-event-reminders-staging` Worker and binds only the separate
`wos-event-reminders-staging-db` D1 database. Before testing a feature branch,
follow [docs/staging-preview.md](docs/staging-preview.md). Do not use the
default `wrangler versions upload` command for branch previews because the
default environment is bound to production resources.

## Security

- Do not place the Discord webhook URL, dashboard password or session secret in `wrangler.jsonc`, source code, Git or screenshots.
- Anyone with the shared password can add, edit and delete events.
- Change the shared password with `npx wrangler secret put DASHBOARD_PASSWORD` if it is disclosed.
- Sessions expire after eight hours.

## Local checks

```powershell
npm test
node --check src\index.js
node --check public\app.js
```

For local D1 development:

```powershell
npx wrangler d1 migrations apply wos-event-reminders-db --local
npx wrangler dev --test-scheduled
```

Local secrets belong in an uncommitted `.dev.vars` file. Production secrets must use `wrangler secret put`.
