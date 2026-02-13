import "dotenv/config";
import { Pool } from "pg";

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function chooseBestMatch(title, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const target = normalizeTitle(title);
  const exact = candidates.find((item) => normalizeTitle(item?.name) === target);
  return exact || candidates[0] || null;
}

async function fetchTwitchAppToken(clientId, clientSecret) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  });
  const resp = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });
  if (!resp.ok) {
    throw new Error(`Twitch token request failed (${resp.status})`);
  }
  const json = await resp.json();
  if (!json?.access_token) {
    throw new Error("Twitch token response missing access_token");
  }
  return json.access_token;
}

async function searchIgdbGame(clientId, accessToken, title) {
  const body = `fields id,name,cover.image_id,platforms.name,genres.name; search "${String(title).replace(/"/g, '\\"')}"; limit 5;`;
  const resp = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain"
    },
    body
  });
  if (!resp.ok) return [];
  const json = await resp.json();
  return Array.isArray(json) ? json : [];
}

function mappedPlatform(platforms) {
  if (!Array.isArray(platforms) || platforms.length === 0) return null;
  const names = platforms.map((p) => p?.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return "Multi-platform";
}

function sourceFallbackCover(row) {
  const sourceKey = String(row?.source_key || "");
  const metadata = row?.metadata || {};

  const steamFromKey = sourceKey.startsWith("steam:") ? sourceKey.split(":")[1] : null;
  const steamFromMeta = metadata?.steamAppId ? String(metadata.steamAppId) : null;
  const steamAppId = steamFromKey || steamFromMeta;
  if (steamAppId && /^\d+$/.test(steamAppId)) {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900_2x.jpg`;
  }

  return null;
}

async function run() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const twitchClientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const twitchClientSecret = String(process.env.TWITCH_CLIENT_SECRET || "").trim();
  const dryRun = String(process.env.DRY_RUN || "").trim() === "1";
  const limit = Number(process.env.BACKFILL_LIMIT || 0);

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!twitchClientId) throw new Error("TWITCH_CLIENT_ID is required");
  if (!twitchClientSecret) throw new Error("TWITCH_CLIENT_SECRET is required");

  const accessToken = await fetchTwitchAppToken(twitchClientId, twitchClientSecret);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const whereClause = `
      WHERE COALESCE(metadata->>'igdbId', '') = ''
         OR cover_art_url IS NULL
         OR cover_art_url = ''
         OR source_key LIKE 'thegamesdb:%'
    `;
    const query = `
      SELECT id, title, platform, genre, source_key, metadata
      FROM games_normalized
      ${whereClause}
      ORDER BY created_at DESC
      ${limit > 0 ? `LIMIT ${Math.floor(limit)}` : ""}
    `;
    const rowsResult = await client.query(query);
    const rows = rowsResult.rows;
    let scanned = 0;
    let matched = 0;
    let updated = 0;
    let skipped = 0;
    let sourceFallbackApplied = 0;

    for (const row of rows) {
      scanned += 1;
      const games = await searchIgdbGame(twitchClientId, accessToken, row.title);
      const best = chooseBestMatch(row.title, games);
      if (!best) {
        const fallbackCoverUrl = sourceFallbackCover(row);
        if (!dryRun && fallbackCoverUrl) {
          await client.query(
            `UPDATE games_normalized
             SET cover_art_url = COALESCE(cover_art_url, $1::text)
             WHERE id = $2`,
            [fallbackCoverUrl, row.id]
          );
        }
        if (fallbackCoverUrl) {
          sourceFallbackApplied += 1;
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      matched += 1;
      const coverImageId = best?.cover?.image_id || null;
      const coverArtUrl = coverImageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverImageId}.jpg` : null;
      const platform = mappedPlatform(best?.platforms);
      const genre = Array.isArray(best?.genres) ? best.genres.map((g) => g?.name).find(Boolean) || null : null;
      const metadata = {
        ...(row.metadata || {}),
        igdbId: best.id,
        igdbName: best.name || row.title,
        igdbCoverImageId: coverImageId || null,
        igdbPlatforms: Array.isArray(best?.platforms) ? best.platforms.map((p) => p?.name).filter(Boolean) : []
      };

      if (!dryRun) {
        await client.query(
          `UPDATE games_normalized
           SET source_key = CASE
                              WHEN source_key IS NULL
                                OR source_key = ''
                                OR source_key LIKE 'thegamesdb:%'
                              THEN $1::text
                              ELSE source_key
                            END,
               platform = CASE
                            WHEN (platform IS NULL OR platform IN ('Unknown', 'Manual')) AND $2::text IS NOT NULL
                            THEN $2::text
                            ELSE platform
                          END,
               genre = CASE
                         WHEN (genre IS NULL OR genre = 'Unknown') AND $3::text IS NOT NULL
                         THEN $3::text
                         ELSE genre
                       END,
               cover_art_url = COALESCE($4::text, cover_art_url),
               metadata = $5::jsonb
           WHERE id = $6`,
          [`igdb:${best.id}`, platform, genre, coverArtUrl, JSON.stringify(metadata), row.id]
        );
      }
      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun,
          scanned,
          matched,
          updated,
          skipped,
          sourceFallbackApplied
        },
        null,
        2
      )
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
