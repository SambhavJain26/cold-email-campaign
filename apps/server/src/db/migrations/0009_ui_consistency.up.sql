-- Persistent scheduler blocker episodes: one alert per active condition even
-- across a worker restart or a second scheduler process.
CREATE TABLE send_blocker_episodes (
  code text PRIMARY KEY,
  opened_at timestamptz NOT NULL DEFAULT now()
);
