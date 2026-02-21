CREATE TABLE IF NOT EXISTS user_removed_games (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games_normalized(id) ON DELETE CASCADE,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS user_removed_games_removed_at_idx
  ON user_removed_games (user_id, removed_at DESC);
