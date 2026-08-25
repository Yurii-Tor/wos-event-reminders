# Repository delivery rules

These instructions apply to the entire repository. Read this file, [the roadmap](docs/ROADMAP.md), [the deployment workflow](docs/DEPLOYMENT.md), and [the staging preview guide](docs/staging-preview.md) before starting or releasing a roadmap ticket.

## Ticket isolation

- Work on only one roadmap ticket at a time.
- Do not change the scope or implementation of a ticket that is already in preview or release verification merely to prepare a later ticket.
- Create the ticket's exact branch from a clean, freshly fast-forwarded copy of the repository default branch. The current default branch is `mainи`; if it is renamed, use the branch configured as the remote default.
- Keep migrations, application changes, tests, and documentation for one ticket in that ticket's branch and pull request.
- Never begin a ticket until every predecessor gate recorded in `docs/ROADMAP.md` is complete. An in-flight ticket also retains priority until its release gates are complete, even if the roadmap is reprioritized while it is being released.

## Mandatory release workflow

Every ticket must complete these gates in order. A gate is not complete without verifiable evidence.

1. **Clean base:** verify the preceding ticket completed all release gates; switch to the default branch, fast-forward it from `origin`, and verify the worktree is clean.
2. **Implementation:** create the ticket branch, implement only that ticket, and run the complete test suite plus relevant syntax or static checks.
3. **Migration decision:** explicitly record whether the ticket contains a D1 migration. Prefer no migration when the existing schema safely supports the feature.
4. **Preview preparation:** if a migration is required, apply it only to the isolated staging D1 database and verify schema and data before preview testing.
5. **Pull request:** commit and push only the ticket, open a pull request targeting the repository default branch, and verify the expected commits and files.
6. **Cloudflare preview:** confirm a successful non-production build on `wos-event-reminders-staging`, verify its staging bindings and preview URL, and confirm production traffic did not change. Follow `docs/staging-preview.md`.
7. **Manual preview gate:** provide a ticket-specific manual checklist, stop before merge, and wait for explicit user approval of preview testing.
8. **Production migration:** after preview approval, apply any required production D1 migration from the exact approved ticket commit before production code that depends on it is deployed. Verify the migration result and data invariants. If there is no migration, record that explicitly.
9. **Merge verification:** merge only with explicit user authorization, then verify the pull request is merged and the merge commit is present on the remote default branch.
10. **Production deployment:** verify Cloudflare successfully deployed that merge to `wos-event-reminders`. Do not treat a GitHub merge alone as deployment success.
11. **Production smoke test:** exercise the ticket's critical production path and existing critical paths without damaging production data or sending unauthorized Discord messages.
12. **Local synchronization:** switch to the default branch, fast-forward it from `origin`, verify the release commit is present, and leave a clean worktree.

Do not start the next ticket if any gate is failed, unknown, awaiting approval, or lacks evidence.

## Production and secret safety

- Never deploy a feature branch to the production Worker.
- Never apply staging migrations to production or production migrations before the approved release gate.
- Before every remote D1 operation, verify the target database name, environment, pending migration list, and ticket scope.
- Never print, commit, paste into commands, or include in screenshots any webhook URL, dashboard password, session secret, or secret value. Refer only to Cloudflare secret names.
- Use Discord delivery tests only when the user has authorized them and verify the destination is the intended staging or production channel.
- Stop and report discrepancies in branch state, migrations, Cloudflare bindings, deployment state, or production data instead of bypassing a gate.
