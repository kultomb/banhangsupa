-- Tracks the latest write version per shop for real-time sync notifications.
-- Clients subscribe via Supabase Realtime Postgres Changes to detect remote saves.
CREATE TABLE IF NOT EXISTS pos_version_log (
  shop_key      TEXT        PRIMARY KEY,
  write_version INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pos_version_log ENABLE ROW LEVEL SECURITY;

-- Allow anon + authenticated to SELECT — version numbers only, not sensitive data.
CREATE POLICY "anyone_read_pos_version_log"
  ON pos_version_log FOR SELECT
  TO anon, authenticated
  USING (true);
