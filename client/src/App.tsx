import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type Screen = "setup" | "stats" | "accounts" | "games" | "editor";
type TierKey = "S" | "A" | "B" | "C" | "D" | "F";
type ThemeMode = "dark" | "light";
type DropTarget = TierKey | "UNRANKED";
type DragLocation = { target: DropTarget; index: number };
type TouchDragState = {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

type Game = {
  id: string;
  sourceKey?: string | null;
  title: string;
  platform: string;
  genre: string;
  popularity: number;
  playtimeMinutes: number;
  coverArtUrl: string | null;
  manuallyAdded: boolean;
};

type LinkedAccount = {
  id: string;
  platform: string;
  accountName: string;
  externalUserId?: string;
  syncStatus?: string;
};

type TierListState = {
  tiers: Record<TierKey, string[]>;
  unranked: string[];
  updatedAt: string | null;
};

type SearchResult = {
  id?: string;
  sourceKey?: string;
  source?: string;
  title: string;
  platform: string;
  genre: string;
  popularity: number;
  coverArtUrl: string | null;
  metadata?: Record<string, unknown>;
};

function normalizeApiBase(rawValue: unknown): string {
  const firstToken = String(rawValue ?? "")
    .trim()
    .split(/\s+/)[0]
    .replace(/\/+$/, "");
  if (!firstToken) return "";
  if (/^https?:\/\//i.test(firstToken)) return firstToken;
  if (firstToken.startsWith("//")) return `https:${firstToken}`;
  return `https://${firstToken}`;
}

function normalizePathBase(rawValue: unknown, fallback = "/tools/tierlist/"): string {
  const firstToken = String(rawValue ?? "")
    .trim()
    .split(/\s+/)[0];
  const base = firstToken || fallback;
  if (/^https?:\/\//i.test(base)) {
    return base.endsWith("/") ? base : `${base}/`;
  }
  const withLeadingSlash = base.startsWith("/") ? base : `/${base}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const runtimeApiBase =
  typeof window !== "undefined"
    ? (window as Window & { STUDIOJPG_API_BASE?: string }).STUDIOJPG_API_BASE || ""
    : "";
const API_BASE = normalizeApiBase(runtimeApiBase || import.meta.env.VITE_API_BASE_URL || "https://api.studiojpg.co");
const STUDIO_WEB_BASE = normalizeApiBase(import.meta.env.VITE_STUDIO_WEB_BASE || "https://www.studiojpg.co");
const APP_BASE_PATH = normalizePathBase(import.meta.env.BASE_URL || import.meta.env.VITE_APP_BASE_PATH || "/tools/tierlist/");
const TIER_KEYS: TierKey[] = ["S", "A", "B", "C", "D", "F"];
const DEFAULT_TIER_STATE: TierListState = { tiers: { S: [], A: [], B: [], C: [], D: [], F: [] }, unranked: [], updatedAt: null };
const DRAG_EDGE_HYSTERESIS_PX = 7;
const AUTO_SCROLL_EDGE_THRESHOLD_PX = 130;
const AUTO_SCROLL_HOLD_MS = 900;
const COVER_EMPTY_VALUES = new Set(["", "null", "undefined", "n/a", "na"]);
const ACCOUNT_PLATFORMS = ["Steam", "Xbox", "PlayStation"];
const THEME_STORAGE_KEY_PREFIX = "tierlist_theme_mode_";
const USER_DATA_STORAGE_KEY_PREFIX = "tierlist_user_data_";

function readStoredUsername() {
  return "";
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function assetUrl(path?: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
  if (path.startsWith("/")) return API_BASE ? `${API_BASE}${path}` : path;
  return path;
}

function serializeTierState(state: TierListState) {
  return JSON.stringify({ tiers: state.tiers, unranked: state.unranked });
}

function getUserDataStorageKey(userId: string) {
  return `${USER_DATA_STORAGE_KEY_PREFIX}${userId}`;
}

function getThemeStorageKey(userId: string) {
  return `${THEME_STORAGE_KEY_PREFIX}${userId}`;
}

function readStoredTheme(userId: string): ThemeMode {
  try {
    const stored = window.localStorage.getItem(getThemeStorageKey(userId));
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore storage access failures
  }
  return "dark";
}

function readLocalWorkspace(userId: string) {
  try {
    const raw = window.localStorage.getItem(getUserDataStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      linkedAccounts: Array.isArray(parsed.linkedAccounts) ? (parsed.linkedAccounts as LinkedAccount[]) : [],
      games: Array.isArray(parsed.games) ? (parsed.games as Game[]) : [],
      tierState: parsed.tierState && typeof parsed.tierState === "object" ? (parsed.tierState as TierListState) : DEFAULT_TIER_STATE,
      themeMode: parsed.themeMode === "light" || parsed.themeMode === "dark" ? (parsed.themeMode as ThemeMode) : "dark"
    };
  } catch {
    return null;
  }
}

function normalizeConnection(row: Record<string, unknown>): LinkedAccount {
  return {
    id: String(row.id || row.connectionId || ""),
    platform: String(row.platform || row.provider || "Unknown"),
    accountName: String(row.accountName || row.account_name || row.displayName || row.external_username || "Connected"),
    externalUserId: row.externalUserId ? String(row.externalUserId) : row.external_user_id ? String(row.external_user_id) : undefined,
    syncStatus: row.syncStatus ? String(row.syncStatus) : row.sync_status ? String(row.sync_status) : undefined
  };
}

function extractCanonicalUsername(payload: any): string {
  const rawUser =
    payload?.user ??
    payload?.data?.user ??
    payload?.data ??
    payload?.result?.user ??
    payload?.result ??
    payload;
  return String(rawUser?.username || rawUser?.name || rawUser?.id || rawUser?.user_id || "").trim();
}

function App() {
  const initialClientUserId = readStoredUsername();
  const [username, setUsername] = useState(initialClientUserId);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("setup");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredTheme(initialClientUserId));
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tierState, setTierState] = useState<TierListState>(DEFAULT_TIER_STATE);
  const [dragGameId, setDragGameId] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<DragLocation | null>(null);
  const [dragOver, setDragOver] = useState<DragLocation | null>(null);
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);
  const [dropFlashTarget, setDropFlashTarget] = useState<DropTarget | null>(null);
  const [status, setStatus] = useState("");
  const [authMissing, setAuthMissing] = useState(false);
  const [guestMode, setGuestMode] = useState(false);
  const [syncingMissingGames, setSyncingMissingGames] = useState(false);
  const [coverLoadFailures, setCoverLoadFailures] = useState<Record<string, true>>({});

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [gamesSearchInput, setGamesSearchInput] = useState("");
  const [gamesSearchQuery, setGamesSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const dragImageRef = useRef<HTMLElement | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollEdgeEnteredAtRef = useRef<number | null>(null);
  const autoScrollEdgeDirectionRef = useRef<-1 | 0 | 1>(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const dragGameIdRef = useRef<string | null>(null);
  const dragOverRef = useRef<DragLocation | null>(null);
  const tierAutosaveTimeoutRef = useRef<number | null>(null);
  const tierStateReadyRef = useRef(false);
  const lastSavedTierStateRef = useRef(serializeTierState(DEFAULT_TIER_STATE));
  const workspaceHydratedRef = useRef(false);
  const hasUsername = Boolean(username);
  const canUseApp = hasUsername || guestMode;

  function apiFetch(path: string, init: RequestInit = {}) {
    const requestUrl = new URL(apiUrl(path), window.location.origin);
    return fetch(requestUrl.toString(), { ...init, credentials: "include" });
  }

  const gameMap = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) map.set(g.id, g);
    return map;
  }, [games]);

  const accountCounts = useMemo(() => {
    return ACCOUNT_PLATFORMS.reduce<Record<string, number>>((acc, platform) => {
      acc[platform] = linkedAccounts.filter((a) => a.platform === platform).length;
      return acc;
    }, {});
  }, [linkedAccounts]);

  const orderedUnrankedIds = useMemo(() => {
    const withCover: string[] = [];
    const withoutCover: string[] = [];
    for (const id of tierState.unranked) {
      const hasUsableCover = gameHasUsableCover(gameMap.get(id), id);
      if (hasUsableCover) withCover.push(id);
      else withoutCover.push(id);
    }
    return [...withCover, ...withoutCover];
  }, [tierState.unranked, gameMap, coverLoadFailures]);

  const filteredGames = useMemo(() => {
    const newestFirst = [...games].reverse();
    const needle = gamesSearchQuery.trim().toLowerCase();
    if (!needle) return newestFirst;
    return newestFirst.filter((game) => {
      const title = String(game.title || "").toLowerCase();
      const platform = String(game.platform || "").toLowerCase();
      const genre = String(game.genre || "").toLowerCase();
      return title.includes(needle) || platform.includes(needle) || genre.includes(needle);
    });
  }, [games, gamesSearchQuery]);

  function applyGamesSearch() {
    setGamesSearchQuery(gamesSearchInput.trim());
  }

  function gameHasUsableCover(game: Game | undefined, id: string) {
    const raw = String(game?.coverArtUrl ?? "").trim().toLowerCase();
    if (COVER_EMPTY_VALUES.has(raw)) return false;
    return !coverLoadFailures[id];
  }

  function markCoverLoadFailure(gameId: string) {
    setCoverLoadFailures((prev) => (prev[gameId] ? prev : { ...prev, [gameId]: true }));
  }

  useEffect(() => {
    const local = readLocalWorkspace("studio");
    if (local) {
      setLinkedAccounts(local.linkedAccounts);
      setGames(local.games.map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) ?? null })));
      setTierState(local.tierState ?? DEFAULT_TIER_STATE);
      setThemeMode(local.themeMode ?? "dark");
      lastSavedTierStateRef.current = serializeTierState(local.tierState ?? DEFAULT_TIER_STATE);
      tierStateReadyRef.current = true;
      setScreen("stats");
      setLoading(false);
    }
    workspaceHydratedRef.current = true;
    void refreshAll();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    try {
      window.localStorage.setItem(getThemeStorageKey(username || "studio"), themeMode);
    } catch {
      // ignore storage access failures
    }
  }, [themeMode, username]);

  useEffect(() => {
    if (!workspaceHydratedRef.current || loading || !username) return;
    try {
      window.localStorage.setItem(
        getUserDataStorageKey(username),
        JSON.stringify({
          linkedAccounts,
          games,
          tierState,
          themeMode,
          updatedAt: Date.now()
        })
      );
    } catch {
      // ignore storage access failures
    }
  }, [linkedAccounts, games, tierState, themeMode, loading, username]);

  useEffect(() => {
    dragGameIdRef.current = dragGameId;
  }, [dragGameId]);

  useEffect(() => {
    if (!touchDrag) return;
    const onGlobalPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== touchDrag.pointerId) return;
      dragPointerYRef.current = event.clientY;
      setTouchDrag((prev) => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev));
      const nextLocation = locationFromPoint(event.clientX, event.clientY);
      if (!nextLocation) return;
      setDragOver((prev) => {
        if (prev && prev.target === nextLocation.target && prev.index === nextLocation.index) {
          return prev;
        }
        dragOverRef.current = nextLocation;
        return nextLocation;
      });
    };
    const onGlobalPointerFinalize = (event: PointerEvent) => {
      if (event.pointerId !== touchDrag.pointerId) return;
      const latestOver = dragOverRef.current ?? locationFromPoint(event.clientX, event.clientY);
      const gameId = dragGameIdRef.current;
      if (gameId && latestOver) {
        dropGame(gameId, latestOver.target, latestOver.index);
        return;
      }
      endDrag();
    };
    window.addEventListener("pointermove", onGlobalPointerMove);
    window.addEventListener("pointerup", onGlobalPointerFinalize);
    window.addEventListener("pointercancel", onGlobalPointerFinalize);
    return () => {
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerFinalize);
      window.removeEventListener("pointercancel", onGlobalPointerFinalize);
    };
  }, [touchDrag, locationFromPoint]);

  useEffect(() => {
    if (!dropFlashTarget) return;
    const timeout = window.setTimeout(() => setDropFlashTarget(null), 380);
    return () => window.clearTimeout(timeout);
  }, [dropFlashTarget]);

  useEffect(() => {
    if (!dragGameId) return;
    const step = () => {
      const y = dragPointerYRef.current;
      const now = performance.now();
      if (typeof y === "number") {
        const viewport = window.innerHeight;
        const topDistance = y;
        const bottomDistance = viewport - y;
        let delta = 0;
        let nextDirection: -1 | 0 | 1 = 0;
        if (topDistance < AUTO_SCROLL_EDGE_THRESHOLD_PX) {
          nextDirection = -1;
        } else if (bottomDistance < AUTO_SCROLL_EDGE_THRESHOLD_PX) {
          nextDirection = 1;
        }

        if (nextDirection === 0) {
          autoScrollEdgeDirectionRef.current = 0;
          autoScrollEdgeEnteredAtRef.current = null;
        } else {
          if (autoScrollEdgeDirectionRef.current !== nextDirection) {
            autoScrollEdgeDirectionRef.current = nextDirection;
            autoScrollEdgeEnteredAtRef.current = now;
          }
          const enteredAt = autoScrollEdgeEnteredAtRef.current ?? now;
          if (now - enteredAt >= AUTO_SCROLL_HOLD_MS) {
            if (nextDirection < 0) {
              const intensity = (AUTO_SCROLL_EDGE_THRESHOLD_PX - topDistance) / AUTO_SCROLL_EDGE_THRESHOLD_PX;
              delta = -Math.max(6, intensity * 24);
            } else {
              const intensity = (AUTO_SCROLL_EDGE_THRESHOLD_PX - bottomDistance) / AUTO_SCROLL_EDGE_THRESHOLD_PX;
              delta = Math.max(6, intensity * 24);
            }
          }
        }
        if (delta !== 0) {
          window.scrollBy({ top: delta, behavior: "auto" });
        }
      }
      autoScrollRafRef.current = window.requestAnimationFrame(step);
    };
    autoScrollRafRef.current = window.requestAnimationFrame(step);
    return () => {
      if (autoScrollRafRef.current) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = null;
      autoScrollEdgeDirectionRef.current = 0;
      autoScrollEdgeEnteredAtRef.current = null;
    };
  }, [dragGameId, touchDrag]);

  useEffect(() => {
    if (!dragGameId || touchDrag) return;
    const onWindowDragOver = (event: DragEvent) => {
      dragPointerYRef.current = event.clientY;
    };
    window.addEventListener("dragover", onWindowDragOver);
    return () => window.removeEventListener("dragover", onWindowDragOver);
  }, [dragGameId, touchDrag]);

  useEffect(() => {
    if (!dragGameId || touchDrag) return;
    const onGlobalDragCleanup = () => endDrag();
    // Let React drop handlers run first; dragend/blur are enough for cleanup.
    window.addEventListener("dragend", onGlobalDragCleanup);
    window.addEventListener("blur", onGlobalDragCleanup);
    return () => {
      window.removeEventListener("dragend", onGlobalDragCleanup);
      window.removeEventListener("blur", onGlobalDragCleanup);
    };
  }, [dragGameId, touchDrag]);

  useEffect(() => {
    if (!dragGameId) return;
    const wheelOptions: AddEventListenerOptions = { passive: false };
    const onWheelWhileDragging = (event: WheelEvent) => {
      event.preventDefault();
      window.scrollBy({ top: event.deltaY, behavior: "auto" });
    };
    window.addEventListener("wheel", onWheelWhileDragging, wheelOptions);
    return () => window.removeEventListener("wheel", onWheelWhileDragging, wheelOptions);
  }, [dragGameId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steam = params.get("steam");
    const authPopup = params.get("auth_popup") === "1";
    const toolsReturnUrl = params.get("tools_return_url");
    if (!steam) return;
    if (steam === "linked") setStatus("Steam account connected.");
    if (steam === "linked_no_key") setStatus("Steam connected. Add STEAM_WEB_API_KEY to sync games.");
    if (steam === "linked_sync_failed") setStatus("Steam connected. Game sync failed.");
    if (steam === "failed") setStatus("Steam sign-in failed.");
    if (steam === "failed_auth") setStatus("U do not have an account with us.");
    const fallbackScreen: Screen = "accounts";
    let targetScreen: Screen = fallbackScreen;
    if (steam === "linked" || steam === "linked_no_key" || steam === "linked_sync_failed") {
      targetScreen = "accounts";
    }
    window.history.replaceState({}, "", window.location.pathname);
    if (authPopup) {
      window.close();
      window.setTimeout(() => {
        if (toolsReturnUrl && /^https?:\/\//i.test(toolsReturnUrl)) {
          window.location.replace(toolsReturnUrl);
        } else {
          window.location.replace("/tools");
        }
      }, 150);
      return;
    }
    void (async () => {
      try {
        await refreshAll();
        setScreen(targetScreen);
      } catch {
        setScreen(targetScreen);
      }
    })();
  }, []);

  useEffect(() => {
    if (!tierStateReadyRef.current) return;
    const serialized = serializeTierState(tierState);
    if (serialized === lastSavedTierStateRef.current) return;
    if (tierAutosaveTimeoutRef.current) {
      window.clearTimeout(tierAutosaveTimeoutRef.current);
    }
    tierAutosaveTimeoutRef.current = window.setTimeout(() => {
      void saveTierList(tierState, true);
    }, 260);
    return () => {
      if (tierAutosaveTimeoutRef.current) {
        window.clearTimeout(tierAutosaveTimeoutRef.current);
      }
    };
  }, [tierState]);

  async function refreshAll() {
    try {
      const bootstrapResp = await apiFetch("/api/tierlist/bootstrap");
      if (bootstrapResp.status === 401) {
        setAuthMissing(true);
        setGuestMode(true);
        setUsername("");
        setLinkedAccounts([]);
        setGames([]);
        setTierState(DEFAULT_TIER_STATE);
        setStatus("Guest mode: signed out. Sign in to sync/save to cloud.");
        setScreen("stats");
        return;
      }
      if (!bootstrapResp.ok) {
        let detail = "";
        try {
          const text = (await bootstrapResp.text()).trim();
          detail = text ? ` ${text.slice(0, 120)}` : "";
        } catch {
          // ignore read errors
        }
        setGuestMode(true);
        setStatus(`Guest mode: API bootstrap failed (${bootstrapResp.status}).${detail}`);
        setScreen("stats");
        return;
      }
      const bootstrap = await bootstrapResp.json();
      let nextUsername = extractCanonicalUsername(bootstrap);
      if (!nextUsername) {
        const meResp = await apiFetch("/api/tierlist/auth/me");
        if (meResp.ok) {
          const me = await meResp.json().catch(() => null);
          nextUsername = extractCanonicalUsername(me);
        }
      }
      const nextGames = ((bootstrap?.games ?? []) as Game[]).map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) ?? null }));
      const nextTheme = bootstrap?.theme?.themeId === "light" ? "light" : "dark";
      const nextTierState = bootstrap?.tierListState ?? DEFAULT_TIER_STATE;
      const connectionsResp = await apiFetch("/api/accounts/connections");
      const connectionsJson = connectionsResp.ok ? await connectionsResp.json().catch(() => null) : null;
      const rawConnections = Array.isArray(connectionsJson?.connections)
        ? (connectionsJson.connections as Record<string, unknown>[])
        : [];
      const nextAccounts = rawConnections.map(normalizeConnection).filter((a) => a.id);

      setAuthMissing(false);
      setGuestMode(false);
      if (nextUsername) {
        setUsername(nextUsername);
      }
      setLinkedAccounts(nextAccounts);
      setGames(nextGames);
      setTierState(nextTierState);
      lastSavedTierStateRef.current = serializeTierState(nextTierState);
      tierStateReadyRef.current = true;
      setThemeMode(nextTheme);
      setScreen((s) => (s === "setup" ? "stats" : s));
    } finally {
      setLoading(false);
    }
  }

  async function saveTierList(stateOverride?: TierListState, silent = false) {
    if (!hasUsername) {
      if (!silent) {
        setStatus("Saved locally (guest mode). Sign in to save to cloud.");
        setTimeout(() => setStatus(""), 1400);
      }
      return;
    }
    if (!silent) setStatus("Saving...");
    const source = stateOverride ?? tierState;
    const resp = await apiFetch("/api/tierlist/tier-list/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiers: source.tiers, unranked: source.unranked })
    });
    if (resp.ok) {
      lastSavedTierStateRef.current = serializeTierState(source);
    }
    if (!silent) {
      setStatus(resp.ok ? "Saved" : "Save failed");
      setTimeout(() => setStatus(""), 1200);
    }
  }

  function goToStudioLogin() {
    const loginUrl = `${STUDIO_WEB_BASE}/account?mode=login&next=${encodeURIComponent(APP_BASE_PATH)}`;
    window.location.href = loginUrl;
  }

  function logoutUsername() {
    const next = encodeURIComponent(window.location.href);
    window.location.href = `${STUDIO_WEB_BASE}/logout?next=${next}`;
  }

  function goToStudioAccounts() {
    window.location.href = `${STUDIO_WEB_BASE}/account`;
  }

  async function setMode(mode: ThemeMode) {
    setThemeMode(mode);
    if (!hasUsername) return;
    await apiFetch("/api/tierlist/users/me/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: mode })
    });
  }

  async function searchGames() {
    if (!hasUsername) {
      setStatus("Sign in required for external game metadata search.");
      return;
    }
    if (searchQuery.trim().length < 2) {
      setStatus("Search needs at least 2 characters.");
      return;
    }
    setSearching(true);
    const resp = await apiFetch("/api/tierlist/metadata/search/external", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery.trim() })
    });
    const json = await resp.json().catch(() => ({ results: [] }));
    const results = (json.results ?? []).map((g: SearchResult) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl || "") }));
    setSearchResults(results);
    if (results.length === 0) setStatus("No external matches found.");
    setSearching(false);
  }

  async function addGame(result: SearchResult) {
    if (!hasUsername) {
      setStatus("Sign in required to add synced games.");
      return;
    }
    const resp = await apiFetch("/api/tierlist/games/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: result.title,
        platform: result.platform,
        genre: result.genre,
        popularity: result.popularity,
        coverArtUrl: result.coverArtUrl,
        sourceKey: result.sourceKey,
        metadata: result.metadata || {},
        manuallyAdded: true
      })
    });
    if (!resp.ok) return;
    const json = await resp.json();
    setGames((prev) => [...prev, { ...json.game, coverArtUrl: assetUrl(json.game.coverArtUrl) }]);
    setTierState((prev) => ({ ...prev, unranked: Array.from(new Set([...prev.unranked, json.game.id])) }));
    setAddModalOpen(false);
    setSearchResults([]);
    setSearchQuery("");
  }

  async function syncMissingGamesFromLinkedAccounts() {
    if (!hasUsername) {
      setStatus("Sign in required to sync from linked accounts.");
      return;
    }
    const steamConnections = linkedAccounts.filter(
      (account) => String(account.platform || "").trim().toLowerCase() === "steam" && Boolean(account.id)
    );
    if (steamConnections.length === 0) {
      setStatus("No linked Steam accounts found. Link one on the StudioJPG account page.");
      return;
    }

    setSyncingMissingGames(true);
    let successCount = 0;
    let failCount = 0;
    try {
      for (const connection of steamConnections) {
        const resp = await apiFetch(`/api/accounts/steam/sync/${connection.id}`, { method: "POST" });
        if (resp.ok) successCount += 1;
        else failCount += 1;
      }
      await refreshAll();
      if (failCount > 0) {
        setStatus(`Synced ${successCount}/${steamConnections.length} linked Steam accounts. ${failCount} failed.`);
      } else {
        setStatus(`Synced ${successCount} linked Steam account${successCount === 1 ? "" : "s"}. Missing games imported.`);
      }
    } catch {
      setStatus("Sync failed. Please try again.");
    } finally {
      setSyncingMissingGames(false);
    }
  }

  async function removeGame(gameId: string) {
    if (!hasUsername) {
      setGames((prev) => prev.filter((g) => g.id !== gameId));
      setTierState((prev) => ({
        ...prev,
        unranked: prev.unranked.filter((id) => id !== gameId),
        tiers: {
          S: prev.tiers.S.filter((id) => id !== gameId),
          A: prev.tiers.A.filter((id) => id !== gameId),
          B: prev.tiers.B.filter((id) => id !== gameId),
          C: prev.tiers.C.filter((id) => id !== gameId),
          D: prev.tiers.D.filter((id) => id !== gameId),
          F: prev.tiers.F.filter((id) => id !== gameId)
        }
      }));
      setStatus("Removed locally (guest mode).");
      return;
    }
    const resp = await apiFetch("/api/tierlist/games/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: [gameId] })
    });
    if (!resp.ok) return;
    setGames((prev) => prev.filter((g) => g.id !== gameId));
    setTierState((prev) => ({
      ...prev,
      unranked: prev.unranked.filter((id) => id !== gameId),
      tiers: {
        S: prev.tiers.S.filter((id) => id !== gameId),
        A: prev.tiers.A.filter((id) => id !== gameId),
        B: prev.tiers.B.filter((id) => id !== gameId),
        C: prev.tiers.C.filter((id) => id !== gameId),
        D: prev.tiers.D.filter((id) => id !== gameId),
        F: prev.tiers.F.filter((id) => id !== gameId)
      }
    }));
  }

  function clearTierList() {
    const confirmed = window.confirm("Reset all ranked games back to Unranked?");
    if (!confirmed) return;
    setTierState((prev) => {
      const ranked = TIER_KEYS.flatMap((tier) => prev.tiers[tier]);
      const unranked = Array.from(new Set([...prev.unranked, ...ranked]));
      return {
        ...prev,
        tiers: { S: [], A: [], B: [], C: [], D: [], F: [] },
        unranked
      };
    });
    setStatus("Tier list reset to Unranked.");
    window.setTimeout(() => setStatus(""), 1200);
  }

  function dropGame(gameId: string, target: DropTarget, insertIndex?: number) {
    const dropIndex = Math.max(0, Number(insertIndex ?? 0));
    const origin = dragOrigin;
    if (origin?.target === "UNRANKED" && target === "UNRANKED") {
      // Dragging within unranked should never reorder; keep original position.
      setDragOver(null);
      dragOverRef.current = null;
      setDragOrigin(null);
      setDragGameId(null);
      return;
    }
    setDropFlashTarget(target);
    setTierState((prev) => {
      const next: TierListState = {
        ...prev,
        tiers: { S: [...prev.tiers.S], A: [...prev.tiers.A], B: [...prev.tiers.B], C: [...prev.tiers.C], D: [...prev.tiers.D], F: [...prev.tiers.F] },
        unranked: [...prev.unranked]
      };
      let adjustedIndex = dropIndex;
      if (origin && origin.target === target && origin.index < adjustedIndex) {
        adjustedIndex -= 1;
      }
      next.unranked = next.unranked.filter((id) => id !== gameId);
      for (const key of TIER_KEYS) next.tiers[key] = next.tiers[key].filter((id) => id !== gameId);
      if (target === "UNRANKED") {
        next.unranked.splice(Math.min(adjustedIndex, next.unranked.length), 0, gameId);
      } else {
        next.tiers[target].splice(Math.min(adjustedIndex, next.tiers[target].length), 0, gameId);
      }
      return next;
    });
    setDragOver(null);
    dragOverRef.current = null;
    setDragOrigin(null);
    setDragGameId(null);
  }

  function previewInsertIndex(target: DropTarget) {
    if (!dragOver || dragOver.target !== target) return null;
    let idx = dragOver.index;
    if (dragOrigin && dragOrigin.target === target && dragOrigin.index < idx) {
      idx -= 1;
    }
    return Math.max(0, idx);
  }

  function buildTierPreviewTokens(tier: TierKey) {
    const ids = tierState.tiers[tier];
    const indexById = new Map(ids.map((id, idx) => [id, idx]));
    const withoutDragged = dragGameId ? ids.filter((id) => id !== dragGameId) : ids;
    const tokens: Array<{ kind: "card"; id: string; sourceIndex: number } | { kind: "insert" }> = withoutDragged.map((id) => ({
      kind: "card",
      id,
      sourceIndex: indexById.get(id) ?? 0
    }));
    const insertIndex = previewInsertIndex(tier);
    if (dragGameId && insertIndex !== null) {
      const clamped = Math.max(0, Math.min(insertIndex, tokens.length));
      tokens.splice(clamped, 0, { kind: "insert" });
    }
    return tokens;
  }

  async function exportPdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(18);
    doc.text("Tier List Your Games", 40, 40);
    doc.setFontSize(10);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 40, 58);
    let y = 90;
    for (const tier of TIER_KEYS) {
      const names = tierState.tiers[tier].map((id) => gameMap.get(id)?.title ?? "Unknown");
      doc.setFontSize(12);
      doc.text(`${tier} Tier`, 40, y);
      doc.setFontSize(10);
      doc.text(names.length ? names.join(", ").slice(0, 180) : "(empty)", 110, y);
      y += 24;
    }
    doc.setFontSize(12);
    doc.text("Unranked", 40, y + 8);
    doc.setFontSize(10);
    doc.text(tierState.unranked.map((id) => gameMap.get(id)?.title ?? "Unknown").join(", ").slice(0, 180) || "(empty)", 110, y + 8);
    doc.save("tier-list-your-games.pdf");
  }

  if (loading) return <div className="app-shell loading">Loading...</div>;

  function startTouchDrag(gameId: string, target: DropTarget, index: number, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragGameId(gameId);
    setDragOrigin({ target, index });
    setDragOver({ target, index });
    dragOverRef.current = { target, index };
    setTouchDrag({
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width
    });
    dragPointerYRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function endDrag() {
    if (dragImageRef.current) {
      dragImageRef.current.remove();
      dragImageRef.current = null;
    }
    setDragGameId(null);
    setDragOrigin(null);
    setDragOver(null);
    dragOverRef.current = null;
    setTouchDrag(null);
    dragPointerYRef.current = null;
  }

  function locationFromPoint(x: number, y: number): DragLocation | null {
    const node = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = node?.closest<HTMLElement>("[data-drop-row='true']");
    if (!rowEl) return null;
    const target = rowEl.dataset.target as DropTarget;
    const isSameCategoryDrag = dragOrigin?.target === target;
    const ids = target === "UNRANKED" ? orderedUnrankedIds : tierState.tiers[target];
    if (target === "UNRANKED" || !isSameCategoryDrag) {
      return { target, index: ids.length };
    }
    const cardEl = node?.closest<HTMLElement>("[data-drop-card='true']");
    if (cardEl && cardEl.dataset.target === target) {
      const index = Number(cardEl.dataset.index || 0);
      const rect = cardEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const distanceToMid = Math.abs(x - midpoint);
      const previous = dragOverRef.current;
      if (
        distanceToMid <= DRAG_EDGE_HYSTERESIS_PX &&
        previous?.target === target &&
        (previous.index === index || previous.index === index + 1)
      ) {
        return { target, index: previous.index };
      }
      return { target, index: x < midpoint ? index : index + 1 };
    }
    const cardEls = Array.from(rowEl.querySelectorAll<HTMLElement>("[data-drop-card='true'][data-target='" + target + "']"));
    if (cardEls.length === 0) return { target, index: 0 };
    const lastRect = cardEls[cardEls.length - 1].getBoundingClientRect();
    if (x >= lastRect.right && y >= lastRect.top - DRAG_EDGE_HYSTERESIS_PX) {
      return { target, index: cardEls.length };
    }
    for (let i = 0; i < cardEls.length; i += 1) {
      const rect = cardEls[i].getBoundingClientRect();
      if (y < rect.top) return { target, index: i };
      if (y <= rect.bottom) {
        const midpoint = rect.left + rect.width / 2;
        return { target, index: x < midpoint ? i : i + 1 };
      }
    }
    return { target, index: cardEls.length };
  }

  function onTouchPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
    e.preventDefault();
    dragPointerYRef.current = e.clientY;
    setTouchDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
    const nextLocation = locationFromPoint(e.clientX, e.clientY);
    if (!nextLocation) return;
    setDragOver((prev) => {
      if (prev && prev.target === nextLocation.target && prev.index === nextLocation.index) {
        return prev;
      }
      dragOverRef.current = nextLocation;
      return nextLocation;
    });
  }

  return (
    <div className={`app-shell ${screen === "editor" ? "editor-focus" : ""}`}>
      <header className="app-header">
        <div>
          <h1>Tier List Your Games</h1>
          <p>Created by GarrettJPG</p>
          <p>{hasUsername ? `@${username}` : "No username yet"}</p>
        </div>
        <div className="header-actions">
          {hasUsername && <button onClick={logoutUsername}>Log Out</button>}
          <button onClick={() => void setMode(themeMode === "dark" ? "light" : "dark")}>
            {themeMode === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button onClick={() => void exportPdf()}>Export PDF</button>
        </div>
      </header>

      {status && <div className="status-banner">{status}</div>}

      <nav className="app-nav">
        <button
          className={(canUseApp ? screen === "stats" : screen === "setup") ? "active" : ""}
          onClick={() => setScreen(canUseApp ? "stats" : "setup")}
        >
          {canUseApp ? "Stats" : "Setup"}
        </button>
        <button className={screen === "accounts" ? "active" : ""} onClick={() => setScreen("accounts")} disabled={!canUseApp}>Accounts</button>
        <button className={screen === "games" ? "active" : ""} onClick={() => setScreen("games")} disabled={!canUseApp}>Games</button>
        <button className={screen === "editor" ? "active" : ""} onClick={() => setScreen("editor")} disabled={!canUseApp}>Tier List</button>
      </nav>

      {screen === "setup" && !canUseApp && (
        <section className="panel setup-panel">
          <h2>Account Required</h2>
          <p>{authMissing ? "U do not have an account with us." : "Sign in with your StudioJPG account to continue."}</p>
          <button className="primary" onClick={goToStudioLogin}>Go To StudioJPG Login</button>
        </section>
      )}

      {screen === "stats" && canUseApp && (
        <section className="panel setup-panel">
          <h2>{guestMode ? "Guest Mode" : "Stats"}</h2>
          {guestMode && (
            <p>Cloud sync unavailable right now. You can still browse and rank locally.</p>
          )}
          <div className="setup-stats">
            <div><strong>{games.length}</strong><span>Games</span></div>
            <div><strong>{linkedAccounts.length}</strong><span>Accounts</span></div>
          </div>
          <button className="primary" onClick={() => setScreen("accounts")}>{guestMode ? "Open Accounts" : "Go to Accounts"}</button>
        </section>
      )}

      {screen === "accounts" && (
        <section className="panel">
          <div className="row-between">
            <h2>Accounts</h2>
            <button onClick={() => void refreshAll()}>Refresh</button>
          </div>
          <p className="auth-note">Link and manage Steam on the main StudioJPG account page.</p>
          <button onClick={goToStudioAccounts}>Manage Accounts on StudioJPG</button>
          <div className="platform-cards">
            {ACCOUNT_PLATFORMS.map((platform) => (
              <article key={platform} className="platform-card">
                <h3>{platform}</h3>
                <p>{accountCounts[platform] ? `${accountCounts[platform]} connected` : "Not connected"}</p>
                <button disabled>{platform === "Steam" ? "Managed on StudioJPG" : "Not Available"}</button>
              </article>
            ))}
          </div>

          <h3>Connected Accounts</h3>
          {linkedAccounts.length === 0 ? (
            <p>None</p>
          ) : (
            <ul className="account-list">
              {linkedAccounts.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.platform}</strong>
                    <span>{a.accountName}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {screen === "games" && (
        <section className="panel">
          <div className="row-between">
            <h2>Games</h2>
            <div className="header-actions">
              <button onClick={() => void syncMissingGamesFromLinkedAccounts()} disabled={syncingMissingGames || !hasUsername}>
                {syncingMissingGames ? "Syncing..." : "Sync Missing Games"}
              </button>
              <button className="primary" onClick={() => setAddModalOpen(true)}>Add Game</button>
            </div>
          </div>
          {games.length === 0 ? (
            <p>No games.</p>
          ) : (
            <>
              <input
                type="search"
                value={gamesSearchInput}
                onChange={(e) => setGamesSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  applyGamesSearch();
                }}
                placeholder="Search your games..."
                aria-label="Search your games"
              />
              <div className="header-actions">
                <button onClick={applyGamesSearch}>Search</button>
                <button
                  onClick={() => {
                    setGamesSearchInput("");
                    setGamesSearchQuery("");
                  }}
                >
                  Clear
                </button>
              </div>
              {filteredGames.length === 0 ? (
                <p>No games match your search.</p>
              ) : (
                <div className="game-list">
                  {filteredGames.map((g) => (
                    <article key={g.id} className="game-item">
                      {g.coverArtUrl ? (
                        <img src={assetUrl(g.coverArtUrl) ?? undefined} alt={g.title} />
                      ) : (
                        <div className="cover-fallback cover-fallback-list cover-fallback-empty" aria-label="No cover art" />
                      )}
                      <div className="game-meta">
                        <strong>{g.title}</strong>
                        <span>{g.platform}</span>
                      </div>
                      <button className="danger" onClick={() => void removeGame(g.id)}>Remove</button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {screen === "editor" && (
        <section className="panel">
          <div className="row-between">
            <h2>Tier List</h2>
            <div className="header-actions">
              <button onClick={() => void saveTierList()}>Save</button>
              <button className="danger" onClick={clearTierList}>Clear Tier List</button>
            </div>
          </div>
          <div className="tier-wrap">
            {TIER_KEYS.map((tier) => (
              <section
                key={tier}
                data-drop-row="true"
                data-target={tier}
                data-count={tierState.tiers[tier].length}
                className={`tier-row tier-${tier}${dropFlashTarget === tier ? " tier-drop-flash" : ""}`}
              >
                <header>
                  <span className="tier-label">{tier}</span>
                </header>
                <div className={`tier-cards tier-cards-ranked ${tierState.tiers[tier].length === 0 ? "is-empty" : ""}`}>
                  {(() => {
                    const tokens = buildTierPreviewTokens(tier);
                    return tokens.map((token, idx) => {
                      if (token.kind === "insert") {
                        return <div key={`insert-${tier}-${idx}`} className="tier-insert-slot" aria-hidden="true" />;
                      }
                      const game = gameMap.get(token.id);
                      if (!game) return null;
                      return (
                        <div key={token.id} className="tier-item-slot">
                          <article
                            className="tier-game"
                            data-drop-card="true"
                            data-target={tier}
                            data-index={token.sourceIndex}
                            onPointerDown={(e) => startTouchDrag(token.id, tier, token.sourceIndex, e)}
                            onPointerMove={onTouchPointerMove}
                          >
                            {gameHasUsableCover(game, token.id) ? (
                              <img
                                src={assetUrl(game.coverArtUrl) ?? undefined}
                                alt={game.title}
                                draggable={false}
                                onError={() => markCoverLoadFailure(token.id)}
                              />
                            ) : (
                              <div className="cover-fallback cover-fallback-tier cover-fallback-empty" aria-label="No cover art" />
                            )}
                            <span>{game.title}</span>
                          </article>
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>
            ))}

            <section
              data-drop-row="true"
              data-target="UNRANKED"
              data-count={tierState.unranked.length}
              className={`tier-row tier-pool${dropFlashTarget === "UNRANKED" ? " tier-drop-flash" : ""}`}
            >
              <header>
                <span className="tier-label">Unranked</span>
              </header>
              <div className={`tier-cards tier-cards-unranked ${orderedUnrankedIds.length === 0 ? "is-empty" : ""}`}>
                {orderedUnrankedIds
                  .filter((id) => !(dragGameId === id && dragOrigin?.target === "UNRANKED"))
                  .map((id, idx) => {
                  const game = gameMap.get(id);
                  if (!game) return null;
                  return (
                    <div key={id} className="tier-item-slot">
                      <article
                        className="tier-game"
                        data-drop-card="true"
                        data-target="UNRANKED"
                        data-index={idx}
                        onPointerDown={(e) => startTouchDrag(id, "UNRANKED", idx, e)}
                        onPointerMove={onTouchPointerMove}
                      >
                        {gameHasUsableCover(game, id) ? (
                            <img
                              src={assetUrl(game.coverArtUrl) ?? undefined}
                              alt={game.title}
                              draggable={false}
                              onError={() => markCoverLoadFailure(id)}
                            />
                        ) : (
                          <div className="cover-fallback cover-fallback-tier cover-fallback-empty" aria-label="No cover art" />
                        )}
                        <span>{game.title}</span>
                      </article>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </section>
      )}

      {addModalOpen && (
        <div className="modal-backdrop" onClick={() => setAddModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add a Game</h3>
            <div className="modal-search">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void searchGames();
                }}
                placeholder="Search title"
              />
              <button onClick={() => void searchGames()} disabled={searching}>{searching ? "Searching..." : "Search"}</button>
            </div>
            <div className="search-results">
              {searchResults.map((r) => (
                <article key={`${r.sourceKey || r.title}-${r.platform}`} className="search-item">
                  <div>
                    <strong>{r.title}</strong>
                    <span>{r.platform}</span>
                  </div>
                  <button onClick={() => void addGame(r)}>Add</button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {touchDrag && dragGameId && gameMap.get(dragGameId) && (
        <div
          className="touch-drag-ghost"
          style={{
            width: `${Math.round(touchDrag.width)}px`,
            left: `${Math.round(touchDrag.x - touchDrag.offsetX)}px`,
            top: `${Math.round(touchDrag.y - touchDrag.offsetY)}px`
          }}
        >
          {(() => {
            const game = gameMap.get(dragGameId);
            if (!game) return null;
            return (
              <>
                {game.coverArtUrl ? (
                  <img src={assetUrl(game.coverArtUrl) ?? undefined} alt={game.title} />
                ) : (
                  <div className="cover-fallback cover-fallback-tier cover-fallback-empty" aria-label="No cover art" />
                )}
                <span>{game.title}</span>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default App;
