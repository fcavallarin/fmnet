CREATE TABLE IF NOT EXISTS transport_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  network_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  permissions TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (network_id) REFERENCES network(id),
  FOREIGN KEY (device_id) REFERENCES device(id)
);

CREATE TABLE IF NOT EXISTS network (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  sign_public_key TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (network_id) REFERENCES network(id)
);

CREATE TABLE IF NOT EXISTS counter (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT INTO counter (name, value) VALUES ('event_sequence', 0);

CREATE TABLE IF NOT EXISTS event (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  sender_device_id TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  signature TEXT NOT NULL,
  sequence INTEGER UNIQUE NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (network_id) REFERENCES network(id),
  FOREIGN KEY (sender_device_id) REFERENCES device(id)
);

CREATE TABLE IF NOT EXISTS pending_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  encrypted_payload_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  FOREIGN KEY (device_id) REFERENCES device(id),
  FOREIGN KEY (event_id) REFERENCES event(id),
  UNIQUE(device_id, event_id)
);


CREATE TABLE IF NOT EXISTS device_pairing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  pin TEXT NOT NULL,
  sender_crypt_public_key TEXT NOT NULL,
  sign_public_key TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(device_id, pin)
);


-- CREATE TABLE IF NOT EXISTS role_key (
--   id TEXT PRIMARY KEY,
--   network_id TEXT NOT NULL,
--   public_key TEXT NOT NULL,
--   revoked_at INTEGER,
--   created_at INTEGER NOT NULL,

--   FOREIGN KEY (network_id) REFERENCES network(id)
-- );

CREATE INDEX IF NOT EXISTS idx_pending_device_undelivered
ON pending_event(device_id, delivered_at, created_at);