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
- `feature/copy-reminders` was created only after those release gates completed. It is now the current ticket at its manual preview gate. Do not modify its approved preview commit or begin its production release without explicit preview approval.
- `feature/history-reminder-type-label` is queued after copy-reminders and may begin only after copy-reminders completes every release gate.

The requested numbering is retained. Reminder-archive's earlier out-of-order release is recorded as a completed transition and does not change the remaining gate order.

## Ticket: one-time reminders

- **Branch:** `feature/one-time-reminders`
- **Status:** fully released; production migration `0002_one_time_reminders.sql` applied and release gates verified.
- **Dependency for later work:** both recurring and one-time reminder behavior must remain supported.

## Ticket: copy reminders

- **Branch:** `feature/copy-reminders`
- **Status:** implementation complete and stopped at the manual preview gate. PR #4 remains open and unmerged.
- **Preview commit:** `e684c5ca21909f8e539f853a122c207b7ab865f1`.
- **Automated verification:** 32 tests passed; syntax and diff checks passed.
- **D1 migration:** none.
- **Cloudflare preview:** successful staging build, version `6c31d9f4-8114-46ff-be87-f32a8ef8d5fb`, at `https://feature-copy-reminders-wos-event-reminders-staging.chute-risk9361.workers.dev`.
- **Next gate:** explicit manual preview approval. Do not merge or deploy production before approval.
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
- **Status:** queued after copy reminders.
- **Dependency:** do not begin until copy reminders completes every release gate.
- **Scope:** define the detailed acceptance criteria before implementation; do not infer or bundle archive behavior into this ticket.

## Ticket: reminder archive

- **Branch:** `feature/reminder-archive`
- **Status:** fully released before copy-reminders began. Production migrations `0003_reminder_archive.sql` and `0004_preserve_deleted_delivery_history.sql` were applied successfully; deployment and smoke-test gates passed.
- **Transition rule:** do not modify or restart its implementation for later roadmap tickets.
