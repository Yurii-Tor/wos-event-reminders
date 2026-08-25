const SESSION_COOKIE = "wos_session";
const SESSION_SECONDS = 8 * 60 * 60;
const DELIVERY_GRACE_MS = 5 * 60 * 1000;
const DELIVERY_CLAIM_LEASE_MS = 5 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const REMINDERS_API_PATH = "/api/reminders";
const LEGACY_EVENTS_API_PATH = "/api/events";

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await login(request, env);
      }

      if (!(await isAuthenticated(request, env))) {
        return json({ error: "Authentication required" }, 401);
      }

      if (isMutation(request.method) && !hasValidOrigin(request)) {
        return json({ error: "Invalid request origin" }, 403);
      }

      if (url.pathname === "/api/session" && request.method === "GET") {
        return json({ authenticated: true });
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        return json(
          { ok: true },
          200,
          { "Set-Cookie": expiredSessionCookie() },
        );
      }

      const reminderRoute = matchReminderApiPath(url.pathname);

      if (reminderRoute?.id === null && request.method === "GET") {
        await normalizeOverdueEvents(env, Date.now());
        return await listEvents(env);
      }

      if (reminderRoute?.id === null && request.method === "POST") {
        return await createEvent(request, env);
      }

      if (reminderRoute && reminderRoute.id !== null && request.method === "PUT") {
        return await updateEvent(request, env, reminderRoute.id);
      }
      if (reminderRoute && reminderRoute.id !== null && request.method === "DELETE") {
        return await deleteEvent(env, reminderRoute.id);
      }

      if (url.pathname === "/api/deliveries" && request.method === "GET") {
        return await listDeliveries(env);
      }

      if (url.pathname === "/api/send-test" && request.method === "POST") {
        await sendDiscordMessage(
          env,
          "🧪 Discord reminder test — webhook connected successfully.",
        );
        return json({ ok: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const isRequestError = error instanceof RequestError;
      if (!isRequestError) console.error(error);
      const status = isRequestError ? error.status : 500;
      return json({ error: publicError(error) }, status);
    }
  },

  async scheduled(controller, env) {
    await processDueEvents(env, controller.scheduledTime || Date.now());
  },
};

export function matchReminderApiPath(pathname) {
  if (pathname === REMINDERS_API_PATH || pathname === LEGACY_EVENTS_API_PATH) {
    return { id: null };
  }

  const match = pathname.match(/^\/api\/(?:reminders|events)\/(\d+)$/);
  return match ? { id: Number(match[1]) } : null;
}

async function login(request, env) {
  if (!hasValidOrigin(request)) {
    return json({ error: "Invalid request origin" }, 403);
  }

  const body = await readJson(request);
  const password = typeof body.password === "string" ? body.password : "";
  if (!env.DASHBOARD_PASSWORD || !safeEqual(password, env.DASHBOARD_PASSWORD)) {
    return json({ error: "Incorrect password" }, 401);
  }
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt }));
  const signature = await hmac(payload, env.SESSION_SECRET);
  const token = `${payload}.${signature}`;

  return json(
    { ok: true },
    200,
    { "Set-Cookie": sessionCookie(token) },
  );
}

async function isAuthenticated(request, env) {
  if (!env.SESSION_SECRET) return false;
  const token = readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return false;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;

  const expected = await hmac(payload, env.SESSION_SECRET);
  if (!safeEqual(signature, expected)) return false;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    return Number.isFinite(parsed.exp) && parsed.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

async function listEvents(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, anchor_date, start_time_utc, interval_days,
            reminder_minutes, message, enabled, next_reminder_at, schedule_type,
            terminal_status, completed_at, failed_at, last_sent_at,
            created_at, updated_at
       FROM events
      ORDER BY enabled DESC, next_reminder_at ASC`,
  ).all();

  const events = results.map((event) => ({
    ...event,
    enabled: Boolean(event.enabled),
    next_start_at: new Date(
      Date.parse(event.next_reminder_at) + event.reminder_minutes * 60_000,
    ).toISOString(),
  }));
  return json({ events });
}

async function createEvent(request, env) {
  const input = validateEventInput(await readJson(request));
  const nextReminder = computeReminderForSchedule(input, Date.now());

  const result = await env.DB.prepare(
    `INSERT INTO events
       (name, anchor_date, start_time_utc, interval_days, reminder_minutes,
        message, enabled, next_reminder_at, schedule_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
  )
    .bind(
      input.name,
      input.anchor_date,
      input.start_time_utc,
      input.interval_days,
      input.reminder_minutes,
      input.message,
      input.enabled ? 1 : 0,
      nextReminder,
      input.schedule_type,
    )
    .first();

  return json({ id: result.id }, 201);
}

async function updateEvent(request, env, id) {
  const input = validateEventInput(await readJson(request));
  const nextReminder = computeReminderForSchedule(input, Date.now());

  const result = await env.DB.prepare(
    `UPDATE events
        SET name = ?, anchor_date = ?, start_time_utc = ?, interval_days = ?,
            reminder_minutes = ?, message = ?, enabled = ?,
            next_reminder_at = ?, schedule_type = ?, terminal_status = NULL,
            completed_at = NULL, failed_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
  )
    .bind(
      input.name,
      input.anchor_date,
      input.start_time_utc,
      input.interval_days,
      input.reminder_minutes,
      input.message,
      input.enabled ? 1 : 0,
      nextReminder,
      input.schedule_type,
      id,
    )
    .run();

  if (!result.meta.changes) return json({ error: "Event not found" }, 404);
  return json({ ok: true });
}

async function deleteEvent(env, id) {
  const [, result] = await env.DB.batch([
    env.DB.prepare("DELETE FROM deliveries WHERE event_id = ?").bind(id),
    env.DB.prepare("DELETE FROM events WHERE id = ?").bind(id),
  ]);
  if (!result.meta.changes) return json({ error: "Event not found" }, 404);
  return json({ ok: true });
}

async function listDeliveries(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, event_id, event_name, scheduled_for, attempted_at,
            sent_at, status, attempts, error
       FROM deliveries
      ORDER BY attempted_at DESC
      LIMIT 50`,
  ).all();
  return json({ deliveries: results });
}

async function processDueEvents(env, nowMs) {
  await normalizeOverdueEvents(env, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, name, interval_days, message, next_reminder_at, schedule_type
       FROM events
      WHERE enabled = 1 AND next_reminder_at <= ?
      ORDER BY next_reminder_at ASC
      LIMIT 25`,
  )
    .bind(nowIso)
    .all();

  for (const event of results) {
    await deliverEvent(env, event);
  }
}

export async function normalizeOverdueEvents(env, nowMs) {
  const staleBefore = new Date(nowMs - DELIVERY_GRACE_MS).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, interval_days, next_reminder_at, schedule_type
       FROM events
      WHERE enabled = 1
        AND schedule_type = 'recurring'
        AND next_reminder_at < ?`,
  )
    .bind(staleBefore)
    .all();

  for (const event of results) {
    if (event.schedule_type !== "recurring") continue;
    const nextMs = Date.parse(event.next_reminder_at);
    const intervalMs = event.interval_days * 86_400_000;
    const periods = Math.floor((nowMs - nextMs) / intervalMs) + 1;
    const advanced = new Date(nextMs + periods * intervalMs).toISOString();
    await env.DB.prepare(
      `UPDATE events
          SET next_reminder_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND next_reminder_at = ?`,
    )
      .bind(advanced, event.id, event.next_reminder_at)
      .run();
  }
}

export async function deliverEvent(env, event) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO deliveries
       (event_id, event_name, scheduled_for, status, attempts)
     VALUES (?, ?, ?, 'pending', 0)`,
  )
    .bind(event.id, event.name, event.next_reminder_at)
    .run();

  const delivery = await env.DB.prepare(
    `SELECT id, status, attempts
       FROM deliveries
      WHERE event_id = ? AND scheduled_for = ?`,
  )
    .bind(event.id, event.next_reminder_at)
    .first();

  if (!delivery) throw new Error("Could not create delivery record");
  if (delivery.status === "sent") {
    await finishDeliveredEvent(env, event);
    return;
  }
  if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
    await finishExhaustedEvent(env, event);
    return;
  }

  const attemptedAt = new Date().toISOString();
  const staleClaimBefore = new Date(Date.now() - DELIVERY_CLAIM_LEASE_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE deliveries
        SET status = 'pending', attempted_at = ?, attempts = attempts + 1,
            error = NULL
      WHERE id = ? AND attempts = ?
        AND (
          (status = 'pending' AND (attempts = 0 OR attempted_at < ?))
          OR status = 'failed'
        )`,
  )
    .bind(attemptedAt, delivery.id, delivery.attempts, staleClaimBefore)
    .run();

  if (!claim.meta.changes) return;
  const attempts = delivery.attempts + 1;

  try {
    await sendDiscordMessage(env, event.message);
    const sentAt = new Date().toISOString();
    const eventUpdate = isOneTime(event)
      ? env.DB.prepare(
          `UPDATE events
              SET last_sent_at = ?, enabled = 0, terminal_status = 'completed',
                  completed_at = ?, failed_at = NULL,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ? AND next_reminder_at = ? AND schedule_type = 'one_time'`,
        ).bind(sentAt, sentAt, event.id, event.next_reminder_at)
      : env.DB.prepare(
          `UPDATE events
              SET last_sent_at = ?, next_reminder_at = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ? AND next_reminder_at = ? AND schedule_type = 'recurring'`,
        ).bind(
          sentAt,
          addDays(event.next_reminder_at, event.interval_days),
          event.id,
          event.next_reminder_at,
        );

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE deliveries
            SET status = 'sent', sent_at = ?, attempted_at = ?, error = NULL
          WHERE id = ? AND status = 'pending' AND attempts = ?`,
      ).bind(sentAt, attemptedAt, delivery.id, attempts),
      eventUpdate,
    ]);
  } catch (error) {
    await env.DB.prepare(
      `UPDATE deliveries
          SET status = 'failed', attempted_at = ?, error = ?
        WHERE id = ? AND status = 'pending' AND attempts = ?`,
    )
      .bind(attemptedAt, publicError(error).slice(0, 500), delivery.id, attempts)
      .run();

    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      await finishExhaustedEvent(env, event);
    }
    throw error;
  }
}

async function advanceEvent(env, event) {
  if (isOneTime(event)) return;
  await env.DB.prepare(
    `UPDATE events
        SET next_reminder_at = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND next_reminder_at = ? AND schedule_type = 'recurring'`,
  )
    .bind(
      addDays(event.next_reminder_at, event.interval_days),
      event.id,
      event.next_reminder_at,
    )
    .run();
}

async function finishDeliveredEvent(env, event) {
  if (!isOneTime(event)) {
    await advanceEvent(env, event);
    return;
  }

  const completedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE events
        SET enabled = 0, terminal_status = 'completed',
            completed_at = COALESCE(completed_at, ?),
            failed_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND next_reminder_at = ? AND schedule_type = 'one_time'`,
  )
    .bind(completedAt, event.id, event.next_reminder_at)
    .run();
}

async function finishExhaustedEvent(env, event) {
  if (!isOneTime(event)) {
    await advanceEvent(env, event);
    return;
  }

  const failedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE events
        SET enabled = 0, terminal_status = 'failed',
            failed_at = COALESCE(failed_at, ?),
            completed_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND next_reminder_at = ? AND schedule_type = 'one_time'`,
  )
    .bind(failedAt, event.id, event.next_reminder_at)
    .run();
}

function isOneTime(event) {
  return event.schedule_type === "one_time";
}

async function sendDiscordMessage(env, content) {
  if (!env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL is not configured");
  }
  const separator = env.DISCORD_WEBHOOK_URL.includes("?") ? "&" : "?";
  const response = await fetch(`${env.DISCORD_WEBHOOK_URL}${separator}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discord returned ${response.status}: ${detail}`);
  }
}

export function computeNextReminderIso(
  anchorDate,
  startTimeUtc,
  reminderMinutes,
  intervalDays,
  fromMs,
) {
  const eventMs = Date.parse(`${anchorDate}T${startTimeUtc}:00.000Z`);
  if (!Number.isFinite(eventMs)) throw new Error("Invalid event date or time");
  const firstReminderMs = eventMs - reminderMinutes * 60_000;
  const intervalMs = intervalDays * 86_400_000;
  if (firstReminderMs >= fromMs) return new Date(firstReminderMs).toISOString();
  const periods = Math.ceil((fromMs - firstReminderMs) / intervalMs);
  return new Date(firstReminderMs + periods * intervalMs).toISOString();
}

export function computeOneTimeReminderIso(
  eventDate,
  startTimeUtc,
  reminderMinutes,
  fromMs,
) {
  const eventMs = Date.parse(`${eventDate}T${startTimeUtc}:00.000Z`);
  if (!Number.isFinite(eventMs)) throw validationError("Invalid event date or time");
  const reminderMs = eventMs - reminderMinutes * 60_000;
  if (reminderMs < fromMs) {
    throw validationError("One-time reminder time must be in the future");
  }
  return new Date(reminderMs).toISOString();
}

export function computeReminderForSchedule(input, fromMs) {
  if (input.schedule_type === "one_time") {
    return computeOneTimeReminderIso(
      input.anchor_date,
      input.start_time_utc,
      input.reminder_minutes,
      fromMs,
    );
  }

  return computeNextReminderIso(
    input.anchor_date,
    input.start_time_utc,
    input.reminder_minutes,
    input.interval_days,
    fromMs,
  );
}

export function validateEventInput(body, fromMs = Date.now()) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const anchorDate = typeof body.anchor_date === "string" ? body.anchor_date : "";
  const startTime = typeof body.start_time_utc === "string" ? body.start_time_utc : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const scheduleType = body.schedule_type ?? "recurring";
  const intervalDays = Number(body.interval_days);
  const reminderMinutes = Number(body.reminder_minutes);

  if (!name || name.length > 100) throw validationError("Name must be 1–100 characters");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) throw validationError("Invalid event date");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw validationError("Invalid UTC time");
  if (!['recurring', 'one_time'].includes(scheduleType)) {
    throw validationError("Schedule type must be recurring or one_time");
  }
  if (
    scheduleType === "recurring"
    && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)
  ) {
    throw validationError("Interval must be between 1 and 365 days");
  }
  if (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 10080) {
    throw validationError("Reminder must be between 0 and 10,080 minutes");
  }
  if (!message || message.length > 2000) throw validationError("Message must be 1–2,000 characters");

  const validated = {
    name,
    anchor_date: anchorDate,
    start_time_utc: startTime,
    schedule_type: scheduleType,
    interval_days: scheduleType === "recurring" ? intervalDays : 1,
    reminder_minutes: reminderMinutes,
    message,
    enabled: body.enabled !== false,
  };

  computeReminderForSchedule(validated, fromMs);
  return validated;
}

function validationError(message) {
  return new RequestError(message);
}

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

function hasValidOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function isMutation(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw validationError("Request body must be valid JSON");
  }
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function publicError(error) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function hmac(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function base64UrlEncode(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
