import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker, { validateEventInput } from "../src/index.js";
import {
  COPY_SUFFIX,
  MAX_REMINDER_NAME_LENGTH,
  buildCopyName,
  createReminderCopyDraft,
  createReminderDialogState,
} from "../public/reminder-copy.js";

const origin = "https://copy-preview.example.test";
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const copySource = await readFile(new URL("../public/reminder-copy.js", import.meta.url), "utf8");
const migrationPaths = [
  "../migrations/0001_initial.sql",
  "../migrations/0002_one_time_reminders.sql",
  "../migrations/0003_reminder_archive.sql",
  "../migrations/0004_preserve_deleted_delivery_history.sql",
  "../migrations/0005_delivery_schedule_type.sql",
];

test("current non-archived reminders render a Copy button wired to copy mode", () => {
  const scheduleRenderer = appSource.slice(
    appSource.indexOf("function renderEvents()"),
    appSource.indexOf("function renderArchive()"),
  );
  const archiveRenderer = appSource.slice(
    appSource.indexOf("function renderArchive()"),
    appSource.indexOf("function renderDeliveries()"),
  );

  assert.match(scheduleRenderer, /element\("button", "ghost", "Copy"\)/);
  assert.match(scheduleRenderer, /openEventDialog\(event, "copy"\)/);
  assert.match(scheduleRenderer, /actions\.append\(edit, copy, archive\)/);
  assert.doesNotMatch(archiveRenderer, /"Copy"/);
});

test("copy mode clears the source ID and copies every editable recurring setting", () => {
  const source = reminderSource({
    id: 42,
    name: "Bear Trap",
    schedule_type: "recurring",
    anchor_date: "2099-04-05",
    start_time_utc: "18:30",
    interval_days: 4,
    reminder_minutes: 25,
    message: "Recurring message",
    enabled: false,
  });
  const original = structuredClone(source);
  const dialog = createReminderDialogState(source, "copy", Date.parse("2099-01-01T00:00:00Z"));

  assert.equal(dialog.action, "copy");
  assert.equal(dialog.id, "");
  assert.equal(dialog.title, "Copy reminder");
  assert.equal(dialog.saveLabel, "Save copy");
  assert.deepEqual(dialog.values, {
    name: "Bear Trap (Copy)",
    schedule_type: "recurring",
    anchor_date: "2099-04-05",
    start_time_utc: "18:30",
    interval_days: 4,
    reminder_minutes: 25,
    message: "Recurring message",
    enabled: false,
  });
  assert.deepEqual(source, original);
  for (const key of [
    "id", "created_at", "updated_at", "deliveries", "last_sent_at",
    "terminal_status", "completed_at", "failed_at", "archived_at", "archived_reason",
  ]) {
    assert.equal(Object.hasOwn(dialog.values, key), false, `${key} must not be copied`);
  }
});

test("copy names append complete repeated suffixes within the 100-character limit", () => {
  assert.equal(buildCopyName("Bear Trap"), "Bear Trap (Copy)");
  assert.equal(buildCopyName("Bear Trap (Copy)"), "Bear Trap (Copy) (Copy)");

  const fullLengthName = "X".repeat(MAX_REMINDER_NAME_LENGTH);
  const copy = buildCopyName(fullLengthName);
  assert.equal(copy.length, MAX_REMINDER_NAME_LENGTH);
  assert.equal(copy, `${"X".repeat(93)}${COPY_SUFFIX}`);

  const fullLengthExistingCopy = `${"Y".repeat(93)}${COPY_SUFFIX}`;
  const repeatedCopy = buildCopyName(fullLengthExistingCopy);
  assert.equal(repeatedCopy.length, MAX_REMINDER_NAME_LENGTH);
  assert.ok(repeatedCopy.endsWith(`${COPY_SUFFIX}${COPY_SUFFIX}`));
});

test("one-time copy mode preserves editable settings and exposes expired validation", () => {
  const source = reminderSource({
    id: 7,
    name: "Foundry",
    schedule_type: "one_time",
    anchor_date: "2000-01-01",
    start_time_utc: "12:00",
    interval_days: 1,
    reminder_minutes: 15,
    message: "One-time message",
    enabled: true,
    terminal_status: "completed",
    completed_at: "2000-01-01T11:45:05.000Z",
  });
  const nowMs = Date.parse("2026-08-25T12:00:00.000Z");
  const dialog = createReminderDialogState(source, "copy", nowMs);

  assert.deepEqual(dialog.values, {
    name: "Foundry (Copy)",
    schedule_type: "one_time",
    anchor_date: "2000-01-01",
    start_time_utc: "12:00",
    interval_days: 1,
    reminder_minutes: 15,
    message: "One-time message",
    enabled: true,
  });
  assert.match(dialog.guidance, /expired.*future date or time/i);
  assert.throws(
    () => validateEventInput(dialog.values, nowMs),
    /One-time reminder time must be in the future/,
  );

  const corrected = { ...dialog.values, anchor_date: "2099-01-01" };
  assert.doesNotThrow(() => validateEventInput(corrected, nowMs));
});

test("existing add and edit dialog behavior remains unchanged", () => {
  const nowMs = Date.parse("2026-08-25T12:00:00.000Z");
  const added = createReminderDialogState(null, "save", nowMs);
  assert.equal(added.id, "");
  assert.equal(added.title, "Add event");
  assert.equal(added.values.name, "");
  assert.equal(added.values.schedule_type, "recurring");
  assert.equal(added.values.anchor_date, "2026-08-25");
  assert.equal(added.values.enabled, true);

  const source = reminderSource({ id: 33, name: "Edit me", enabled: false });
  const edited = createReminderDialogState(source, "save", nowMs);
  assert.equal(edited.id, 33);
  assert.equal(edited.title, "Edit event");
  assert.equal(edited.values.name, "Edit me");
  assert.equal(edited.values.enabled, false);
});

test("saving a copy uses normal creation, assigns a new ID, and copies no history", async () => {
  const context = await createContext();
  const sourceId = insertEvent(context.database, {
    name: "Recurring source",
    anchorDate: "2099-02-03",
    startTimeUtc: "19:45",
    intervalDays: 5,
    reminderMinutes: 30,
    message: "Source message",
    enabled: 0,
    lastSentAt: "2098-12-31T10:00:00.000Z",
  });
  insertDelivery(context.database, sourceId, "Recurring source");
  const sourceBefore = context.database.prepare("SELECT * FROM events WHERE id = ?").get(sourceId);
  const copyDraft = createReminderCopyDraft({
    ...sourceBefore,
    enabled: Boolean(sourceBefore.enabled),
  });

  const response = await api(context, "/api/reminders", {
    method: "POST",
    body: copyDraft,
  });
  assert.equal(response.status, 201);
  const { id: copyId } = await response.json();
  assert.notEqual(copyId, sourceId);

  const sourceAfter = context.database.prepare("SELECT * FROM events WHERE id = ?").get(sourceId);
  assert.deepEqual(sourceAfter, sourceBefore);
  const copy = context.database.prepare(
    `SELECT id, name, anchor_date, start_time_utc, interval_days, reminder_minutes,
            message, enabled, schedule_type, last_sent_at, terminal_status,
            completed_at, failed_at, archived_at, archived_reason
       FROM events WHERE id = ?`,
  ).get(copyId);
  assert.deepEqual({ ...copy }, {
    id: copyId,
    name: "Recurring source (Copy)",
    anchor_date: "2099-02-03",
    start_time_utc: "19:45",
    interval_days: 5,
    reminder_minutes: 30,
    message: "Source message",
    enabled: 0,
    schedule_type: "recurring",
    last_sent_at: null,
    terminal_status: null,
    completed_at: null,
    failed_at: null,
    archived_at: null,
    archived_reason: null,
  });
  assert.equal(deliveryCount(context.database, sourceId), 1);
  assert.equal(deliveryCount(context.database, copyId), 0);
});

test("normal creation rejects an expired one-time copy until its schedule is corrected", async () => {
  const context = await createContext();
  const expiredSource = reminderSource({
    id: 91,
    name: "Expired source",
    schedule_type: "one_time",
    anchor_date: "2000-01-01",
    start_time_utc: "12:00",
    interval_days: 1,
  });
  const draft = createReminderCopyDraft(expiredSource);

  const rejected = await api(context, "/api/reminders", { method: "POST", body: draft });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /future/);

  const accepted = await api(context, "/api/reminders", {
    method: "POST",
    body: { ...draft, anchor_date: "2099-01-01" },
  });
  assert.equal(accepted.status, 201);
});

test("app cache-busts the copy helper with its current content hash", () => {
  const expectedVersion = createHash("sha256")
    .update(copySource.replace(/\r\n/g, "\n"))
    .digest("hex")
    .slice(0, 12);
  const referencedVersion = appSource.match(
    /from "\.\/reminder-copy\.js\?v=([a-f0-9]+)"/,
  )?.[1];
  assert.equal(referencedVersion, expectedVersion);
});

function reminderSource(overrides = {}) {
  return {
    id: 1,
    name: "Reminder",
    schedule_type: "recurring",
    anchor_date: "2099-01-01",
    start_time_utc: "12:00",
    interval_days: 2,
    reminder_minutes: 10,
    message: "Reminder message",
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    deliveries: [{ id: 5 }],
    last_sent_at: "2026-01-02T00:00:00.000Z",
    terminal_status: null,
    completed_at: null,
    failed_at: null,
    archived_at: null,
    archived_reason: null,
    ...overrides,
  };
}

async function createContext() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const path of migrationPaths) {
    database.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  }
  database.exec("DELETE FROM deliveries; DELETE FROM events;");

  const env = {
    DB: new D1Adapter(database),
    DASHBOARD_PASSWORD: "copy-password",
    SESSION_SECRET: "copy-session-secret",
  };
  const login = await worker.fetch(new Request(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ password: env.DASHBOARD_PASSWORD }),
  }), env);
  assert.equal(login.status, 200);
  return {
    database,
    env,
    cookie: login.headers.get("Set-Cookie").split(";", 1)[0],
  };
}

async function api(context, path, options = {}) {
  return worker.fetch(new Request(`${origin}${path}`, {
    method: options.method || "GET",
    headers: {
      Cookie: context.cookie,
      Origin: origin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }), context.env);
}

function insertEvent(database, overrides = {}) {
  const values = {
    name: "Source fixture",
    scheduleType: "recurring",
    anchorDate: "2099-01-01",
    startTimeUtc: "12:00",
    intervalDays: 2,
    reminderMinutes: 10,
    message: "Source fixture message",
    enabled: 1,
    nextReminderAt: "2099-01-01T11:50:00.000Z",
    lastSentAt: null,
    ...overrides,
  };
  const result = database.prepare(
    `INSERT INTO events
       (name, anchor_date, start_time_utc, interval_days, reminder_minutes,
        message, enabled, next_reminder_at, schedule_type, last_sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.name,
    values.anchorDate,
    values.startTimeUtc,
    values.intervalDays,
    values.reminderMinutes,
    values.message,
    values.enabled,
    values.nextReminderAt,
    values.scheduleType,
    values.lastSentAt,
  );
  return Number(result.lastInsertRowid);
}

function insertDelivery(database, eventId, eventName) {
  database.prepare(
    `INSERT INTO deliveries
       (event_id, event_name, scheduled_for, status, attempts, sent_at)
     VALUES (?, ?, '2099-01-01T11:50:00.000Z', 'sent', 1, '2099-01-01T11:50:00.000Z')`,
  ).run(eventId, eventName);
}

function deliveryCount(database, eventId) {
  return database.prepare(
    "SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?",
  ).get(eventId).count;
}

class D1Adapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

class D1Statement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new D1Statement(this.database, this.sql, args);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return { meta: { changes: result.changes } };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.args) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.args) };
  }
}
