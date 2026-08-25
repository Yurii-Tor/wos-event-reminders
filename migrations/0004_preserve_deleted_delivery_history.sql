CREATE TABLE deliveries_with_retained_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    event_name TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
    UNIQUE(event_id, scheduled_for)
);

INSERT INTO deliveries_with_retained_history (
    id,
    event_id,
    event_name,
    scheduled_for,
    attempted_at,
    sent_at,
    status,
    attempts,
    error
)
SELECT
    id,
    event_id,
    event_name,
    scheduled_for,
    attempted_at,
    sent_at,
    status,
    attempts,
    error
FROM deliveries;

DROP TABLE deliveries;

ALTER TABLE deliveries_with_retained_history RENAME TO deliveries;

CREATE INDEX IF NOT EXISTS idx_deliveries_recent
    ON deliveries(attempted_at DESC);
