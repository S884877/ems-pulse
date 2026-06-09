-- Remove the old fixed-value constraint on wait_minutes
-- and replace with a simple range check (1-240 minutes)
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_wait_minutes_check;
ALTER TABLE reports ADD CONSTRAINT reports_wait_minutes_check
  CHECK (wait_minutes >= 1 AND wait_minutes <= 240);
