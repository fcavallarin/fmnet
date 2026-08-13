CREATE TABLE IF NOT EXISTS device_mobile_push_token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  push_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES device(id),
  UNIQUE(device_id)
);