ALTER TABLE deliveries
    ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'recurring'
    CHECK (schedule_type IN ('recurring', 'one_time'));
