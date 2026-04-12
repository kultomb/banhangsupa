-- Theo dõi phiên thiết bị; giới hạn 2 thiết bị đăng nhập đồng thời mỗi tài khoản.
-- Khi thiết bị thứ 3 đăng nhập, server xóa record của thiết bị ít hoạt động nhất (last_seen_at nhỏ nhất).
-- Thiết bị bị xóa sẽ nhận kick=true qua presence ping tiếp theo và tự đăng xuất.

CREATE TABLE IF NOT EXISTS device_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  device_id     TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT device_sessions_user_device_unique UNIQUE (user_id, device_id)
);

-- Index để query nhanh theo user_id + sắp xếp last_seen_at khi tìm thiết bị cần kick
CREATE INDEX IF NOT EXISTS device_sessions_user_last_seen_idx
  ON device_sessions (user_id, last_seen_at ASC);

-- Chỉ service_role (server-side admin client) được truy cập; deny tất cả cho public/authenticated
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_public_device_sessions"
  ON device_sessions
  FOR ALL
  TO public
  USING (false);
