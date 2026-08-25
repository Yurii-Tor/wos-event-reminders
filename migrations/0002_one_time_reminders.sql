ALTER TABLE events
    ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'recurring'
    CHECK (schedule_type IN ('recurring', 'one_time'));

ALTER TABLE events
    ADD COLUMN terminal_status TEXT
    CHECK (terminal_status IS NULL OR terminal_status IN ('completed', 'failed'));

ALTER TABLE events ADD COLUMN completed_at TEXT;
ALTER TABLE events ADD COLUMN failed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_events_schedule_type
    ON events(schedule_type, enabled, next_reminder_at);
