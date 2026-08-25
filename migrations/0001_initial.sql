CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    anchor_date TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 2 CHECK (interval_days BETWEEN 1 AND 365),
    reminder_minutes INTEGER NOT NULL DEFAULT 10 CHECK (reminder_minutes BETWEEN 0 AND 10080),
    message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    next_reminder_at TEXT NOT NULL,
    last_sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_due
    ON events(enabled, next_reminder_at);

CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE(event_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_recent
    ON deliveries(attempted_at DESC);

INSERT INTO events (
    name,
    anchor_date,
    start_time_utc,
    interval_days,
    reminder_minutes,
    message,
    enabled,
    next_reminder_at
) VALUES
(
    'Bear Trap 1',
    '2026-08-24',
    '15:00',
    2,
    10,
    '🐻 Bear Trap 1 starts in 10 minutes!',
    1,
    '2026-08-26T14:50:00.000Z'
),
(
    'Bear Trap 2',
    '2026-08-24',
    '18:30',
    2,
    10,
    '🐻 Bear Trap 2 starts in 10 minutes!',
    1,
    '2026-08-26T18:20:00.000Z'
);
