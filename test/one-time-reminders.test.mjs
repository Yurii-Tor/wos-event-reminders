import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  computeOneTimeReminderIso,
  deliverEvent,
  normalizeOverdueEvents,
  validateEventInput,
} from "../src/index.js";
import worker from "../src/index.js";

const ONE_TIME_REMINDER = "2026-09-10T14:50:00.000Z";

function eventFixture(overrides = {}) {
  return {
    id: 7,
    name: "Foundry upgrade",
    interval_days: 2,
    message: "Upgrade starts soon",
    next_reminder_at: ONE_TIME_REMINDER,
    schedule_type: "one_time",
    enabled: 1,
    terminal_status: null,
    completed_at: null,
    failed_at: null,
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    name: "Foundry upgrade",
    schedule_type: "recurring",
    anchor_date: "2026-09-10",
    start_time_utc: "15:00",
    interval_days: 2,
    reminder_minutes: 10,
    message: "Upgrade starts soon",
    enabled: true,
    ...overrides,
  };
}

test("recurring API validation remains backward-compatible", () => {
  const validated = validateEventInput(
    validInput({ schedule_type: undefined }),
    Date.parse("2026-09-01T00:00:00.000Z"),
  );

  assert.equal(validated.schedule_type, "recurring");
  assert.equal(validated.interval_days, 2);
});

test("one-time API validation accepts an exact future UTC occurrence without an interval", () => {
  const validated = validateEventInput(
    validInput({ schedule_type: "one_time", interval_days: undefined }),
    Date.parse("2026-09-01T00:00:00.000Z"),
  );

  assert.equal(validated.schedule_type, "one_time");
  assert.equal(validated.interval_days, 1);
  assert.equal(
    computeOneTimeReminderIso(
      validated.anchor_date,
      validated.start_time_utc,
      validated.reminder_minutes,
      Date.parse("2026-09-01T00:00:00.000Z"),
    ),
    ONE_TIME_REMINDER,
  );
});

test("one-time API validation rejects a reminder time in the past", () => {
  assert.throws(
    () => validateEventInput(
      validInput({ schedule_type: "one_time" }),
      Date.parse("2026-09-10T14:51:00.000Z"),
    ),
    (error) => error.status === 400 && /must be in the future/.test(error.message),
  );
});

test("authenticated API returns 400 for a past one-time reminder", async () => {
  const env = {
    DASHBOARD_PASSWORD: "test-password",
    SESSION_SECRET: "test-session-secret",
  };
  const origin = "https://preview.example.test";
  const loginResponse = await worker.fetch(new Request(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ password: env.DASHBOARD_PASSWORD }),
  }), env);
  const cookie = loginResponse.headers.get("Set-Cookie").split(";", 1)[0];

  const response = await worker.fetch(new Request(`${origin}/api/reminders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify(validInput({
      schedule_type: "one_time",
      anchor_date: "2000-01-01",
    })),
  }), env);

  assert.equal(loginResponse.status, 200);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "One-time reminder time must be in the future",
  });
});

test("successful one-time delivery sends once, completes, and never advances", async (t) => {
  const originalReminder = ONE_TIME_REMINDER;
  const database = new FakeD1(eventFixture());
  let sends = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sends += 1;
    return new Response(null, { status: 204 });
  });

  const env = { DB: database, DISCORD_WEBHOOK_URL: "https://example.test/webhook" };
  await deliverEvent(env, { ...database.event });
  await deliverEvent(env, { ...database.event, enabled: 1 });

  assert.equal(sends, 1);
  assert.equal(database.delivery.status, "sent");
  assert.equal(database.delivery.attempts, 1);
  assert.equal(database.delivery.schedule_type, "one_time");
  assert.equal(database.event.enabled, 0);
  assert.equal(database.event.terminal_status, "completed");
  assert.ok(database.event.completed_at);
  assert.equal(database.event.failed_at, null);
  assert.equal(database.event.next_reminder_at, originalReminder);
});

test("one-time retry exhaustion records terminal failure without rescheduling", async (t) => {
  const database = new FakeD1(eventFixture());
  let sends = 0;
  t.mock.method(globalThis, "fetch", async () => {
    sends += 1;
    return new Response("temporary failure", { status: 503 });
  });

  const env = { DB: database, DISCORD_WEBHOOK_URL: "https://example.test/webhook" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(deliverEvent(env, { ...database.event, enabled: 1 }));
  }
  await deliverEvent(env, { ...database.event, enabled: 1 });

  assert.equal(sends, 3);
  assert.equal(database.delivery.status, "failed");
  assert.equal(database.delivery.attempts, 3);
  assert.equal(database.event.enabled, 0);
  assert.equal(database.event.terminal_status, "failed");
  assert.ok(database.event.failed_at);
  assert.equal(database.event.completed_at, null);
  assert.equal(database.event.next_reminder_at, ONE_TIME_REMINDER);
});

test("overdue normalization advances recurring reminders but leaves one-time reminders unchanged", async () => {
  const oneTime = eventFixture({ next_reminder_at: "2026-08-01T10:00:00.000Z" });
  const recurring = eventFixture({
    id: 8,
    schedule_type: "recurring",
    next_reminder_at: "2026-08-01T10:00:00.000Z",
  });
  const database = new FakeD1(oneTime, [oneTime, recurring]);

  await normalizeOverdueEvents(database.asEnv(), Date.parse("2026-08-05T12:00:00.000Z"));

  assert.equal(database.event.next_reminder_at, "2026-08-01T10:00:00.000Z");
  assert.equal(
    database.normalized.get(recurring.id),
    "2026-08-07T10:00:00.000Z",
  );
  assert.match(database.lastAllSql, /schedule_type = 'recurring'/);
});

test("migration defaults existing rows to recurring and records terminal timestamps", async () => {
  const migration = await readFile(
    new URL("../migrations/0002_one_time_reminders.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /schedule_type TEXT NOT NULL DEFAULT 'recurring'/);
  assert.match(migration, /terminal_status TEXT/);
  assert.match(migration, /completed_at TEXT/);
  assert.match(migration, /failed_at TEXT/);
});

class FakeD1 {
  constructor(event, overdueResults = []) {
    this.event = { ...event };
    this.delivery = null;
    this.overdueResults = overdueResults.map((item) => ({ ...item }));
    this.normalized = new Map();
    this.lastAllSql = "";
  }

  asEnv() {
    return { DB: this };
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async run(sql, args) {
    const compact = sql.replace(/\s+/g, " ");

    if (compact.includes("INSERT OR IGNORE INTO deliveries")) {
      if (!this.delivery) {
        this.delivery = {
          id: 1,
          event_id: args[0],
          event_name: args[1],
          scheduled_for: args[2],
          schedule_type: args[3],
          status: "pending",
          attempts: 0,
          error: null,
          sent_at: null,
        };
      }
      return changes(1);
    }

    if (compact.includes("SET status = 'pending'")) {
      const [attemptedAt, id, expectedAttempts, staleClaimBefore] = args;
      const pendingCanBeClaimed = this.delivery?.status === "pending"
        && (expectedAttempts === 0 || this.delivery.attempted_at < staleClaimBefore);
      const canClaim = this.delivery?.id === id
        && this.delivery.attempts === expectedAttempts
        && (pendingCanBeClaimed || this.delivery.status === "failed");
      if (!canClaim) return changes(0);
      Object.assign(this.delivery, {
        status: "pending",
        attempted_at: attemptedAt,
        attempts: expectedAttempts + 1,
        error: null,
      });
      return changes(1);
    }

    if (compact.includes("UPDATE deliveries") && compact.includes("status = 'sent'")) {
      const [sentAt, attemptedAt, id, attempts] = args;
      if (this.delivery?.id !== id || this.delivery.attempts !== attempts) return changes(0);
      Object.assign(this.delivery, {
        status: "sent",
        sent_at: sentAt,
        attempted_at: attemptedAt,
        error: null,
      });
      return changes(1);
    }

    if (compact.includes("UPDATE deliveries") && compact.includes("status = 'failed'")) {
      const [attemptedAt, error, id, attempts] = args;
      if (this.delivery?.id !== id || this.delivery.attempts !== attempts) return changes(0);
      Object.assign(this.delivery, { status: "failed", attempted_at: attemptedAt, error });
      return changes(1);
    }

    if (compact.includes("terminal_status = 'completed'")) {
      const values = args.length === 4
        ? { last_sent_at: args[0], completed_at: args[1], id: args[2], reminder: args[3] }
        : { completed_at: args[0], id: args[1], reminder: args[2] };
      if (this.event.id !== values.id || this.event.next_reminder_at !== values.reminder) return changes(0);
      Object.assign(this.event, {
        enabled: 0,
        terminal_status: "completed",
        completed_at: values.completed_at,
        failed_at: null,
      });
      if (values.last_sent_at) this.event.last_sent_at = values.last_sent_at;
      return changes(1);
    }

    if (compact.includes("terminal_status = 'failed'")) {
      const [failedAt, id, reminder] = args;
      if (this.event.id !== id || this.event.next_reminder_at !== reminder) return changes(0);
      Object.assign(this.event, {
        enabled: 0,
        terminal_status: "failed",
        failed_at: failedAt,
        completed_at: null,
      });
      return changes(1);
    }

    if (compact.includes("UPDATE events") && compact.includes("next_reminder_at = ?")) {
      const [nextReminder, id, oldReminder] = args.length === 4
        ? [args[1], args[2], args[3]]
        : args;
      if (id === this.event.id && this.event.next_reminder_at === oldReminder) {
        this.event.next_reminder_at = nextReminder;
      } else {
        this.normalized.set(id, nextReminder);
      }
      return changes(1);
    }

    throw new Error(`Unhandled fake D1 run: ${compact}`);
  }

  async first(sql) {
    const compact = sql.replace(/\s+/g, " ");
    if (compact.includes("FROM deliveries")) return this.delivery ? { ...this.delivery } : null;
    throw new Error(`Unhandled fake D1 first: ${compact}`);
  }

  async all(sql) {
    this.lastAllSql = sql.replace(/\s+/g, " ");
    return { results: this.overdueResults.map((item) => ({ ...item })) };
  }
}

class FakeStatement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new FakeStatement(this.database, this.sql, args);
  }

  run() {
    return this.database.run(this.sql, this.args);
  }

  first() {
    return this.database.first(this.sql, this.args);
  }

  all() {
    return this.database.all(this.sql, this.args);
  }
}

function changes(count) {
  return { meta: { changes: count } };
}
