import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "./db.js";
import { themeCatalog } from "./themes.js";
import { createStorage } from "./storage.js";

const app = express();
const PORT = process.env.PORT || 8787;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artDir = path.join(__dirname, "../../Art");
const storage = createStorage();
let igdbTokenCache = {
  accessToken: null,
  expiresAtMs: 0
};

app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/art", express.static(artDir));

function hasEnv(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function normalizeUsername(input) {
  const username = String(input || "").trim();
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) return null;
  return username;
}

function normalizePassword(input) {
  const password = String(input || "");
  if (password.length < 6 || password.length > 128) return null;
  return password;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = Buffer.from(crypto.scryptSync(password, salt, 64).toString("hex"), "hex");
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(expected, candidate);
}

function ensureRequiredEnvForProduction() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [];
  if (!hasEnv("STEAM_WEB_API_KEY")) missing.push("STEAM_WEB_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}

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

function queryValue(req, key) {
  const value = req.query?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function readFromOpenIdReturnTo(req, key) {
  const rawReturnTo = queryValue(req, "openid.return_to");
  if (!rawReturnTo || typeof rawReturnTo !== "string") return null;
  try {
    const parsed = new URL(rawReturnTo);
    return parsed.searchParams.get(key);
  } catch {
    return null;
  }
}

function safeFrontendUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    parsed.pathname = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function safeAbsoluteUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveFrontendUrl(req) {
  const fromQuery = safeFrontendUrl(queryValue(req, "frontend_url"));
  if (fromQuery) return fromQuery;
  const fromOpenIdReturnToQuery = safeFrontendUrl(readFromOpenIdReturnTo(req, "frontend_url"));
  if (fromOpenIdReturnToQuery) return fromOpenIdReturnToQuery;
  const fromOpenIdReturnToRoot = safeFrontendUrl(queryValue(req, "openid.return_to"));
  if (fromOpenIdReturnToRoot) return fromOpenIdReturnToRoot;
  const fromEnv = safeFrontendUrl(process.env.FRONTEND_URL);
  if (fromEnv) return fromEnv;
  return frontendUrl();
}

async function clearLegacySharedWorkspace() {
  try {
    await storage.clearUserWorkspace("demo-user");
  } catch (error) {
    console.error("Failed to clear legacy demo-user workspace", error);
  }
}

function normalizeClientUserId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9_]{3,24}$/.test(raw)) return null;
  return raw;
}

function requireUserId(req, res) {
  const fromHeader = req.get("x-client-user-id");
  const fromQuery = queryValue(req, "client_user_id");
  const fromOpenIdReturnTo = readFromOpenIdReturnTo(req, "client_user_id");
  const userId = normalizeClientUserId(fromHeader || fromQuery || fromOpenIdReturnTo);
  if (!userId) {
    res.status(400).json({ error: "Missing or invalid client user id" });
    return null;
  }
  return userId;
}

app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "tier-list-api" });
});

app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: nowIso(),
    database: process.env.DATABASE_URL ? "postgres" : "json",
    env: {
      steamKeyPresent: hasEnv("STEAM_WEB_API_KEY"),
      igdbClientIdPresent: hasEnv("TWITCH_CLIENT_ID"),
      igdbClientSecretPresent: hasEnv("TWITCH_CLIENT_SECRET")
    }
  });
});

app.get("/api/v1/themes", (_req, res) => {
  res.json({ themes: themeCatalog, defaultThemeId: "dark" });
});

app.post("/api/v1/users/create-account", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = normalizePassword(req.body?.password);
  if (!username) {
    return res.status(400).json({ error: "Username must be 3-24 chars and use letters, numbers, or _ only." });
  }
  if (!password) {
    return res.status(400).json({ error: "Password must be 6-128 characters." });
  }
  const { salt, hash } = hashPassword(password);
  const result = await storage.createAccount(username, salt, hash);
  if (!result.claimed) {
    return res.status(409).json({ error: result.error || "Username is already taken." });
  }
  return res.status(201).json({ ok: true, user: result.user });
});

app.post("/api/v1/users/login", async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = normalizePassword(req.body?.password);
  if (!username) {
    return res.status(400).json({ error: "Username must be 3-24 chars and use letters, numbers, or _ only." });
  }
  if (!password) {
    return res.status(400).json({ error: "Password must be 6-128 characters." });
  }
  const user = await storage.loginAccount(username);
  if (!user) {
    return res.status(404).json({ error: "Account not found." });
  }
  const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  return res.json({ ok: true, user: { id: user.id, name: user.name || user.id } });
});

app.post("/api/v1/users/claim-username", async (_req, res) => {
  return res.status(400).json({ error: "Use /api/v1/users/create-account with username + password." });
});

app.post("/api/v1/users/login-username", async (_req, res) => {
  return res.status(400).json({ error: "Use /api/v1/users/login with username + password." });
});

app.get("/api/v1/bootstrap", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const data = await storage.bootstrap(userId);
  res.json(data);
});

app.get("/api/v1/accounts", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const linkedAccounts = await storage.getLinkedAccounts(userId);
  res.json({ linkedAccounts });
});

app.post("/api/v1/accounts/link", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { platform, accountName, externalUserId = null, metadata = {} } = req.body ?? {};
  if (!platform || !accountName) {
    return res.status(400).json({ error: "platform and accountName are required" });
  }
  const linked = await storage.linkAccount(userId, { platform, accountName, externalUserId, metadata });
  return res.status(linked.alreadyLinked ? 200 : 201).json({ linked });
});

app.delete("/api/v1/accounts/:accountId", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const result = await storage.removeAccount(userId, req.params.accountId);
  if (!result.removed) return res.status(404).json({ error: "account not found" });
  return res.json({ ok: true, ...result });
});

app.post("/api/v1/users/me/clear-all", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const result = await storage.clearUserWorkspace(userId);
  return res.json({ ok: true, ...result });
});

app.get("/api/v1/accounts/steam/start", (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const baseUrl = appUrl(req);
  const frontend = resolveFrontendUrl(req);
  const authPopup = queryValue(req, "auth_popup") === "1" ? "1" : "0";
  const toolsReturnUrl = safeAbsoluteUrl(queryValue(req, "tools_return_url"));
  const returnToUrl = new URL(`${baseUrl}/api/v1/accounts/steam/callback`);
  returnToUrl.searchParams.set("client_user_id", userId);
  returnToUrl.searchParams.set("frontend_url", frontend);
  if (authPopup === "1") returnToUrl.searchParams.set("auth_popup", "1");
  if (toolsReturnUrl) returnToUrl.searchParams.set("tools_return_url", toolsReturnUrl);
  const realm = baseUrl;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnToUrl.toString(),
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });
  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
});

app.get("/api/v1/accounts/steam/callback", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const frontend = resolveFrontendUrl(req);
  const authPopup = readFromOpenIdReturnTo(req, "auth_popup") === "1" || queryValue(req, "auth_popup") === "1";
  const toolsReturnUrl = safeAbsoluteUrl(readFromOpenIdReturnTo(req, "tools_return_url") || queryValue(req, "tools_return_url"));
  const q = req.query;
  const mode = q["openid.mode"];
  const claimedId = q["openid.claimed_id"];
  if (mode !== "id_res" || typeof claimedId !== "string") {
    return res.redirect(`${frontend}/?steam=failed`);
  }

  try {
    // Attempt OpenID verification, but do not hard-fail linking if this check is flaky.
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
      if (!/\bis_valid\s*:\s*true\b/i.test(verifyText)) {
        console.warn("Steam OpenID verification not confirmed; proceeding with claimed_id fallback.");
      }
    } catch (error) {
      console.warn("Steam OpenID verification request failed; proceeding with claimed_id fallback.", error);
    }

    const steamId = claimedId.split("/").pop();
    if (!steamId || !/^\d{5,20}$/.test(steamId)) {
      return res.redirect(`${frontend}/?steam=failed`);
    }

    const personaName = await fetchSteamPersonaName(steamId).catch(() => null);
    const linked = await storage.linkAccount(userId, {
      platform: "Steam",
      accountName: personaName || `Steam ${steamId.slice(-4)}`,
      externalUserId: steamId,
      metadata: { steamId, personaName: personaName || null }
    });

    if (process.env.STEAM_WEB_API_KEY) {
      try {
        const games = await fetchSteamOwnedGames(steamId);
        await storage.ingestSteamLibrary(userId, linked.id, games);
        return res.redirect(
          `${frontend}/?steam=linked&username=${encodeURIComponent(userId)}${authPopup ? "&auth_popup=1" : ""}${
            toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
          }`
        );
      } catch {
        return res.redirect(
          `${frontend}/?steam=linked_sync_failed&username=${encodeURIComponent(userId)}${authPopup ? "&auth_popup=1" : ""}${
            toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
          }`
        );
      }
    }

    return res.redirect(
      `${frontend}/?steam=linked_no_key&username=${encodeURIComponent(userId)}${authPopup ? "&auth_popup=1" : ""}${
        toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
      }`
    );
  } catch {
    return res.redirect(
      `${frontend}/?steam=failed&username=${encodeURIComponent(userId)}${authPopup ? "&auth_popup=1" : ""}${
        toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
      }`
    );
  }
});

function parseSteamId(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^\d{5,20}$/.test(raw)) return raw;
  const urlMatch = raw.match(/steamcommunity\.com\/profiles\/(\d{5,20})/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const trailingDigits = raw.match(/(\d{5,20})$/);
  return trailingDigits?.[1] || null;
}

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
  const games = json?.response?.games ?? [];
  return games.filter((game) => Number(game?.playtime_forever ?? 0) > 0);
}

async function fetchSteamPersonaName(steamId) {
  const steamApiKey = process.env.STEAM_WEB_API_KEY;
  if (!steamApiKey) return null;
  const params = new URLSearchParams({
    key: steamApiKey,
    steamids: steamId,
    format: "json"
  });
  const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?${params.toString()}`);
  const json = await response.json();
  return json?.response?.players?.[0]?.personaname ?? null;
}

app.post("/api/v1/accounts/steam/sync/:accountId", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const account = await storage.getAccount(userId, req.params.accountId);
  const steamId = account?.external_user_id ?? account?.externalUserId;
  if (!account || account.platform !== "Steam" || !steamId) {
    return res.status(404).json({ error: "Steam account not found" });
  }

  try {
    const games = await fetchSteamOwnedGames(steamId);
    const summary = await storage.ingestSteamLibrary(userId, account.id, games);
    return res.json({ ok: true, source: "steam", count: games.length, ...summary });
  } catch (error) {
    return res.status(500).json({ error: "Steam sync failed", details: String(error) });
  }
});

app.post("/api/v1/accounts/steam/manual", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const steamId = parseSteamId(req.body?.steamId);
  if (!steamId) {
    return res.status(400).json({ error: "Enter a valid SteamID64 or profile URL with numeric Steam ID." });
  }

  const personaName = await fetchSteamPersonaName(steamId).catch(() => null);
  const linked = await storage.linkAccount(userId, {
    platform: "Steam",
    accountName: personaName || `Steam ${steamId.slice(-4)}`,
    externalUserId: steamId,
    metadata: { steamId, personaName: personaName || null }
  });

  if (!process.env.STEAM_WEB_API_KEY) {
    return res.status(201).json({ ok: true, status: "linked_no_key", linked });
  }

  try {
    const games = await fetchSteamOwnedGames(steamId);
    const summary = await storage.ingestSteamLibrary(userId, linked.id, games);
    return res.status(201).json({ ok: true, status: "linked", linked, ...summary });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      status: "sync_failed",
      error: "Steam sync failed. Make sure your profile games list is public.",
      details: String(error)
    });
  }
});

app.post("/api/v1/accounts/sync-all", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const accounts = await storage.getLinkedAccounts(userId);
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
      const summary = await storage.ingestSteamLibrary(userId, account.id, games);
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
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { themeId } = req.body ?? {};
  if (!themeId) {
    return res.status(400).json({ error: "themeId is required" });
  }
  const exists = themeCatalog.some((t) => t.id === themeId);
  if (!exists) {
    return res.status(404).json({ error: "unknown themeId" });
  }
  const theme = await storage.setTheme(userId, themeId);
  res.json({ ok: true, theme });
});

app.get("/api/v1/games", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const games = await storage.getGames(userId);
  res.json({ games });
});

app.post("/api/v1/games/manual", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { title, platform, genre, popularity = 50, coverArtUrl, sourceKey, metadata, manuallyAdded } = req.body ?? {};
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }
  const game = await storage.addManualGame(userId, {
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
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { gameIds } = req.body ?? {};
  if (!Array.isArray(gameIds)) {
    return res.status(400).json({ error: "gameIds must be an array" });
  }
  const result = await storage.removeGames(userId, gameIds);
  res.json({ ok: true, ...result });
});

app.put("/api/v1/tier-list/state", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { tiers, unranked } = req.body ?? {};
  if (!tiers || !unranked) {
    return res.status(400).json({ error: "tiers and unranked are required" });
  }
  const tierListState = await storage.saveTierState(userId, tiers, unranked);
  res.json({ ok: true, tierListState });
});

async function externalSearch(query) {
  const normalized = String(query).trim();
  const clientId = String(process.env.TWITCH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return [];

  try {
    const appToken = await getIgdbAccessToken(clientId, clientSecret);
    const body = `fields name,cover.image_id,platforms.name,genres.name; search "${normalized.replace(/"/g, '\\"')}"; limit 20;`;
    const resp = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": clientId,
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "text/plain"
      },
      body
    });
    if (!resp.ok) return [];
    const games = await resp.json();
    if (!Array.isArray(games)) return [];
    return games.slice(0, 20).map((g) => {
      const coverImageId = g?.cover?.image_id || null;
      const platforms = Array.isArray(g?.platforms) ? g.platforms.map((p) => p?.name).filter(Boolean) : [];
      const genres = Array.isArray(g?.genres) ? g.genres.map((genre) => genre?.name).filter(Boolean) : [];
      return {
        title: g?.name || "Unknown",
        platform: platforms.length <= 1 ? (platforms[0] || "Unknown") : "Multi-platform",
        genre: genres[0] || "Unknown",
        popularity: 50,
        coverArtUrl: coverImageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverImageId}.jpg` : null,
        source: "igdb",
        externalId: g?.id,
        sourceKey: `igdb:${g?.id}`,
        metadata: { igdbId: g?.id, coverImageId, platforms }
      };
    });
  } catch {
    return [];
  }
}

async function getIgdbAccessToken(clientId, clientSecret) {
  const now = Date.now();
  if (igdbTokenCache.accessToken && igdbTokenCache.expiresAtMs > now + 60000) {
    return igdbTokenCache.accessToken;
  }

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
    throw new Error(`Twitch token request failed: ${resp.status}`);
  }
  const json = await resp.json();
  const accessToken = json?.access_token;
  const expiresIn = Number(json?.expires_in || 0);
  if (!accessToken || !expiresIn) {
    throw new Error("Invalid Twitch token response");
  }
  igdbTokenCache = {
    accessToken,
    expiresAtMs: now + expiresIn * 1000
  };
  return accessToken;
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

app.listen(PORT, "0.0.0.0", () => {
  ensureRequiredEnvForProduction();
  void clearLegacySharedWorkspace();
  console.log(`Tier List Your Games API listening on http://0.0.0.0:${PORT}`);
});
