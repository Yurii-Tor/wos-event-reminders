# Project roadmap

This file is the persistent source of truth for ticket order, dependencies, scope, and release readiness. The mandatory workflow is defined in root `AGENTS.md` and `docs/DEPLOYMENT.md`; it must not be replaced by abbreviated ticket notes.

## Sequencing rule

Do not begin a ticket until the preceding ticket has:

1. passed manual preview testing;
2. had every required production D1 migration applied successfully (or explicitly recorded that no migration is required);
3. had its pull request verified as merged;
4. completed a successful production Cloudflare deployment;
5. passed production smoke testing; and
6. been pulled into a clean, updated local default branch.

An already-implemented ticket that is still moving through preview or release verification must finish unchanged before work starts on a newly queued ticket.

## Requested roadmap order

1. `feature/one-time-reminders`
2. `feature/copy-reminders`
3. `feature/history-reminder-type-label`
4. `feature/reminder-archive`

### Transition state

- `feature/one-time-reminders` has completed its production migration, merge, production deployment, smoke test, and clean-local-default-branch gates.
- `feature/reminder-archive` was already implemented before this roadmap update and has completed its production migrations, merge, production deployment, smoke test, and clean-local-default-branch gates. Do not alter or restart that implementation as part of roadmap work.
- `feature/copy-reminders` completed manual preview, merge, production deployment, smoke testing, and clean-local-default-branch gates without a D1 migration.
- `feature/history-reminder-type-label` is the current ticket. Its implementation and staging migration may proceed, but it must stop at manual preview approval before production release.

The requested numbering is retained. Reminder-archive's earlier out-of-order release is recorded as a completed transition and does not change the remaining gate order.

## Ticket: one-time reminders

- **Branch:** `feature/one-time-reminders`
- **Status:** fully released; production migration `0002_one_time_reminders.sql` applied and release gates verified.
- **Dependency for later work:** both recurring and one-time reminder behavior must remain supported.

## Ticket: copy reminders

- **Branch:** `feature/copy-reminders`
- **Status:** fully released. PR #4 merged as `f1e071fbbe983720463254453363eac276e4d782`; production deployment `39c4c358-c9c0-47c9-8a96-ffd5efa50009` and smoke tests passed.
- **Preview commit:** `e684c5ca21909f8e539f853a122c207b7ab865f1`.
- **Automated verification:** 32 tests passed; syntax and diff checks passed.
- **D1 migration:** none required in staging or production.
- **Cloudflare preview:** successful staging build, version `6c31d9f4-8114-46ff-be87-f32a8ef8d5fb`, at `https://feature-copy-reminders-wos-event-reminders-staging.chute-risk9361.workers.dev`.
- **Release gate:** complete; the local default branch was fast-forwarded cleanly before the next ticket began.
- **Dependency (satisfied):** implementation began only after one-time reminders were merged and verified in production and reminder-archive completed all repository delivery gates.
- **Compatibility:** correctly support both recurring and one-time reminders.

### User experience

- Add a `Copy` button to each non-archived reminder in the current schedule.
- Clicking `Copy` opens the existing Add Reminder dialog.
- Populate the dialog with the source reminder's editable settings.
- Clear the reminder ID so Save creates a new reminder instead of updating the original.
- Append the exact suffix `(Copy)` to the source reminder name.
- Append another suffix when the source is already a copy: `Bear Trap` becomes `Bear Trap (Copy)`, and `Bear Trap (Copy)` becomes `Bear Trap (Copy) (Copy)`.
- Respect the 100-character name limit while preserving the complete final `(Copy)` suffix. Truncate only the source-name portion as needed.
- Do not create a reminder when `Copy` is clicked. The user must explicitly press Save.

### State to copy

Copy all editable settings:

- schedule type;
- event date;
- start time;
- recurring interval, when applicable;
- reminder-minutes value;
- Discord message; and
- enabled/disabled state.

Do not copy system-managed state:

- database ID;
- created or updated timestamps;
- delivery history;
- last-sent timestamp;
- completion state;
- failure state; or
- archive state.

### Behavior and constraints

- Save through the normal reminder-creation path and its existing validation.
- Keep the source reminder unchanged and make the saved copy independent.
- Preserve recurring schedule settings for a recurring copy.
- Preserve the schedule of a future one-time reminder.
- For an expired one-time reminder, open the populated dialog but require the user to select a valid future date and time before Save succeeds.
- Do not add a validation bypass for expired copies.
- Do not copy historical deliveries.
- Do not implement archive behavior in this ticket.
- Avoid a dedicated backend copy endpoint unless the existing creation API cannot safely support the workflow.

### Required automated tests

Tests must cover:

- Copy button rendering;
- opening the dialog in copy mode;
- clearing the source ID;
- appending `(Copy)`;
- repeated-copy naming;
- the 100-character maximum while preserving the suffix;
- copying every editable recurring setting;
- copying every editable one-time setting;
- leaving the source reminder unchanged;
- assigning a new ID to the saved copy and giving it no delivery history;
- rejecting an expired one-time copy until its date/time is corrected; and
- existing create and edit behavior remaining unchanged.

### Delivery checklist

1. Verify all predecessor and in-flight release gates are complete.
2. Create `feature/copy-reminders` from a clean, freshly updated default branch.
3. Implement only this ticket and run all tests.
4. Confirm whether the ticket contains a D1 migration; it should preferably require none.
5. Commit and push only this ticket.
6. Create a pull request targeting the repository default branch.
7. Confirm Cloudflare creates a successful non-production preview and record its URL, version, build status, and staging bindings.
8. Provide a manual testing checklist.
9. Stop before merging and wait for explicit preview approval.
10. After approval, execute every release gate in `AGENTS.md` and `docs/DEPLOYMENT.md`.
11. Begin `feature/history-reminder-type-label` only after the copy-reminders pull request, production deployment, migration state, smoke test, and clean local default branch are fully verified.

## Ticket: history reminder type label

- **Branch:** `feature/history-reminder-type-label`
- **Status:** active after copy reminders completed every release gate; stop at manual preview approval.
- **Dependency (satisfied):** implementation began from a clean, freshly updated default branch only after copy reminders was verified in production.
- **D1 migration:** `0005_delivery_schedule_type.sql`; apply to staging for preview and to production only after explicit preview approval.

### Requirements

- Add a `Type` column to Recent deliveries/History.
- Display `Recurring` or `One time` as accessible badges.
- Snapshot the reminder type in each historical delivery record at delivery creation time.
- Do not derive a historical type from the reminder's current state.
- Default all historical records that predate the snapshot column to `recurring`.
- Return the stored type through the deliveries API.
- Preserve delivery history and its type snapshot after reminder archival or permanent deletion.
- Keep this ticket isolated from additional archive behavior.

### Required regression coverage

- The versioned migration adds a constrained, non-null snapshot column with a `recurring` default.
- Existing historical records migrate to `recurring` without data loss.
- Recurring and one-time deliveries store their type at delivery creation.
- A later reminder-type change does not alter the historical snapshot.
- The deliveries API returns the stored type.
- The frontend renders the Type column and accessible labels.
- Permanent reminder deletion retains both delivery history and the stored type.
- Existing one-time, copy, and archive behavior remains passing.

### Delivery checklist

1. Run all tests and syntax checks.
2. Apply only migration `0005_delivery_schedule_type.sql` to isolated staging and verify historical row preservation, defaults, constraints, and archive foreign keys.
3. Commit and push only `feature/history-reminder-type-label`.
4. Create a pull request targeting the repository default branch.
5. Confirm a successful non-production Cloudflare preview and verify its staging bindings.
6. Provide a manual testing checklist and stop before merging.
7. Wait for explicit preview approval before applying `0005` to production or merging.

## Ticket: reminder archive

- **Branch:** `feature/reminder-archive`
- **Status:** fully released before copy-reminders began. Production migrations `0003_reminder_archive.sql` and `0004_preserve_deleted_delivery_history.sql` were applied successfully; deployment and smoke-test gates passed.
- **Transition rule:** do not modify or restart its implementation for later roadmap tickets.
