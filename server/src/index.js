import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "./db.js";
import { themeCatalog } from "./themes.js";
import { createStorage } from "./storage.js";

const app = express();
const PORT = process.env.PORT || 8787;
const USER_ID = "demo-user";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artDir = path.join(__dirname, "../../Art");
const storage = createStorage();

app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/art", express.static(artDir));

function appUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0].trim()
      : req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return host ? `${proto}://${host}` : `http://localhost:${PORT}`;
}

function frontendUrl() {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, timestamp: nowIso(), database: process.env.DATABASE_URL ? "postgres" : "json" });
});

app.get("/api/v1/themes", (_req, res) => {
  res.json({ themes: themeCatalog, defaultThemeId: "dark" });
});

app.get("/api/v1/bootstrap", async (_req, res) => {
  const data = await storage.bootstrap(USER_ID);
  res.json(data);
});

app.get("/api/v1/accounts", async (_req, res) => {
  const linkedAccounts = await storage.getLinkedAccounts(USER_ID);
  res.json({ linkedAccounts });
});

app.post("/api/v1/accounts/link", async (req, res) => {
  const { platform, accountName } = req.body ?? {};
  if (!platform || !accountName) {
    return res.status(400).json({ error: "platform and accountName are required" });
  }
  const linked = await storage.linkAccount(USER_ID, { platform, accountName });
  return res.status(linked.alreadyLinked ? 200 : 201).json({ linked });
});

app.delete("/api/v1/accounts/:accountId", async (req, res) => {
  const result = await storage.removeAccount(USER_ID, req.params.accountId);
  if (!result.removed) return res.status(404).json({ error: "account not found" });
  return res.json({ ok: true, ...result });
});

app.get("/api/v1/accounts/steam/start", (req, res) => {
  const baseUrl = appUrl(req);
  const returnTo = `${baseUrl}/api/v1/accounts/steam/callback`;
  const realm = baseUrl;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });
  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
});

app.get("/api/v1/accounts/steam/callback", async (req, res) => {
  const q = req.query;
  const mode = q["openid.mode"];
  const claimedId = q["openid.claimed_id"];
  if (mode !== "id_res" || typeof claimedId !== "string") {
    return res.redirect(`${frontendUrl()}/?steam=failed`);
  }

  try {
    const verifyParams = new URLSearchParams();
    for (const [key, value] of Object.entries(q)) {
      if (Array.isArray(value)) verifyParams.set(key, value[0]);
      else if (typeof value === "string") verifyParams.set(key, value);
    }
    verifyParams.set("openid.mode", "check_authentication");

    const verifyResp = await fetch("https://steamcommunity.com/openid/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyParams.toString()
    });
    const verifyText = await verifyResp.text();
    if (!verifyText.includes("is_valid:true")) {
      return res.redirect(`${frontendUrl()}/?steam=failed`);
    }

    const steamId = claimedId.split("/").pop();
    if (!steamId) {
      return res.redirect(`${frontendUrl()}/?steam=failed`);
    }

    const linked = await storage.linkAccount(USER_ID, {
      platform: "Steam",
      accountName: `Steam ${steamId.slice(-4)}`,
      externalUserId: steamId,
      metadata: { steamId }
    });

    if (process.env.STEAM_WEB_API_KEY) {
      try {
        const steamParams = new URLSearchParams({
          key: process.env.STEAM_WEB_API_KEY,
          steamid: steamId,
          include_appinfo: "1",
          include_played_free_games: "1",
          format: "json"
        });
        const steamResp = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?${steamParams.toString()}`);
        const steamJson = await steamResp.json();
        const games = steamJson?.response?.games ?? [];
        await storage.ingestSteamLibrary(USER_ID, linked.id, games);
      } catch {
        // Callback should still complete even if background sync fails.
      }
    }

    return res.redirect(`${frontendUrl()}/?steam=linked`);
  } catch {
    return res.redirect(`${frontendUrl()}/?steam=failed`);
  }
});

async function fetchSteamOwnedGames(steamId) {
  const steamApiKey = process.env.STEAM_WEB_API_KEY;
  if (!steamApiKey) {
    throw new Error("STEAM_WEB_API_KEY is required");
  }
  const params = new URLSearchParams({
    key: steamApiKey,
    steamid: steamId,
    include_appinfo: "1",
    include_played_free_games: "1",
    format: "json"
  });
  const response = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?${params.toString()}`);
  const json = await response.json();
  return json?.response?.games ?? [];
}

app.post("/api/v1/accounts/steam/sync/:accountId", async (req, res) => {
  const account = await storage.getAccount(USER_ID, req.params.accountId);
  const steamId = account?.external_user_id ?? account?.externalUserId;
  if (!account || account.platform !== "Steam" || !steamId) {
    return res.status(404).json({ error: "Steam account not found" });
  }

  try {
    const games = await fetchSteamOwnedGames(steamId);
    const summary = await storage.ingestSteamLibrary(USER_ID, account.id, games);
    return res.json({ ok: true, source: "steam", count: games.length, ...summary });
  } catch (error) {
    return res.status(500).json({ error: "Steam sync failed", details: String(error) });
  }
});

app.post("/api/v1/accounts/sync-all", async (_req, res) => {
  const accounts = await storage.getLinkedAccounts(USER_ID);
  const result = {
    scanned: accounts.length,
    inserted: 0,
    updated: 0,
    synced: 0,
    skipped: []
  };

  for (const account of accounts) {
    const platform = String(account.platform || "");
    if (platform !== "Steam") {
      result.skipped.push({ accountId: account.id, platform, reason: "Sync not implemented for this platform yet" });
      continue;
    }
    const steamId = account.external_user_id ?? account.externalUserId;
    if (!steamId) {
      result.skipped.push({ accountId: account.id, platform, reason: "Missing Steam user id" });
      continue;
    }
    try {
      const games = await fetchSteamOwnedGames(steamId);
      const summary = await storage.ingestSteamLibrary(USER_ID, account.id, games);
      result.synced += 1;
      result.inserted += Number(summary.inserted ?? 0);
      result.updated += Number(summary.updated ?? 0);
    } catch (error) {
      result.skipped.push({ accountId: account.id, platform, reason: String(error) });
    }
  }

  return res.json({ ok: true, ...result });
});

app.put("/api/v1/users/me/theme", async (req, res) => {
  const { themeId } = req.body ?? {};
  if (!themeId) {
    return res.status(400).json({ error: "themeId is required" });
  }
  const exists = themeCatalog.some((t) => t.id === themeId);
  if (!exists) {
    return res.status(404).json({ error: "unknown themeId" });
  }
  const theme = await storage.setTheme(USER_ID, themeId);
  res.json({ ok: true, theme });
});

app.get("/api/v1/games", async (_req, res) => {
  const games = await storage.getGames(USER_ID);
  res.json({ games });
});

app.post("/api/v1/games/manual", async (req, res) => {
  const { title, platform, genre, popularity = 50, coverArtUrl, sourceKey, metadata, manuallyAdded } = req.body ?? {};
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }
  const game = await storage.addManualGame(USER_ID, {
    title,
    platform,
    genre,
    popularity,
    coverArtUrl,
    sourceKey,
    metadata,
    manuallyAdded
  });
  res.status(201).json({ game });
});

app.post("/api/v1/games/remove", async (req, res) => {
  const { gameIds } = req.body ?? {};
  if (!Array.isArray(gameIds)) {
    return res.status(400).json({ error: "gameIds must be an array" });
  }
  const result = await storage.removeGames(USER_ID, gameIds);
  res.json({ ok: true, ...result });
});

app.put("/api/v1/tier-list/state", async (req, res) => {
  const { tiers, unranked } = req.body ?? {};
  if (!tiers || !unranked) {
    return res.status(400).json({ error: "tiers and unranked are required" });
  }
  const tierListState = await storage.saveTierState(USER_ID, tiers, unranked);
  res.json({ ok: true, tierListState });
});

async function externalSearch(query) {
  const normalized = String(query).trim();
  const apiKey = process.env.THEGAMESDB_API_KEY;
  if (!apiKey) {
    const base = [
      { title: "The Legend of Zelda: Tears of the Kingdom", platform: "Nintendo", genre: "Adventure", popularity: 95 },
      { title: "Baldur's Gate 3", platform: "Steam", genre: "RPG", popularity: 97 },
      { title: "Helldivers 2", platform: "PlayStation", genre: "Shooter", popularity: 90 },
      { title: "Hades", platform: "Steam", genre: "Roguelike", popularity: 93 },
      { title: "Fortnite", platform: "Epic Games", genre: "Battle Royale", popularity: 99 }
    ];
    return base
      .filter((g) => g.title.toLowerCase().includes(normalized.toLowerCase()))
      .slice(0, 10)
      .map((g, idx) => ({
        ...g,
        source: "mock",
        externalId: `mock-${idx}-${g.title}`,
        sourceKey: `mock:${g.platform}:${g.title.toLowerCase()}`,
        coverArtUrl: `https://placehold.co/240x320/f8fafc/111827?text=${encodeURIComponent(g.title.slice(0, 18))}`,
        metadata: {}
      }));
  }

  const params = new URLSearchParams({
    apikey: apiKey,
    name: normalized
  });
  const resp = await fetch(`https://api.thegamesdb.net/v1/Games/ByGameName?${params.toString()}`);
  const json = await resp.json();
  const games = json?.data?.games ?? [];
  return games.slice(0, 20).map((g) => ({
    title: g.game_title,
    platform: g.platform || "Unknown",
    genre: "Unknown",
    popularity: 50,
    coverArtUrl: null,
    source: "thegamesdb",
    externalId: g.id,
    sourceKey: `thegamesdb:${g.id}`,
    metadata: { theGamesDbId: g.id }
  }));
}

app.post("/api/v1/metadata/search/local", async (req, res) => {
  const { query } = req.body ?? {};
  if (!query || String(query).trim().length < 2) {
    return res.status(400).json({ error: "query must be at least 2 characters" });
  }
  const results = await storage.searchCatalog(query);
  return res.json({ source: "local", results });
});

app.post("/api/v1/metadata/search/external", async (req, res) => {
  const { query } = req.body ?? {};
  if (!query || String(query).trim().length < 2) {
    return res.status(400).json({ error: "query must be at least 2 characters" });
  }
  try {
    const results = await externalSearch(query);
    return res.json({ source: "external", results });
  } catch (error) {
    return res.status(500).json({ error: "metadata search failed", details: String(error) });
  }
});

app.post("/api/v1/metadata/search", async (req, res) => {
  const { query, mode = "local" } = req.body ?? {};
  if (!query || String(query).trim().length < 2) {
    return res.status(400).json({ error: "query must be at least 2 characters" });
  }
  try {
    if (mode === "external") {
      const results = await externalSearch(query);
      return res.json({ source: "external", results });
    }
    const results = await storage.searchCatalog(query);
    return res.json({ source: "local", results });
  } catch (error) {
    return res.status(500).json({ error: "metadata search failed", details: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`Tier List Your Games API listening on http://localhost:${PORT}`);
});
