ALTER TABLE events ADD COLUMN archived_at TEXT;

ALTER TABLE events
    ADD COLUMN archived_reason TEXT
    CHECK (archived_reason IS NULL OR archived_reason IN ('manual', 'expired'));

CREATE INDEX IF NOT EXISTS idx_events_archive
    ON events(archived_at, enabled, next_reminder_at);
