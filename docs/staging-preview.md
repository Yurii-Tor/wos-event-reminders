# Isolated staging previews

The default Wrangler environment is production. Non-production branches must
always use the named `staging` environment, which creates the separate Worker
`wos-event-reminders-staging` and binds the separate D1 database
`wos-event-reminders-staging-db`.

## One-time Cloudflare setup

1. In **Workers & Pages → wos-event-reminders → Settings → Build**, disable
   **Builds for non-production branches**. The production Worker must never
   build feature branches because Workers Builds overrides the Wrangler Worker
   name and would reuse the production secret namespace.

2. In **Workers & Pages → wos-event-reminders-staging → Settings → Build**,
   connect the same Git repository and configure:

   - production branch: the repository default branch;
   - preview builds: enabled;
   - build command: `npm test`;
   - deploy command: `npm run preview:staging`;
   - version command: `npm run preview:staging`.

   The preview command runs:

   ```text
   wrangler versions upload --env staging --name wos-event-reminders-staging
   ```

   The explicit name provides defense in depth if Workers Builds overrides the
   environment-derived Worker name.

3. Enter three staging-only secrets interactively. Use a Discord webhook that
   posts only to a staging/test channel. Never reuse the production webhook or
   paste secret values into source files, Git, build variables, chat, or logs.

   ```powershell
   npx wrangler secret put DASHBOARD_PASSWORD --env staging
   npx wrangler secret put SESSION_SECRET --env staging
   npx wrangler secret put DISCORD_WEBHOOK_URL --env staging
   ```

   The `staging` environment is a separate Worker, so its secrets do not inherit
   from the production Worker.

4. Apply migrations only through the staging-specific command:

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
preview version. This means HTTP testing and scheduled-delivery testing would
otherwise run different Worker code. Before an end-to-end scheduled-delivery
test, verify all three staging secrets and activate the feature code only on the
isolated staging Worker:

```powershell
npm run deploy:staging
```

This command includes both `--env staging` and the explicit staging Worker
name. Never run the default production deploy command for preview testing.

## Safety invariant

The production and staging D1 `database_id` values in `wrangler.jsonc` must be
different. `npm test` enforces this and also checks that every remote staging
command includes `--env staging` and names the staging database explicitly.
