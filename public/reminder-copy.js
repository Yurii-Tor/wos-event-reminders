export const COPY_SUFFIX = " (Copy)";
export const MAX_REMINDER_NAME_LENGTH = 100;

export function buildCopyName(sourceName) {
  const name = typeof sourceName === "string" ? sourceName.trim() : "";
  let baseName = name;
  let existingCopyCount = 0;

  while (baseName.endsWith(COPY_SUFFIX)) {
    existingCopyCount += 1;
    baseName = baseName.slice(0, -COPY_SUFFIX.length).trimEnd();
  }

  const maxCopyCount = Math.floor(MAX_REMINDER_NAME_LENGTH / COPY_SUFFIX.length);
  const copyCount = Math.min(existingCopyCount + 1, maxCopyCount);
  const suffixes = COPY_SUFFIX.repeat(copyCount);
  const availableBaseLength = MAX_REMINDER_NAME_LENGTH - suffixes.length;

  return `${baseName.slice(0, availableBaseLength).trimEnd()}${suffixes}`;
}

export function createReminderCopyDraft(source) {
  return {
    name: buildCopyName(source?.name),
    schedule_type: source?.schedule_type ?? "recurring",
    anchor_date: source?.anchor_date ?? "",
    start_time_utc: source?.start_time_utc ?? "15:00",
    interval_days: source?.interval_days ?? 2,
    reminder_minutes: source?.reminder_minutes ?? 10,
    message: source?.message ?? "",
    enabled: source?.enabled ?? true,
  };
}

export function createReminderDialogState(event = null, action = "save", nowMs = Date.now()) {
  const restoring = action === "restore";
  const copying = action === "copy";
  const values = copying ? createReminderCopyDraft(event) : {
    name: event?.name ?? "",
    schedule_type: event?.schedule_type ?? "recurring",
    anchor_date: event?.anchor_date ?? new Date(nowMs).toISOString().slice(0, 10),
    start_time_utc: event?.start_time_utc ?? "15:00",
    interval_days: event?.interval_days ?? 2,
    reminder_minutes: event?.reminder_minutes ?? 10,
    message: event?.message ?? "",
    enabled: restoring ? true : event?.enabled ?? true,
  };
  const occurrenceExpired = values.schedule_type === "one_time"
    && Date.parse(`${values.anchor_date}T${values.start_time_utc}:00.000Z`) <= nowMs;

  return {
    action,
    id: copying ? "" : event?.id ?? "",
    title: restoring
      ? "Restore reminder"
      : copying
        ? "Copy reminder"
        : event ? "Edit event" : "Add event",
    saveLabel: restoring ? "Restore reminder" : copying ? "Save copy" : "Save event",
    guidance: restoring && occurrenceExpired
      ? "This one-time occurrence has expired. Choose a future date or time before restoring it."
      : copying && occurrenceExpired
        ? "This one-time occurrence has expired. Choose a future date or time before saving the copy."
        : restoring
          ? "Review the schedule settings before restoring this reminder."
          : "",
    values,
  };
}
