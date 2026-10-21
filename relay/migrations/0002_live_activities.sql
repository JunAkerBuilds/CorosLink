-- Coach Live Activities on C-LINK. Times are epoch milliseconds.

-- ActivityKit push tokens. Each addresses one Live Activity on one iPhone,
-- which follows one turn (request_id) of one session on a linked computer.
-- A row goes once its end is sent, when APNs calls the token dead, or when
-- it expires with the activity.
CREATE TABLE live_activities (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  apns_environment TEXT NOT NULL CHECK (apns_environment IN ('sandbox', 'production')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- What was pushed last, for the throttle and ActivityKit's push budget.
  last_phase TEXT,
  last_sent_at INTEGER,
  last_high_priority_at INTEGER,
  -- aps.timestamp of the last push, in seconds: each push must be newer.
  last_timestamp INTEGER
);

CREATE INDEX live_activities_turn ON live_activities (user_id, environment_id, session_id, request_id);
CREATE INDEX live_activities_expires_at ON live_activities (expires_at);

-- How each session's last turn ended, kept for an hour so an activity that
-- registers after its turn ended still gets the end.
CREATE TABLE live_turn_ends (
  user_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  words INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, environment_id, session_id)
);

CREATE INDEX live_turn_ends_ended_at ON live_turn_ends (ended_at);
