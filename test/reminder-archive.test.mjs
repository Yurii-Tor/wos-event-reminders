import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import worker, { archiveExpiredOneTimeEvents } from "../src/index.js";

const origin = "https://archive-preview.example.test";
const migrationPaths = [
  "../migrations/0001_initial.sql",
  "../migrations/0002_one_time_reminders.sql",
  "../migrations/0003_reminder_archive.sql",
];

test("normal deletion soft-archives a reminder and preserves delivery history", async () => {
  const context = await createContext();
  const eventId = insertEvent(context.database, { name: "Archive me" });
  insertDelivery(context.database, eventId, "Archive me");

  const response = await api(context, `/api/reminders/${eventId}`, { method: "DELETE" });
  assert.equal(response.status, 200);

  const archived = context.database.prepare(
    "SELECT enabled, archived_at, archived_reason FROM events WHERE id = ?",
  ).get(eventId);
  assert.equal(archived.enabled, 0);
  assert.ok(archived.archived_at);
  assert.equal(archived.archived_reason, "manual");
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?").get(eventId).count,
    1,
  );

  const schedule = await (await api(context, "/api/reminders")).json();
  const archive = await (await api(context, "/api/archive")).json();
  assert.equal(schedule.events.some(({ id }) => id === eventId), false);
  assert.equal(archive.events.some(({ id }) => id === eventId), true);
});

test("permanent deletion is restricted to Archive and removes retained history", async () => {
  const context = await createContext();
  const eventId = insertEvent(context.database, { name: "Delete from archive" });
  insertDelivery(context.database, eventId, "Delete from archive");

  const premature = await api(context, `/api/archive/${eventId}`, { method: "DELETE" });
  assert.equal(premature.status, 404);
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?").get(eventId).count,
    1,
  );

  await api(context, `/api/reminders/${eventId}`, { method: "DELETE" });
  const removed = await api(context, `/api/archive/${eventId}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM events WHERE id = ?").get(eventId).count,
    0,
  );
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?").get(eventId).count,
    0,
  );
});

test("expired one-time reminders require a future schedule before restoration", async () => {
  const context = await createContext();
  const eventId = insertEvent(context.database, {
    name: "Expired operation",
    scheduleType: "one_time",
    anchorDate: "2000-01-01",
    startTimeUtc: "12:00",
    nextReminderAt: "2000-01-01T11:50:00.000Z",
    enabled: 0,
    archivedAt: "2000-01-01T12:01:00.000Z",
    archivedReason: "expired",
    terminalStatus: "completed",
    completedAt: "2000-01-01T11:50:10.000Z",
  });
  insertDelivery(context.database, eventId, "Expired operation", "2000-01-01T11:50:00.000Z");

  const expiredResponse = await api(context, `/api/archive/${eventId}`, {
    method: "PUT",
    body: reminderInput({
      name: "Expired operation",
      schedule_type: "one_time",
      anchor_date: "2000-01-01",
      start_time_utc: "12:00",
    }),
  });
  assert.equal(expiredResponse.status, 400);
  assert.ok(context.database.prepare("SELECT archived_at FROM events WHERE id = ?").get(eventId).archived_at);

  const restoredResponse = await api(context, `/api/archive/${eventId}`, {
    method: "PUT",
    body: reminderInput({
      name: "Restored operation",
      schedule_type: "one_time",
      anchor_date: "2099-01-01",
      start_time_utc: "12:00",
    }),
  });
  assert.equal(restoredResponse.status, 200);

  const restored = context.database.prepare(
    `SELECT name, enabled, archived_at, archived_reason, terminal_status,
            completed_at, failed_at, schedule_type
       FROM events WHERE id = ?`,
  ).get(eventId);
  assert.deepEqual({ ...restored }, {
    name: "Restored operation",
    enabled: 1,
    archived_at: null,
    archived_reason: null,
    terminal_status: null,
    completed_at: null,
    failed_at: null,
    schedule_type: "one_time",
  });
  assert.equal(
    context.database.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = ?").get(eventId).count,
    1,
  );
});

test("automatic archive affects only inactive one-time reminders after their event time", async () => {
  const context = await createContext();
  const expired = insertEvent(context.database, {
    name: "Expired inactive",
    scheduleType: "one_time",
    anchorDate: "2026-08-24",
    enabled: 0,
  });
  const stillActive = insertEvent(context.database, {
    name: "Expired active",
    scheduleType: "one_time",
    anchorDate: "2026-08-24",
    enabled: 1,
  });
  const recurring = insertEvent(context.database, {
    name: "Inactive recurring",
    scheduleType: "recurring",
    anchorDate: "2026-08-24",
    enabled: 0,
  });
  const future = insertEvent(context.database, {
    name: "Future inactive",
    scheduleType: "one_time",
    anchorDate: "2026-08-26",
    enabled: 0,
  });

  const result = await archiveExpiredOneTimeEvents(
    context.env,
    Date.parse("2026-08-25T12:00:00.000Z"),
  );
  assert.equal(result.meta.changes, 1);
  assert.equal(context.database.prepare("SELECT archived_reason FROM events WHERE id = ?").get(expired).archived_reason, "expired");
  for (const id of [stillActive, recurring, future]) {
    assert.equal(context.database.prepare("SELECT archived_at FROM events WHERE id = ?").get(id).archived_at, null);
  }
});

test("archive migration is backward-compatible and indexed", async () => {
  const migration = await readFile(
    new URL("../migrations/0003_reminder_archive.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN archived_at TEXT/);
  assert.match(migration, /ADD COLUMN archived_reason TEXT/);
  assert.match(migration, /'manual', 'expired'/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_events_archive/);
});

async function createContext() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const path of migrationPaths) {
    database.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  }
  database.exec("DELETE FROM deliveries; DELETE FROM events;");

  const env = {
    DB: new D1Adapter(database),
    DASHBOARD_PASSWORD: "archive-password",
    SESSION_SECRET: "archive-session-secret",
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

function reminderInput(overrides = {}) {
  return {
    name: "Reminder",
    schedule_type: "recurring",
    anchor_date: "2099-01-01",
    start_time_utc: "12:00",
    interval_days: 2,
    reminder_minutes: 10,
    message: "Reminder message",
    enabled: true,
    ...overrides,
  };
}

function insertEvent(database, overrides = {}) {
  const values = {
    name: "Archive fixture",
    scheduleType: "recurring",
    anchorDate: "2099-01-01",
    startTimeUtc: "12:00",
    intervalDays: 2,
    reminderMinutes: 10,
    message: "Archive fixture message",
    enabled: 1,
    nextReminderAt: "2099-01-01T11:50:00.000Z",
    terminalStatus: null,
    completedAt: null,
    failedAt: null,
    archivedAt: null,
    archivedReason: null,
    ...overrides,
  };
  const result = database.prepare(
    `INSERT INTO events
       (name, anchor_date, start_time_utc, interval_days, reminder_minutes,
        message, enabled, next_reminder_at, schedule_type, terminal_status,
        completed_at, failed_at, archived_at, archived_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    values.terminalStatus,
    values.completedAt,
    values.failedAt,
    values.archivedAt,
    values.archivedReason,
  );
  return Number(result.lastInsertRowid);
}

function insertDelivery(database, eventId, eventName, scheduledFor = "2099-01-01T11:50:00.000Z") {
  database.prepare(
    `INSERT INTO deliveries
       (event_id, event_name, scheduled_for, status, attempts, sent_at)
     VALUES (?, ?, ?, 'sent', 1, ?)`,
  ).run(eventId, eventName, scheduledFor, scheduledFor);
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
