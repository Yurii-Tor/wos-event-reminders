# Isolated staging previews

The default Wrangler environment is production. Non-production branches must
always use the named `staging` environment, which creates the separate Worker
`wos-event-reminders-staging` and binds the separate D1 database
`wos-event-reminders-staging-db`.

## One-time Cloudflare setup

1. In **Workers & Pages → wos-event-reminders → Settings → Build**, set the
   **Non-production branch deploy command** to:

   ```text
   npm run preview:staging
   ```

   This runs `wrangler versions upload --env staging --name
   wos-event-reminders-staging`. The explicit name prevents Workers Builds from
   overriding the environment-derived Worker name. Keep the production deploy
   command unchanged.

2. Enter three staging-only secrets interactively. Use a Discord webhook that
   posts only to a staging/test channel. Never reuse the production webhook or
   paste secret values into source files, Git, build variables, chat, or logs.

   ```powershell
   npx wrangler secret put DASHBOARD_PASSWORD --env staging
   npx wrangler secret put SESSION_SECRET --env staging
   npx wrangler secret put DISCORD_WEBHOOK_URL --env staging
   ```

   The `staging` environment is a separate Worker, so its secrets do not inherit
   from the production Worker.

3. Apply migrations only through the staging-specific command:

   ```powershell
   npm run db:staging:migrate
   ```

## Preview verification

After pushing a non-production branch:

1. Confirm the Cloudflare build command contains `--env staging`.
2. Open the generated preview URL and confirm its Worker name contains
   `wos-event-reminders-staging`.
3. Run `npx wrangler versions view <VERSION_ID> --name wos-event-reminders-staging`
   and confirm `env.DB` is bound to
   `wos-event-reminders-staging-db`, not `wos-event-reminders-db`.
4. Confirm the staging database contains only staging seed/test data.
5. Sign in with the staging dashboard password.
6. If Discord delivery is being tested, confirm messages appear only in the
   staging/test channel.
7. Recheck `npx wrangler deployments list --name wos-event-reminders` and
   confirm production traffic did not change.

`wrangler versions upload` creates an HTTP preview but does not promote it to
an active deployment, so scheduled cron events do not run automatically on the
preview version. If an end-to-end scheduled-delivery test is required, first
verify all three staging secrets, then explicitly deploy only the isolated
environment with `npx wrangler deploy --env staging`. Never run that command
without the `--env staging` flag.

## Safety invariant

The production and staging D1 `database_id` values in `wrangler.jsonc` must be
different. `npm test` enforces this and also checks that every remote staging
command includes `--env staging` and names the staging database explicitly.
