# Ticket delivery and release workflow

This is the mandatory operating checklist for every roadmap ticket. Root `AGENTS.md` defines the release policy; this document records how to execute and verify it. `docs/staging-preview.md` remains the source of truth for isolated Cloudflare preview configuration.

## Release record

Create a release record in the pull request or ticket notes and fill in every field:

| Evidence | Required value |
| --- | --- |
| Ticket and branch | Exact roadmap ticket and branch |
| Approved commit | Full commit SHA tested in preview |
| Test results | Commands and passing totals |
| D1 migration | Migration filenames, or `none` |
| Staging migration | Result and data/schema verification, or `not required` |
| Preview build | Cloudflare build status, version ID, and preview URL |
| Staging bindings | Worker and D1 database names verified |
| Manual preview | Approver and explicit approval |
| Production migration | Result and data/schema verification, or `not required` |
| Pull request | URL, merged status, and merge commit |
| Production deployment | Successful Cloudflare deployment/version ID |
| Production smoke test | Checks performed and result |
| Local default branch | Updated commit SHA and clean status |

Missing or ambiguous evidence means the gate is still open.

## 1. Pre-ticket gate

Before creating a branch:

1. Read `AGENTS.md`, `docs/ROADMAP.md`, and `docs/staging-preview.md`.
2. Confirm the preceding roadmap ticket and any ticket already in release verification have completed every release gate.
3. Verify the remote default branch (`origin/HEAD`). It is currently `mainи`.
4. Fetch the remote, switch to the default branch, fast-forward only, and verify `git status --short` is empty.
5. Create the exact branch named by the roadmap ticket.

Do not start implementation from another feature branch or from a dirty default branch.

## 2. Implementation and automated verification

Implement only the active ticket. Run at least:

```powershell
npm test
node --check src\index.js
node --check public\app.js
```

Add ticket-specific checks when the changed surface requires them. Record the commands, results, and approved commit SHA.

Inspect `migrations/` and the diff to classify the ticket as either:

- **no migration** — explicitly record `D1 migration: none`; or
- **migration required** — record every migration filename and the schema/data invariants it must preserve.

## 3. Isolated staging preview

Follow `docs/staging-preview.md`. The required invariants are:

- Worker: `wos-event-reminders-staging`;
- D1 database: `wos-event-reminders-staging-db`;
- preview commands include `--env staging` and the explicit staging Worker name;
- the staging and production D1 database IDs differ;
- production Worker deployments and traffic remain unchanged.

If the ticket has a D1 migration, inspect the staging pending-migration list, confirm it contains only expected migrations, then use the repository's staging migration command:

```powershell
npm run db:staging:migrate
```

Verify the resulting staging schema and relevant row counts or data invariants. Never use `db:remote` for a preview.

Push only the ticket branch and open a pull request to the default branch. Confirm Cloudflare reports a successful non-production build, record the immutable version ID and preview URL, and verify bindings. Activate the staging Worker with `npm run deploy:staging` only when end-to-end scheduled-event testing is required; an uploaded preview version does not receive cron traffic.

Provide a ticket-specific manual checklist. Stop before merge and wait for explicit preview approval.

## 4. Production release after approval

Preview approval authorizes the release gates for that approved commit; it does not permit unrelated changes.

1. Re-run tests and confirm the pull request head still equals the approved commit.
2. Inspect current production deployment state and relevant D1 migration state, schema, and data invariants.
3. If a migration is required, inspect the production pending-migration list from the exact approved ticket branch. Confirm it contains only the expected ticket migration or migrations, then run:

   ```powershell
   npm run db:remote
   ```

4. Verify every expected migration is applied and the documented production schema/data invariants still hold. Do not continue after a partial or unexpected migration result.
5. If no migration is required, record `Production D1 migration: not required`.
6. Merge only after explicit user authorization. Verify the pull request's merged status and merge commit through GitHub.
7. Verify Cloudflare completed a successful production deployment of that merge to `wos-event-reminders`. Confirm the deployed source version/commit and production bindings.
8. Run a focused production smoke test covering the new behavior and existing critical behavior. Avoid destructive test data and do not send Discord messages without authorization.
9. Fetch the remote, switch to the default branch, fast-forward only, verify the merge commit is present, and verify a clean worktree.
10. Complete the release record. Only then may the next roadmap branch be created.

## 5. Failure and rollback discipline

- Stop on a failed test, build, migration, deployment, smoke test, or binding mismatch.
- Do not hide a failure by rerunning against a different environment or commit.
- Record the failed evidence and fix it on the same ticket branch when safe.
- A code rollback does not automatically roll back D1. Assess schema and data compatibility before changing production traffic.
- Never delete or rewrite production data as a rollback without an explicit, reviewed recovery plan and user authorization.
