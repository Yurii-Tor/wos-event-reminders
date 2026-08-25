import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { matchArchiveApiPath, matchReminderApiPath } from "../src/index.js";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("frontend uses the Worker's canonical reminder collection path for all CRUD calls", () => {
  const frontendPath = appSource.match(
    /const REMINDERS_API_PATH = "([^"]+)";/,
  )?.[1];

  assert.equal(frontendPath, "/api/reminders");
  assert.deepEqual(matchReminderApiPath(frontendPath), { id: null });
  assert.deepEqual(matchReminderApiPath(`${frontendPath}/42`), { id: 42 });
  assert.doesNotMatch(appSource, /\/api\/events/);
  assert.match(appSource, /api\(REMINDERS_API_PATH\)/);
  assert.match(appSource, /`\$\{REMINDERS_API_PATH\}\/\$\{id\}`/);
  assert.match(appSource, /`\$\{REMINDERS_API_PATH\}\/\$\{event\.id\}`/);
});

test("index cache-busts app.js with its current content hash", () => {
  const expectedVersion = createHash("sha256")
    .update(appSource.replace(/\r\n/g, "\n"))
    .digest("hex")
    .slice(0, 12);
  const referencedVersion = indexSource.match(
    /<script type="module" src="\/app\.js\?v=([a-f0-9]+)"><\/script>/,
  )?.[1];

  assert.equal(referencedVersion, expectedVersion);
});

test("Worker recognizes canonical reminder routes and legacy event aliases", () => {
  assert.deepEqual(matchReminderApiPath("/api/reminders"), { id: null });
  assert.deepEqual(matchReminderApiPath("/api/reminders/42"), { id: 42 });
  assert.deepEqual(matchReminderApiPath("/api/events"), { id: null });
  assert.deepEqual(matchReminderApiPath("/api/events/42"), { id: 42 });
  assert.equal(matchReminderApiPath("/api/reminders/not-a-number"), null);
  assert.equal(matchReminderApiPath("/api/deliveries"), null);
});

test("frontend submits both explicit schedule types and hides the recurring interval for one-time reminders", () => {
  assert.match(indexSource, /<option value="recurring">Recurring<\/option>/);
  assert.match(indexSource, /<option value="one_time">One time<\/option>/);
  assert.match(appSource, /schedule_type: \$\("#schedule-type"\)\.value/);
  assert.match(appSource, /classList\.toggle\("hidden", oneTime\)/);
  assert.match(appSource, /`schedule-badge \$\{event\.schedule_type\}`/);
});

test("frontend and Worker agree on archive, restore, and permanent-delete routes", () => {
  const archivePath = appSource.match(
    /const ARCHIVE_API_PATH = "([^"]+)";/,
  )?.[1];
  assert.equal(archivePath, "/api/archive");
  assert.deepEqual(matchArchiveApiPath(archivePath), { id: null });
  assert.deepEqual(matchArchiveApiPath(`${archivePath}/42`), { id: 42 });
  assert.equal(matchArchiveApiPath(`${archivePath}/invalid`), null);
  assert.match(appSource, /`\$\{ARCHIVE_API_PATH\}\/\$\{id\}`/);
  assert.match(appSource, /`\$\{ARCHIVE_API_PATH\}\/\$\{event\.id\}`/);
  assert.match(appSource, /Reminder archived\./);
  assert.match(appSource, /Delete permanently/);
});
