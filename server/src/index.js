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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artDir = path.join(__dirname, "../../Art");
const storage = createStorage();
const STUDIO_AUTH_BASE = String(process.env.STUDIO_AUTH_BASE || "https://api.studiojpg.co").replace(/\/$/, "");
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

async function fetchStudioAuthUser(req) {
  try {
    const resp = await fetch(`${STUDIO_AUTH_BASE}/api/auth/me`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: req.headers.cookie || "",
        Authorization: req.headers.authorization || ""
      }
    });
    if (!resp.ok) return null;
    const payload = await resp.json().catch(() => null);
    const rawUser =
      payload?.user ??
      payload?.data?.user ??
      payload?.data ??
      payload?.result?.user ??
      payload?.result ??
      payload;
    const userId = String(rawUser?.user_id || rawUser?.id || "").trim();
    if (!userId) return null;
    const username = String(rawUser?.username || rawUser?.name || userId).trim() || userId;
    const email = String(rawUser?.email || "").trim() || null;
    return { userId, username, email, raw: rawUser };
  } catch {
    return null;
  }
}

async function requireAuthenticatedUser(req, res) {
  const authUser = await fetchStudioAuthUser(req);
  if (!authUser) {
    res.status(401).json({ error: "Authentication required." });
    return null;
  }
  return authUser;
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

app.get("/api/tierlist/themes", (_req, res) => {
  res.json({ themes: themeCatalog, defaultThemeId: "dark" });
});

app.get("/api/tierlist/auth/me", async (req, res) => {
  const authUser = await fetchStudioAuthUser(req);
  if (!authUser) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return res.json({
    ok: true,
    user: {
      id: authUser.userId,
      user_id: authUser.userId,
      username: authUser.username,
      email: authUser.email
    }
  });
});

app.get("/api/tierlist/bootstrap", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const data = await storage.bootstrap(authUser.userId);
  res.json({
    ...data,
    user: {
      id: authUser.userId,
      user_id: authUser.userId,
      name: authUser.username,
      username: authUser.username,
      email: authUser.email
    }
  });
});

app.get("/api/accounts/connections", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const linkedAccounts = await storage.getLinkedAccounts(userId);
  res.json({ connections: linkedAccounts });
});

app.post("/api/accounts/connections", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const { platform, accountName, externalUserId = null, metadata = {} } = req.body ?? {};
  if (!platform || !accountName) {
    return res.status(400).json({ error: "platform and accountName are required" });
  }
  const linked = await storage.linkAccount(userId, { platform, accountName, externalUserId, metadata });
  return res.status(linked.alreadyLinked ? 200 : 201).json({ linked });
});

app.delete("/api/accounts/connections/:connectionId", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const result = await storage.removeAccount(userId, req.params.connectionId);
  if (!result.removed) return res.status(404).json({ error: "account not found" });
  return res.json({ ok: true, ...result });
});

app.post("/api/tierlist/users/me/clear-all", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const result = await storage.clearUserWorkspace(userId);
  return res.json({ ok: true, ...result });
});

function buildSteamStartUrl(req) {
  const baseUrl = appUrl(req);
  const frontend = safeFrontendUrl(req.body?.frontend_url) || resolveFrontendUrl(req);
  const authPopup = String(req.body?.auth_popup ?? queryValue(req, "auth_popup") ?? "0") === "1" ? "1" : "0";
  const toolsReturnUrl = safeAbsoluteUrl(req.body?.tools_return_url || queryValue(req, "tools_return_url"));
  const returnToUrl = new URL(`${baseUrl}/api/accounts/steam/callback`);
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
  return `https://steamcommunity.com/openid/login?${params.toString()}`;
}

app.get("/api/accounts/steam/start", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  res.redirect(buildSteamStartUrl(req));
});

app.post("/api/accounts/steam/start", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  return res.json({ ok: true, url: buildSteamStartUrl(req) });
});

app.get("/api/accounts/steam/callback", async (req, res) => {
  const authUser = await fetchStudioAuthUser(req);
  const userId = authUser?.userId || "";
  const frontend = resolveFrontendUrl(req);
  if (!userId) {
    return res.redirect(`${frontend}/?steam=failed_auth`);
  }
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
          `${frontend}/?steam=linked${authPopup ? "&auth_popup=1" : ""}${
            toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
          }`
        );
      } catch {
        return res.redirect(
          `${frontend}/?steam=linked_sync_failed${authPopup ? "&auth_popup=1" : ""}${
            toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
          }`
        );
      }
    }

    return res.redirect(
      `${frontend}/?steam=linked_no_key${authPopup ? "&auth_popup=1" : ""}${
        toolsReturnUrl ? `&tools_return_url=${encodeURIComponent(toolsReturnUrl)}` : ""
      }`
    );
  } catch {
    return res.redirect(
      `${frontend}/?steam=failed${authPopup ? "&auth_popup=1" : ""}${
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

app.post("/api/accounts/steam/sync/:connectionId", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const account = await storage.getAccount(userId, req.params.connectionId);
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

app.post("/api/accounts/steam/manual", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
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

app.post("/api/accounts/sync-all", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
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

app.put("/api/tierlist/users/me/theme", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
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

app.get("/api/tierlist/games", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const games = await storage.getGames(userId);
  res.json({ games });
});

app.get("/api/tierlist/games/removed", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const games = await storage.getRemovedGames(userId);
  res.json({ games });
});

app.post("/api/tierlist/games/manual", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
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

app.post("/api/tierlist/games/remove", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const { gameIds } = req.body ?? {};
  if (!Array.isArray(gameIds)) {
    return res.status(400).json({ error: "gameIds must be an array" });
  }
  const result = await storage.removeGames(userId, gameIds);
  res.json({ ok: true, ...result });
});

app.post("/api/tierlist/games/restore", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const { gameIds } = req.body ?? {};
  if (!Array.isArray(gameIds)) {
    return res.status(400).json({ error: "gameIds must be an array" });
  }
  const result = await storage.restoreGames(userId, gameIds);
  res.json({ ok: true, ...result });
});

app.post("/api/tierlist/games/backfill-covers", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
  const { gameIds } = req.body ?? {};
  const requestedIds = Array.isArray(gameIds) ? Array.from(new Set(gameIds.map((id) => String(id)))) : [];
  const games = await storage.getGames(userId);
  const candidates = requestedIds.length
    ? games.filter((game) => requestedIds.includes(String(game.id)))
    : games.filter((game) => !String(game.coverArtUrl || "").trim());
  const updatedGames = [];
  for (const game of candidates) {
    try {
      const results = await externalSearch(game.title);
      const best = pickBestExternalCoverMatch(game, results);
      if (!best?.coverArtUrl) continue;
      const patch = {
        igdbId: best.metadata?.igdbId || null,
        coverImageId: best.metadata?.coverImageId || null,
        platforms: best.metadata?.platforms || [],
        developers: best.metadata?.developers || [],
        publishers: best.metadata?.publishers || [],
        creators: best.metadata?.creators || []
      };
      const outcome = await storage.updateGameCover(userId, game.id, best.coverArtUrl, patch);
      if (outcome?.updated && outcome?.game) {
        updatedGames.push(outcome.game);
      }
    } catch {
      // best-effort per-game backfill
    }
  }
  return res.json({ ok: true, scanned: candidates.length, updated: updatedGames.length, games: updatedGames });
});

app.put("/api/tierlist/tier-list/state", async (req, res) => {
  const authUser = await requireAuthenticatedUser(req, res);
  if (!authUser) return;
  const userId = authUser.userId;
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
    const body = `fields name,cover.image_id,platforms.name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher; search "${normalized.replace(/"/g, '\\"')}"; limit 20;`;
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
      const companies = Array.isArray(g?.involved_companies) ? g.involved_companies : [];
      const developers = companies
        .filter((entry) => Boolean(entry?.developer))
        .map((entry) => entry?.company?.name)
        .filter(Boolean);
      const publishers = companies
        .filter((entry) => Boolean(entry?.publisher))
        .map((entry) => entry?.company?.name)
        .filter(Boolean);
      const creators = Array.from(new Set([...developers, ...publishers]));
      return {
        title: g?.name || "Unknown",
        platform: platforms.length <= 1 ? (platforms[0] || "Unknown") : "Multi-platform",
        genre: genres[0] || "Unknown",
        popularity: 50,
        coverArtUrl: coverImageId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverImageId}.jpg` : null,
        source: "igdb",
        externalId: g?.id,
        sourceKey: `igdb:${g?.id}`,
        metadata: { igdbId: g?.id, coverImageId, platforms, developers, publishers, creators }
      };
    });
  } catch {
    return [];
  }
}

function normalizedTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function scoreExternalMatch(game, candidate) {
  const gameKey = normalizedTitleKey(game?.title);
  const candidateKey = normalizedTitleKey(candidate?.title);
  let score = 0;
  if (!candidate?.coverArtUrl) score -= 10;
  if (candidateKey && gameKey && candidateKey === gameKey) score += 100;
  else if (candidateKey && gameKey && candidateKey.includes(gameKey)) score += 70;
  else if (candidateKey && gameKey && gameKey.includes(candidateKey)) score += 50;
  const platform = String(game?.platform || "").toLowerCase();
  const platforms = Array.isArray(candidate?.metadata?.platforms)
    ? candidate.metadata.platforms.map((p) => String(p).toLowerCase())
    : [];
  if (platform.includes("steam") && platforms.some((p) => p.includes("steam") || p.includes("pc"))) score += 15;
  return score;
}

function pickBestExternalCoverMatch(game, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreExternalMatch(game, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best || !best.coverArtUrl) return null;
  return best;
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

app.post("/api/tierlist/metadata/search/local", async (req, res) => {
  const { query } = req.body ?? {};
  if (!query || String(query).trim().length < 2) {
    return res.status(400).json({ error: "query must be at least 2 characters" });
  }
  const results = await storage.searchCatalog(query);
  return res.json({ source: "local", results });
});

app.post("/api/tierlist/metadata/search/external", async (req, res) => {
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

app.post("/api/tierlist/metadata/search", async (req, res) => {
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
  console.log(`Tier List Your Games API listening on http://0.0.0.0:${PORT}`);
});
