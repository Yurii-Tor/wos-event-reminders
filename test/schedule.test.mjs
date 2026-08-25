import test from "node:test";
import assert from "node:assert/strict";
import { computeNextReminderIso } from "../src/index.js";

test("Bear Trap 1 advances from 24 August to 26 August", () => {
  const result = computeNextReminderIso(
    "2026-08-24",
    "15:00",
    10,
    2,
    Date.parse("2026-08-25T00:00:00Z"),
  );
  assert.equal(result, "2026-08-26T14:50:00.000Z");
});

test("48-hour recurrence crosses a 31-day month correctly", () => {
  const result = computeNextReminderIso(
    "2026-08-24",
    "15:00",
    10,
    2,
    Date.parse("2026-08-31T00:00:00Z"),
  );
  assert.equal(result, "2026-09-01T14:50:00.000Z");
});

test("Bear Trap 2 reminder is ten minutes before the event", () => {
  const result = computeNextReminderIso(
    "2026-08-24",
    "18:30",
    10,
    2,
    Date.parse("2026-08-25T00:00:00Z"),
  );
  assert.equal(result, "2026-08-26T18:20:00.000Z");
});
