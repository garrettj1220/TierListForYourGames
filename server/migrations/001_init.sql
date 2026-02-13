CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS linked_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL,
  external_user_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'connected'
);

CREATE TABLE IF NOT EXISTS games_normalized (
  id TEXT PRIMARY KEY,
  source_key TEXT UNIQUE,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT 'Unknown',
  popularity INTEGER NOT NULL DEFAULT 50,
  cover_art_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_games (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games_normalized(id) ON DELETE CASCADE,
  playtime_minutes INTEGER NOT NULL DEFAULT 0,
  owned BOOLEAN NOT NULL DEFAULT TRUE,
  manually_added BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS tier_list_states (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tiers JSONB NOT NULL,
  unranked JSONB NOT NULL,
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_theme_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES linked_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_user_platform_external_uidx
  ON linked_accounts (user_id, LOWER(platform), external_user_id)
  WHERE external_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_user_platform_name_uidx
  ON linked_accounts (user_id, LOWER(platform), LOWER(account_name));

CREATE INDEX IF NOT EXISTS games_normalized_title_norm_idx
  ON games_normalized ((regexp_replace(LOWER(title), '[^a-z0-9]+', '', 'g')));

INSERT INTO users (id, name)
VALUES ('demo-user', 'Demo User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tier_list_states (user_id, tiers, unranked, updated_at)
VALUES (
  'demo-user',
  '{"S":[],"A":[],"B":[],"C":[],"D":[],"F":[]}'::jsonb,
  '[]'::jsonb,
  NULL
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_theme_settings (user_id, theme_id)
VALUES ('demo-user', 'dark')
ON CONFLICT (user_id) DO NOTHING;
