-- Temporary capabilities for a NetEase URL lookup. Audio is never uploaded.
CREATE TABLE wifi_audio_lookups (
  key_hash TEXT PRIMARY KEY,
  lan_host TEXT NOT NULL,
  lan_port INTEGER NOT NULL,
  audio_nonce TEXT NOT NULL,
  file_ids TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  client_hash TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX wifi_audio_lookups_expiry ON wifi_audio_lookups(expires_at);
CREATE INDEX wifi_audio_lookups_client ON wifi_audio_lookups(client_hash);
CREATE TABLE wifi_audio_lookup_rate (
  client_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (client_hash, bucket)
) WITHOUT ROWID;
