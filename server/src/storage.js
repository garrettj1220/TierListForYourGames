import { Pool } from "pg";
import { createId, nowIso, readDb, writeDb } from "./db.js";

const DEFAULT_TIERS = { S: [], A: [], B: [], C: [], D: [], F: [] };

function makeSourceKey(title, platform = "Manual") {
  return `manual:${String(title).trim().toLowerCase()}:${String(platform).trim().toLowerCase()}`;
}

function normalizeGameRecord(record) {
  return {
    id: record.id,
    sourceKey: record.source_key ?? record.sourceKey ?? null,
    title: record.title,
    platform: record.platform,
    genre: record.genre,
    popularity: Number(record.popularity ?? 50),
    playtimeMinutes: Number(record.playtime_minutes ?? record.playtimeMinutes ?? 0),
    coverArtUrl: record.cover_art_url ?? record.coverArtUrl ?? "",
    manuallyAdded: Boolean(record.manually_added ?? record.manuallyAdded ?? false)
  };
}

export function createStorage() {
  if (process.env.DATABASE_URL) {
    return new PgStorage(process.env.DATABASE_URL);
  }
  return new JsonStorage();
}

class JsonStorage {
  async bootstrap(userId) {
    const db = await readDb();
    return {
      user: db.users.find((u) => u.id === userId) || { id: userId, name: "Demo User" },
      linkedAccounts: db.linkedAccounts.filter((a) => a.userId === userId),
      games: db.userGames.filter((g) => g.userId === userId),
      tierListState: db.tierListState ?? { userId, tiers: DEFAULT_TIERS, unranked: [], updatedAt: null },
      theme: db.userThemeSettings ?? { userId, themeId: "light" }
    };
  }

  async getLinkedAccounts(userId) {
    const db = await readDb();
    return db.linkedAccounts.filter((a) => a.userId === userId);
  }

  async linkAccount(userId, { platform, accountName, externalUserId = null, metadata = {} }) {
    const db = await readDb();
    const linked = {
      id: createId("acct"),
      userId,
      platform,
      accountName,
      externalUserId,
      metadata,
      linkedAt: nowIso(),
      syncStatus: "connected"
    };
    db.linkedAccounts.push(linked);
    await writeDb(db);
    return linked;
  }

  async getAccount(userId, accountId) {
    const db = await readDb();
    return db.linkedAccounts.find((a) => a.userId === userId && a.id === accountId) ?? null;
  }

  async removeAccount(userId, accountId) {
    const db = await readDb();
    const before = db.linkedAccounts.length;
    db.linkedAccounts = db.linkedAccounts.filter((a) => !(a.userId === userId && a.id === accountId));
    await writeDb(db);
    return { removed: before - db.linkedAccounts.length };
  }

  async setTheme(userId, themeId) {
    const db = await readDb();
    db.userThemeSettings = { userId, themeId };
    await writeDb(db);
    return db.userThemeSettings;
  }

  async getGames(userId) {
    const db = await readDb();
    return db.userGames.filter((g) => g.userId === userId);
  }

  async searchCatalog(query) {
    const db = await readDb();
    const q = String(query).toLowerCase();
    const catalog = Array.isArray(db.gamesNormalized) ? db.gamesNormalized : [];
    return catalog
      .filter((g) => String(g.title).toLowerCase().includes(q))
      .slice(0, 20)
      .map((g) =>
        normalizeGameRecord({
          ...g,
          sourceKey: g.sourceKey || g.source_key || null,
          playtimeMinutes: 0,
          manuallyAdded: false
        })
      );
  }

  async addManualGame(userId, gameInput) {
    const db = await readDb();
    db.gamesNormalized = Array.isArray(db.gamesNormalized) ? db.gamesNormalized : [];
    const sourceKey = gameInput.sourceKey || makeSourceKey(gameInput.title, gameInput.platform || "Manual");
    const coverArtUrl =
      gameInput.coverArtUrl ||
      `https://placehold.co/240x320/eef2ff/0f172a?text=${encodeURIComponent(gameInput.title.slice(0, 18))}`;

    let catalogGame = db.gamesNormalized.find((g) => g.sourceKey === sourceKey);
    if (!catalogGame) {
      catalogGame = {
        id: createId("game"),
        sourceKey,
        title: gameInput.title,
        platform: gameInput.platform || "Manual",
        genre: gameInput.genre || "Unknown",
        popularity: Number(gameInput.popularity) || 50,
        coverArtUrl,
        metadata: gameInput.metadata || {}
      };
      db.gamesNormalized.push(catalogGame);
    }

    const existingUserGame = db.userGames.find((g) => g.userId === userId && g.id === catalogGame.id);
    if (!existingUserGame) {
      db.userGames.push({
        id: catalogGame.id,
        userId,
        title: catalogGame.title,
        platform: catalogGame.platform,
        genre: catalogGame.genre,
        popularity: Number(catalogGame.popularity) || 50,
        playtimeMinutes: 0,
        coverArtUrl: catalogGame.coverArtUrl || coverArtUrl,
        manuallyAdded: Boolean(gameInput.manuallyAdded ?? true),
        createdAt: nowIso()
      });
    }

    db.tierListState.unranked = Array.from(new Set([...(db.tierListState.unranked ?? []), catalogGame.id]));
    db.tierListState.updatedAt = nowIso();
    await writeDb(db);
    return db.userGames.find((g) => g.userId === userId && g.id === catalogGame.id);
  }

  async removeGames(userId, gameIds) {
    const db = await readDb();
    const removeSet = new Set(gameIds);
    db.userGames = db.userGames.filter((g) => !(g.userId === userId && removeSet.has(g.id)));
    db.tierListState.unranked = (db.tierListState.unranked ?? []).filter((id) => !removeSet.has(id));
    for (const tier of Object.keys(db.tierListState.tiers)) {
      db.tierListState.tiers[tier] = db.tierListState.tiers[tier].filter((id) => !removeSet.has(id));
    }
    db.tierListState.updatedAt = nowIso();
    await writeDb(db);
    return { removed: gameIds.length };
  }

  async saveTierState(userId, tiers, unranked) {
    const db = await readDb();
    db.tierListState = { userId, tiers, unranked, updatedAt: nowIso() };
    await writeDb(db);
    return db.tierListState;
  }

  async ingestSteamLibrary(userId, _accountId, ownedGames) {
    const db = await readDb();
    db.gamesNormalized = Array.isArray(db.gamesNormalized) ? db.gamesNormalized : [];
    let inserted = 0;
    let updated = 0;
    for (const raw of ownedGames) {
      const title = raw.name || `Steam App ${raw.appid}`;
      const sourceKey = `steam:${raw.appid}`;
      let catalogGame = db.gamesNormalized.find((g) => g.sourceKey === sourceKey);
      if (!catalogGame) {
        catalogGame = {
          id: createId("game"),
          sourceKey,
          title,
          platform: "Steam",
          genre: "Unknown",
          popularity: 70,
          coverArtUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${raw.appid}/library_600x900_2x.jpg`,
          metadata: { steamAppId: raw.appid }
        };
        db.gamesNormalized.push(catalogGame);
        inserted += 1;
      } else {
        catalogGame.title = title;
        catalogGame.coverArtUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${raw.appid}/library_600x900_2x.jpg`;
        updated += 1;
      }

      const existing = db.userGames.find((g) => g.userId === userId && g.id === catalogGame.id);
      if (existing) {
        existing.playtimeMinutes = raw.playtime_forever ?? existing.playtimeMinutes ?? 0;
        existing.coverArtUrl = catalogGame.coverArtUrl;
      } else {
        db.userGames.push({
          id: catalogGame.id,
          userId,
          title: catalogGame.title,
          platform: catalogGame.platform,
          genre: catalogGame.genre,
          popularity: Number(catalogGame.popularity) || 70,
          playtimeMinutes: raw.playtime_forever ?? 0,
          coverArtUrl: catalogGame.coverArtUrl,
          manuallyAdded: false,
          createdAt: nowIso()
        });
      }
      db.tierListState.unranked = Array.from(new Set([...(db.tierListState.unranked ?? []), catalogGame.id]));
    }
    db.tierListState.updatedAt = nowIso();
    await writeDb(db);
    return { inserted, updated };
  }
}

class PgStorage {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  async bootstrap(userId) {
    const client = await this.pool.connect();
    try {
      const userResult = await client.query("SELECT id, name FROM users WHERE id = $1", [userId]);
      const accountsResult = await client.query(
        "SELECT id, platform, account_name AS \"accountName\", external_user_id AS \"externalUserId\", sync_status AS \"syncStatus\" FROM linked_accounts WHERE user_id = $1 ORDER BY linked_at DESC",
        [userId]
      );
      const gamesResult = await client.query(
        `SELECT g.id, g.title, g.platform, g.genre, g.popularity, g.cover_art_url, ug.playtime_minutes, ug.manually_added
         FROM user_games ug
         JOIN games_normalized g ON g.id = ug.game_id
         WHERE ug.user_id = $1
         ORDER BY g.title ASC`,
        [userId]
      );
      const tierResult = await client.query("SELECT tiers, unranked, updated_at FROM tier_list_states WHERE user_id = $1", [userId]);
      const themeResult = await client.query("SELECT theme_id FROM user_theme_settings WHERE user_id = $1", [userId]);

      return {
        user: userResult.rows[0] ?? { id: userId, name: "Demo User" },
        linkedAccounts: accountsResult.rows,
        games: gamesResult.rows.map(normalizeGameRecord),
        tierListState: tierResult.rows[0]
          ? {
              tiers: tierResult.rows[0].tiers,
              unranked: tierResult.rows[0].unranked,
              updatedAt: tierResult.rows[0].updated_at
            }
          : { userId, tiers: DEFAULT_TIERS, unranked: [], updatedAt: null },
        theme: themeResult.rows[0]
          ? { userId, themeId: themeResult.rows[0].theme_id }
          : { userId, themeId: "light" }
      };
    } finally {
      client.release();
    }
  }

  async getLinkedAccounts(userId) {
    const result = await this.pool.query(
      "SELECT id, platform, account_name AS \"accountName\", external_user_id AS \"externalUserId\", sync_status AS \"syncStatus\" FROM linked_accounts WHERE user_id = $1 ORDER BY linked_at DESC",
      [userId]
    );
    return result.rows;
  }

  async linkAccount(userId, { platform, accountName, externalUserId = null, metadata = {} }) {
    const id = createId("acct");
    await this.pool.query(
      `INSERT INTO linked_accounts (id, user_id, platform, account_name, external_user_id, metadata, linked_at, sync_status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), 'connected')`,
      [id, userId, platform, accountName, externalUserId, JSON.stringify(metadata)]
    );
    return { id, userId, platform, accountName, externalUserId, syncStatus: "connected" };
  }

  async getAccount(userId, accountId) {
    const result = await this.pool.query(
      "SELECT id, user_id, platform, account_name, external_user_id FROM linked_accounts WHERE user_id = $1 AND id = $2 LIMIT 1",
      [userId, accountId]
    );
    return result.rows[0] ?? null;
  }

  async removeAccount(userId, accountId) {
    const result = await this.pool.query("DELETE FROM linked_accounts WHERE user_id = $1 AND id = $2", [userId, accountId]);
    return { removed: result.rowCount || 0 };
  }

  async setTheme(userId, themeId) {
    await this.pool.query(
      `INSERT INTO user_theme_settings (user_id, theme_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET theme_id = EXCLUDED.theme_id`,
      [userId, themeId]
    );
    return { userId, themeId };
  }

  async getGames(userId) {
    const result = await this.pool.query(
      `SELECT g.id, g.title, g.platform, g.genre, g.popularity, g.cover_art_url, ug.playtime_minutes, ug.manually_added
       FROM user_games ug
       JOIN games_normalized g ON g.id = ug.game_id
       WHERE ug.user_id = $1
       ORDER BY g.title ASC`,
      [userId]
    );
    return result.rows.map(normalizeGameRecord);
  }

  async searchCatalog(query) {
    const result = await this.pool.query(
      `SELECT id, source_key, title, platform, genre, popularity, cover_art_url, 0 AS playtime_minutes, FALSE AS manually_added
       FROM games_normalized
       WHERE title ILIKE $1
       ORDER BY title ASC
       LIMIT 20`,
      [`%${String(query).trim()}%`]
    );
    return result.rows.map(normalizeGameRecord);
  }

  async addManualGame(userId, gameInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sourceKey = gameInput.sourceKey || makeSourceKey(gameInput.title, gameInput.platform || "Manual");
      const coverArtUrl =
        gameInput.coverArtUrl ||
        `https://placehold.co/240x320/eef2ff/0f172a?text=${encodeURIComponent(gameInput.title.slice(0, 18))}`;
      const gameId = createId("game");
      const persisted = await client.query(
        `INSERT INTO games_normalized (id, source_key, title, platform, genre, popularity, cover_art_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (source_key) DO UPDATE
         SET title = EXCLUDED.title,
             platform = EXCLUDED.platform,
             genre = EXCLUDED.genre,
             popularity = EXCLUDED.popularity,
             cover_art_url = EXCLUDED.cover_art_url,
             metadata = COALESCE(games_normalized.metadata, '{}'::jsonb) || EXCLUDED.metadata
         RETURNING id, title, platform, genre, popularity, cover_art_url`,
        [
          gameId,
          sourceKey,
          gameInput.title,
          gameInput.platform || "Manual",
          gameInput.genre || "Unknown",
          Number(gameInput.popularity) || 50,
          coverArtUrl,
          JSON.stringify(gameInput.metadata || {})
        ]
      );
      const persistedGame = persisted.rows[0];
      const persistedGameId = persistedGame.id;
      await client.query(
        `INSERT INTO user_games (user_id, game_id, playtime_minutes, manually_added)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [userId, persistedGameId, Boolean(gameInput.manuallyAdded ?? true)]
      );
      await client.query(
        `INSERT INTO tier_list_states (user_id, tiers, unranked, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, JSON.stringify(DEFAULT_TIERS), JSON.stringify([])]
      );
      const state = await client.query("SELECT tiers, unranked FROM tier_list_states WHERE user_id = $1", [userId]);
      const unranked = Array.from(new Set([...(state.rows[0]?.unranked ?? []), persistedGameId]));
      await client.query("UPDATE tier_list_states SET unranked = $1::jsonb, updated_at = NOW() WHERE user_id = $2", [
        JSON.stringify(unranked),
        userId
      ]);
      await client.query("COMMIT");
      return {
        id: persistedGameId,
        title: persistedGame.title,
        platform: persistedGame.platform,
        genre: persistedGame.genre,
        popularity: Number(persistedGame.popularity) || 50,
        playtimeMinutes: 0,
        coverArtUrl: persistedGame.cover_art_url || coverArtUrl,
        manuallyAdded: Boolean(gameInput.manuallyAdded ?? true)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeGames(userId, gameIds) {
    if (gameIds.length === 0) return { removed: 0 };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_games WHERE user_id = $1 AND game_id = ANY($2::text[])", [userId, gameIds]);
      const stateResult = await client.query("SELECT tiers, unranked FROM tier_list_states WHERE user_id = $1", [userId]);
      if (stateResult.rows[0]) {
        const removeSet = new Set(gameIds);
        const tiers = stateResult.rows[0].tiers;
        const unranked = stateResult.rows[0].unranked.filter((id) => !removeSet.has(id));
        for (const k of Object.keys(tiers)) tiers[k] = tiers[k].filter((id) => !removeSet.has(id));
        await client.query("UPDATE tier_list_states SET tiers = $1::jsonb, unranked = $2::jsonb, updated_at = NOW() WHERE user_id = $3", [
          JSON.stringify(tiers),
          JSON.stringify(unranked),
          userId
        ]);
      }
      await client.query("COMMIT");
      return { removed: gameIds.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveTierState(userId, tiers, unranked) {
    await this.pool.query(
      `INSERT INTO tier_list_states (user_id, tiers, unranked, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET tiers = EXCLUDED.tiers, unranked = EXCLUDED.unranked, updated_at = NOW()`,
      [userId, JSON.stringify(tiers), JSON.stringify(unranked)]
    );
    return { userId, tiers, unranked, updatedAt: nowIso() };
  }

  async ingestSteamLibrary(userId, _accountId, ownedGames) {
    const client = await this.pool.connect();
    let inserted = 0;
    let updated = 0;
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO tier_list_states (user_id, tiers, unranked, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, JSON.stringify(DEFAULT_TIERS), JSON.stringify([])]
      );

      const state = await client.query("SELECT unranked FROM tier_list_states WHERE user_id = $1", [userId]);
      const unranked = new Set(state.rows[0]?.unranked ?? []);

      for (const raw of ownedGames) {
        const sourceKey = `steam:${raw.appid}`;
        const title = raw.name || `Steam App ${raw.appid}`;
        const coverArtUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${raw.appid}/library_600x900_2x.jpg`;
        const existingGame = await client.query("SELECT id FROM games_normalized WHERE source_key = $1 LIMIT 1", [sourceKey]);
        let gameId;
        if (existingGame.rows[0]) {
          gameId = existingGame.rows[0].id;
          await client.query(
            `UPDATE games_normalized
             SET title = $1, platform = 'Steam', cover_art_url = $2, metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{steamAppId}', to_jsonb($3::int), true)
             WHERE id = $4`,
            [title, coverArtUrl, raw.appid, gameId]
          );
          updated += 1;
        } else {
          gameId = createId("game");
          await client.query(
            `INSERT INTO games_normalized (id, source_key, title, platform, genre, popularity, cover_art_url, metadata)
             VALUES ($1, $2, $3, 'Steam', 'Unknown', 70, $4, $5::jsonb)`,
            [gameId, sourceKey, title, coverArtUrl, JSON.stringify({ steamAppId: raw.appid })]
          );
          inserted += 1;
        }

        await client.query(
          `INSERT INTO user_games (user_id, game_id, playtime_minutes, manually_added)
           VALUES ($1, $2, $3, FALSE)
           ON CONFLICT (user_id, game_id)
           DO UPDATE SET playtime_minutes = EXCLUDED.playtime_minutes`,
          [userId, gameId, raw.playtime_forever ?? 0]
        );
        unranked.add(gameId);
      }

      await client.query("UPDATE tier_list_states SET unranked = $1::jsonb, updated_at = NOW() WHERE user_id = $2", [
        JSON.stringify(Array.from(unranked)),
        userId
      ]);
      await client.query("COMMIT");
      return { inserted, updated };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
