-- CorosLink relay schema. Times are epoch milliseconds.

-- One row per website user and desktop environment. A link is the user's
-- permission to reach that desktop through the relay; unlink sets revoked_at
-- and keeps the row so a relink finds the same allocation.
CREATE TABLE environment_links (
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  env_public_jwk TEXT NOT NULL,
  -- RFC 7638 thumbprint of env_public_jwk; the kid on environment signatures.
  env_key_jkt TEXT NOT NULL,
  label TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (user_id, environment_id)
);

-- A desktop key belongs to one active link: linking the same key under another
-- account revokes the earlier link.
CREATE UNIQUE INDEX environment_links_active_key
  ON environment_links (environment_id, env_key_jkt)
  WHERE revoked_at IS NULL;

CREATE INDEX environment_links_active_user
  ON environment_links (user_id)
  WHERE revoked_at IS NULL;

-- The tunnel endpoint of a user/environment pair. The hostname and tunnel
-- name are derived once and kept for life; the tunnel itself can be replaced.
-- Every write bumps generation and is conditional on the generation it read,
-- so a stale writer (a slow retry, a cleanup sweep) cannot clobber a newer one.
CREATE TABLE allocations (
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  tunnel_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('provisioning', 'ready', 'reaping', 'deprovisioning', 'released')),
  generation INTEGER NOT NULL DEFAULT 0,
  -- Checkpoints of the external steps, so a retry resumes where it stopped.
  tunnel_id TEXT,
  configured_tunnel_id TEXT,
  origin_port INTEGER,
  dns_record_id TEXT,
  dns_tunnel_id TEXT,
  ready_at INTEGER,
  -- Set by the first recovery call. Cleanup only deletes tunnels of hosts that
  -- registered recovery, because only they can replace a deleted tunnel.
  recovery_registered_at INTEGER,
  last_recovery_at INTEGER,
  -- When cleanup or unlink claimed the row (status reaping/deprovisioning).
  claimed_at INTEGER,
  tunnel_released_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, environment_id),
  FOREIGN KEY (user_id, environment_id) REFERENCES environment_links (user_id, environment_id)
);

CREATE INDEX allocations_tunnel_id ON allocations (tunnel_id);
CREATE INDEX allocations_status ON allocations (status);

-- Short-lived copy of Cloudflare's tunnel status for GET /v1/environments.
-- Kept out of allocations so a status refresh is not an allocation change.
CREATE TABLE tunnel_status_cache (
  tunnel_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

-- APNs device tokens. A token belongs to one user; registering it again under
-- another account moves it.
CREATE TABLE push_devices (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  apns_environment TEXT NOT NULL CHECK (apns_environment IN ('sandbox', 'production')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sent_at INTEGER
);

CREATE INDEX push_devices_user ON push_devices (user_id);

-- Replay guard for environment signature nonces and DPoP jtis.
CREATE TABLE nonces (
  scope TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (scope, value)
) WITHOUT ROWID;

CREATE INDEX nonces_expires_at ON nonces (expires_at);
