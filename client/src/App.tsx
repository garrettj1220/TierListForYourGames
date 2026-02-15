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

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .split(/\s+/)[0]
  .replace(/\/$/, "");
const TIER_KEYS: TierKey[] = ["S", "A", "B", "C", "D", "F"];
const DEFAULT_TIER_STATE: TierListState = { tiers: { S: [], A: [], B: [], C: [], D: [], F: [] }, unranked: [], updatedAt: null };
const DRAG_EDGE_HYSTERESIS_PX = 4;
const ACCOUNT_PLATFORMS = ["Steam", "Xbox", "PlayStation"];
const CLIENT_USER_STORAGE_KEY = "tierlist_client_user_id";
const USERNAME_STORAGE_KEY = "tierlist_username";
const POST_AUTH_SCREEN_STORAGE_KEY = "tierlist_post_auth_screen";
const THEME_STORAGE_KEY_PREFIX = "tierlist_theme_mode_";
const USER_DATA_STORAGE_KEY_PREFIX = "tierlist_user_data_";
const AUTH_RESULT_STORAGE_KEY = "tierlist_auth_result";
const AUTH_MESSAGE_TYPE = "tierlist-auth-complete";

function readStoredUsername() {
  try {
    const existing = window.localStorage.getItem(USERNAME_STORAGE_KEY) || window.localStorage.getItem(CLIENT_USER_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_]{3,24}$/.test(existing)) return existing;
  } catch {
    return "";
  }
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

function App() {
  const initialClientUserId = readStoredUsername();
  const clientUserIdRef = useRef(initialClientUserId);
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
  const [originPlaceholderActive, setOriginPlaceholderActive] = useState(false);
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);
  const [dropFlashTarget, setDropFlashTarget] = useState<DropTarget | null>(null);
  const [status, setStatus] = useState("");
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [steamManualOpen, setSteamManualOpen] = useState(false);
  const [manualSteamId, setManualSteamId] = useState("");
  const [manualSteamSaving, setManualSteamSaving] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [coverLoadFailures, setCoverLoadFailures] = useState<Record<string, true>>({});

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const dragImageRef = useRef<HTMLElement | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const dragGameIdRef = useRef<string | null>(null);
  const dragOverRef = useRef<DragLocation | null>(null);
  const tierAutosaveTimeoutRef = useRef<number | null>(null);
  const tierStateReadyRef = useRef(false);
  const lastSavedTierStateRef = useRef(serializeTierState(DEFAULT_TIER_STATE));
  const workspaceHydratedRef = useRef(false);
  const hasUsername = Boolean(username);

  function apiFetch(path: string, init: RequestInit = {}) {
    const requestUrl = new URL(apiUrl(path), window.location.origin);
    requestUrl.searchParams.set("client_user_id", clientUserIdRef.current);
    const headers = new Headers(init.headers ?? {});
    headers.set("x-client-user-id", clientUserIdRef.current);
    return fetch(requestUrl.toString(), { ...init, headers });
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
      const game = gameMap.get(id);
      const raw = String(game?.coverArtUrl || "").trim().toLowerCase();
      const hasCoverUrl = Boolean(raw && raw !== "null");
      const hasUsableCover = hasCoverUrl && !coverLoadFailures[id];
      if (hasUsableCover) withCover.push(id);
      else withoutCover.push(id);
    }
    return [...withCover, ...withoutCover];
  }, [tierState.unranked, gameMap, coverLoadFailures]);

  function markCoverLoadFailure(gameId: string) {
    setCoverLoadFailures((prev) => (prev[gameId] ? prev : { ...prev, [gameId]: true }));
  }

  useEffect(() => {
    if (!clientUserIdRef.current) {
      setScreen("setup");
      setLoading(false);
      workspaceHydratedRef.current = true;
      return;
    }

    const local = readLocalWorkspace(clientUserIdRef.current);
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
      window.localStorage.setItem(getThemeStorageKey(clientUserIdRef.current), themeMode);
    } catch {
      // ignore storage access failures
    }
  }, [themeMode]);

  useEffect(() => {
    if (!workspaceHydratedRef.current || loading) return;
    try {
      window.localStorage.setItem(
        getUserDataStorageKey(clientUserIdRef.current),
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
  }, [linkedAccounts, games, tierState, themeMode, loading]);

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
    if (touchDrag?.pointerType !== "touch") return;
    const step = () => {
      const y = dragPointerYRef.current;
      if (typeof y === "number") {
        const threshold = 130;
        const viewport = window.innerHeight;
        const topDistance = y;
        const bottomDistance = viewport - y;
        let delta = 0;
        if (topDistance < threshold) {
          const intensity = (threshold - topDistance) / threshold;
          delta = -Math.max(6, intensity * 24);
        } else if (bottomDistance < threshold) {
          const intensity = (threshold - bottomDistance) / threshold;
          delta = Math.max(6, intensity * 24);
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
    const callbackUsername = params.get("username");
    const authPopup = params.get("auth_popup") === "1";
    const toolsReturnUrl = params.get("tools_return_url");
    if (!steam) return;
    if (callbackUsername && /^[A-Za-z0-9_]{3,24}$/.test(callbackUsername)) {
      clientUserIdRef.current = callbackUsername;
      setUsername(callbackUsername);
      try {
        window.localStorage.setItem(USERNAME_STORAGE_KEY, callbackUsername);
        window.localStorage.setItem(CLIENT_USER_STORAGE_KEY, callbackUsername);
      } catch {
        // ignore storage access failures
      }
    }
    if (steam === "linked") setStatus("Steam account connected.");
    if (steam === "linked_no_key") setStatus("Steam connected. Add STEAM_WEB_API_KEY to sync games.");
    if (steam === "linked_sync_failed") setStatus("Steam connected. Game sync failed.");
    if (steam === "failed") setStatus("Steam sign-in failed.");
    const fallbackScreen: Screen = "accounts";
    let targetScreen: Screen = fallbackScreen;
    try {
      const stored = window.localStorage.getItem(POST_AUTH_SCREEN_STORAGE_KEY);
      if (stored === "setup" || stored === "accounts" || stored === "games" || stored === "editor") {
        targetScreen = stored;
      }
      window.localStorage.removeItem(POST_AUTH_SCREEN_STORAGE_KEY);
    } catch {
      targetScreen = fallbackScreen;
    }
    if (steam === "linked" || steam === "linked_no_key" || steam === "linked_sync_failed") {
      targetScreen = "accounts";
    }
    try {
      window.localStorage.setItem(
        AUTH_RESULT_STORAGE_KEY,
        JSON.stringify({
          steam,
          username: callbackUsername || clientUserIdRef.current || "",
          at: Date.now()
        })
      );
    } catch {
      // ignore storage access failures
    }
    window.history.replaceState({}, "", window.location.pathname);
    if (authPopup) {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            {
              type: AUTH_MESSAGE_TYPE,
              steam,
              username: callbackUsername || clientUserIdRef.current || ""
            },
            "*"
          );
          window.opener.focus();
        }
      } catch {
        // ignore opener errors
      }
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
    const onStorage = (event: StorageEvent) => {
      if ((event.key === USERNAME_STORAGE_KEY || event.key === CLIENT_USER_STORAGE_KEY) && event.newValue) {
        const incomingUser = String(event.newValue).trim();
        if (incomingUser && /^[A-Za-z0-9_]{3,24}$/.test(incomingUser) && incomingUser !== clientUserIdRef.current) {
          clientUserIdRef.current = incomingUser;
          setUsername(incomingUser);
          void refreshAll().then(() => setScreen("accounts"));
        }
        return;
      }
      if (event.key !== AUTH_RESULT_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        const incomingUser = String(parsed?.username || "").trim();
        if (incomingUser && /^[A-Za-z0-9_]{3,24}$/.test(incomingUser) && incomingUser !== clientUserIdRef.current) {
          clientUserIdRef.current = incomingUser;
          setUsername(incomingUser);
          window.localStorage.setItem(USERNAME_STORAGE_KEY, incomingUser);
          window.localStorage.setItem(CLIENT_USER_STORAGE_KEY, incomingUser);
        }
      } catch {
        // ignore parse failures
      }
      void refreshAll().then(() => setScreen("accounts"));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.type !== AUTH_MESSAGE_TYPE) return;
      const incomingUser = String(payload.username || "").trim();
      if (incomingUser && /^[A-Za-z0-9_]{3,24}$/.test(incomingUser)) {
        clientUserIdRef.current = incomingUser;
        setUsername(incomingUser);
        try {
          window.localStorage.setItem(USERNAME_STORAGE_KEY, incomingUser);
          window.localStorage.setItem(CLIENT_USER_STORAGE_KEY, incomingUser);
        } catch {
          // ignore storage failures
        }
      }
      void refreshAll().then(() => setScreen("accounts"));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
    if (!clientUserIdRef.current) {
      setLoading(false);
      setScreen("setup");
      return;
    }
    try {
      const bootstrapResp = await apiFetch("/api/v1/bootstrap");
      const bootstrap = await bootstrapResp.json();
      const nextAccounts = (bootstrap?.linkedAccounts ?? []) as LinkedAccount[];
      const nextGames = ((bootstrap?.games ?? []) as Game[]).map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) ?? null }));
      const nextTheme = bootstrap?.theme?.themeId === "light" ? "light" : "dark";
      const nextTierState = bootstrap?.tierListState ?? DEFAULT_TIER_STATE;

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
    if (!silent) setStatus("Saving...");
    const source = stateOverride ?? tierState;
    const resp = await apiFetch("/api/v1/tier-list/state", {
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

  async function applyUsernameSession(userId: string, nextScreen: Screen) {
    clientUserIdRef.current = userId;
    setUsername(userId);
    try {
      window.localStorage.setItem(USERNAME_STORAGE_KEY, userId);
      window.localStorage.setItem(CLIENT_USER_STORAGE_KEY, userId);
    } catch {
      // ignore storage access failures
    }
    setThemeMode(readStoredTheme(userId));
    setLoading(true);
    setScreen(nextScreen);
    await refreshAll();
    setScreen(nextScreen);
  }

  async function createUsername() {
    const draft = usernameDraft.trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(draft)) {
      setStatus("Username must be 3-24 chars and use letters, numbers, or _ only.");
      return;
    }
    setUsernameSaving(true);
    try {
      const resp = await fetch(apiUrl("/api/v1/users/claim-username"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: draft })
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setStatus(json?.error || "Could not create username.");
        return;
      }
      await applyUsernameSession(json.user.id, "accounts");
      setStatus(`Welcome, ${json.user.id}.`);
      setUsernameDraft("");
    } finally {
      setUsernameSaving(false);
    }
  }

  async function loginUsername() {
    const draft = usernameDraft.trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(draft)) {
      setStatus("Enter a valid username.");
      return;
    }
    setUsernameSaving(true);
    try {
      const resp = await fetch(apiUrl("/api/v1/users/login-username"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: draft })
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setStatus(json?.error || "Login failed.");
        return;
      }
      await applyUsernameSession(json.user.id, "stats");
      setStatus(`Signed in as ${json.user.id}.`);
      setUsernameDraft("");
    } finally {
      setUsernameSaving(false);
    }
  }

  function logoutUsername() {
    const currentUser = clientUserIdRef.current;
    clientUserIdRef.current = "";
    setUsername("");
    setLinkedAccounts([]);
    setGames([]);
    setTierState(DEFAULT_TIER_STATE);
    setThemeMode("dark");
    setScreen("setup");
    setStatus("Logged out.");
    try {
      window.localStorage.removeItem(USERNAME_STORAGE_KEY);
      window.localStorage.removeItem(CLIENT_USER_STORAGE_KEY);
      window.localStorage.removeItem(POST_AUTH_SCREEN_STORAGE_KEY);
      if (currentUser) {
        window.localStorage.removeItem(getThemeStorageKey(currentUser));
      }
    } catch {
      // ignore storage access failures
    }
  }

  async function setMode(mode: ThemeMode) {
    setThemeMode(mode);
    await apiFetch("/api/v1/users/me/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: mode })
    });
  }

  async function addSteamManual() {
    if (!manualSteamId.trim()) {
      setStatus("Enter your SteamID64 first.");
      return;
    }
    setManualSteamSaving(true);
    try {
      const resp = await apiFetch("/api/v1/accounts/steam/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamId: manualSteamId.trim() })
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        setStatus(json?.error || "Could not add Steam account.");
        setManualSteamSaving(false);
        return;
      }
      await refreshAll();
      if (json?.status === "linked_no_key") {
        setStatus("Steam linked. Add STEAM_WEB_API_KEY to sync games.");
      } else if (json?.status === "sync_failed") {
        setStatus("Steam linked, but sync failed. Ensure games list is public.");
      } else {
        setStatus("Steam account linked.");
      }
      setManualSteamId("");
      setSteamManualOpen(false);
    } catch {
      setStatus("Could not add Steam account.");
    } finally {
      setManualSteamSaving(false);
    }
  }

  async function removeAccount(accountId: string) {
    const resp = await apiFetch(`/api/v1/accounts/${accountId}`, { method: "DELETE" });
    if (!resp.ok) return;
    setLinkedAccounts((prev) => prev.filter((a) => a.id !== accountId));
  }

  function openAuthInNewTab(path: string) {
    if (!hasUsername || !clientUserIdRef.current) {
      setScreen("setup");
      setStatus("Create or log in with a username before connecting Steam.");
      return;
    }
    const authUrl = new URL(apiUrl(path));
    authUrl.searchParams.set("client_user_id", clientUserIdRef.current);
    authUrl.searchParams.set("frontend_url", window.location.origin);
    authUrl.searchParams.set("auth_popup", "1");
    if (document.referrer && /^https?:\/\//i.test(document.referrer)) {
      authUrl.searchParams.set("tools_return_url", document.referrer);
    }
    const target = authUrl.toString();
    try {
      window.localStorage.setItem(POST_AUTH_SCREEN_STORAGE_KEY, screen);
    } catch {
      // no-op if storage is unavailable
    }
    const opened = window.open(target, "_blank");
    if (!opened) {
      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = "/tools";
          return;
        }
      } catch {
        // ignore cross-window access errors
      }
      window.location.href = target;
    }
  }

  async function syncSteamAccount(accountId: string) {
    setSyncingAccountId(accountId);
    const resp = await apiFetch(`/api/v1/accounts/steam/sync/${accountId}`, { method: "POST" });
    if (resp.ok) {
      await refreshAll();
      setStatus("Steam library synced.");
    } else {
      const error = await resp.json().catch(() => null);
      setStatus(error?.error || "Steam sync failed.");
    }
    setSyncingAccountId(null);
  }

  async function syncAllAccounts() {
    setSyncingAll(true);
    const resp = await apiFetch("/api/v1/accounts/sync-all", { method: "POST" });
    if (resp.ok) {
      const json = await resp.json();
      await refreshAll();
      setStatus(`Scan complete: ${json.inserted} new, ${json.updated} updated.`);
    } else {
      const error = await resp.json().catch(() => null);
      setStatus(error?.error || "Scan failed.");
    }
    setSyncingAll(false);
  }

  async function searchGames() {
    if (searchQuery.trim().length < 2) {
      setStatus("Search needs at least 2 characters.");
      return;
    }
    setSearching(true);
    const resp = await apiFetch("/api/v1/metadata/search/external", {
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
    const resp = await apiFetch("/api/v1/games/manual", {
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

  async function removeGame(gameId: string) {
    const resp = await apiFetch("/api/v1/games/remove", {
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
    setOriginPlaceholderActive(true);
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
    setOriginPlaceholderActive(false);
    setTouchDrag(null);
    dragPointerYRef.current = null;
  }

  function locationFromPoint(x: number, y: number): DragLocation | null {
    const node = document.elementFromPoint(x, y) as HTMLElement | null;
    const cardEl = node?.closest<HTMLElement>("[data-drop-card='true']");
    if (cardEl) {
      const target = cardEl.dataset.target as DropTarget;
      const isSameCategoryDrag = dragOrigin?.target === target;
      const ids = target === "UNRANKED" ? tierState.unranked : tierState.tiers[target];
      if (!isSameCategoryDrag) {
        return { target, index: ids.length };
      }
      if (target === "UNRANKED") {
        return { target, index: ids.length };
      }
      const index = Number(cardEl.dataset.index || 0);
      const rect = cardEl.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const distanceToMid = Math.abs(x - midpoint);
      if (
        distanceToMid <= DRAG_EDGE_HYSTERESIS_PX &&
        dragOver?.target === target &&
        (dragOver.index === index || dragOver.index === index + 1)
      ) {
        return { target, index: dragOver.index };
      }
      return { target, index: x < midpoint ? index : index + 1 };
    }
    const rowEl = node?.closest<HTMLElement>("[data-drop-row='true']");
    if (rowEl) {
      const target = rowEl.dataset.target as DropTarget;
      const isSameCategoryDrag = dragOrigin?.target === target;
      const ids = target === "UNRANKED" ? tierState.unranked : tierState.tiers[target];
      if (!isSameCategoryDrag) {
        return { target, index: ids.length };
      }
      if (target === "UNRANKED") {
        return { target, index: ids.length };
      }
      const cardEls = Array.from(rowEl.querySelectorAll<HTMLElement>("[data-drop-card='true']"));
      if (cardEls.length === 0) return { target, index: 0 };

      const lastRect = cardEls[cardEls.length - 1].getBoundingClientRect();
      if (x >= lastRect.right - DRAG_EDGE_HYSTERESIS_PX && y >= lastRect.top - DRAG_EDGE_HYSTERESIS_PX) {
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
    return null;
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
          className={(hasUsername ? screen === "stats" : screen === "setup") ? "active" : ""}
          onClick={() => setScreen(hasUsername ? "stats" : "setup")}
        >
          {hasUsername ? "Stats" : "Setup"}
        </button>
        <button className={screen === "accounts" ? "active" : ""} onClick={() => setScreen("accounts")} disabled={!hasUsername}>Accounts</button>
        <button className={screen === "games" ? "active" : ""} onClick={() => setScreen("games")} disabled={!hasUsername}>Games</button>
        <button className={screen === "editor" ? "active" : ""} onClick={() => setScreen("editor")} disabled={!hasUsername}>Tier List</button>
      </nav>

      {screen === "setup" && (
        <section className="panel setup-panel">
          <h2>Setup</h2>
          <p>Create a username or log in to your existing one.</p>
          <div className="modal-search">
            <input
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
              placeholder="Username"
            />
            <button onClick={() => void createUsername()} disabled={usernameSaving}>
              {usernameSaving ? "Working..." : "Create Username"}
            </button>
            <button onClick={() => void loginUsername()} disabled={usernameSaving}>
              {usernameSaving ? "Working..." : "Login"}
            </button>
          </div>
        </section>
      )}

      {screen === "stats" && hasUsername && (
        <section className="panel setup-panel">
          <h2>Stats</h2>
          <div className="setup-stats">
            <div><strong>{games.length}</strong><span>Games</span></div>
            <div><strong>{linkedAccounts.length}</strong><span>Accounts</span></div>
          </div>
          <button className="primary" onClick={() => setScreen("accounts")}>Go to Accounts</button>
        </section>
      )}

      {screen === "accounts" && (
        <section className="panel">
          <div className="row-between">
            <h2>Accounts</h2>
            <button onClick={() => void syncAllAccounts()} disabled={syncingAll}>
              {syncingAll ? "Checking..." : "Check For New Games"}
            </button>
          </div>
          <div className="platform-cards">
            {ACCOUNT_PLATFORMS.map((platform) => (
              <article key={platform} className="platform-card">
                <h3>{platform}</h3>
                <p>{accountCounts[platform] ? `${accountCounts[platform]} connected` : "Not connected"}</p>
                {platform === "Steam" ? (
                  <div className="platform-actions">
                    <button onClick={() => openAuthInNewTab("/api/v1/accounts/steam/start")}>Connect</button>
                    <button onClick={() => setSteamManualOpen(true)}>Add Manually</button>
                  </div>
                ) : (
                  <button disabled>Not Available</button>
                )}
                <p className="auth-note">Opens in a new tab for secure sign-in.</p>
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
                  <div className="account-actions">
                    {a.platform === "Steam" && (
                      <button onClick={() => void syncSteamAccount(a.id)} disabled={syncingAccountId === a.id}>
                        {syncingAccountId === a.id ? "Syncing..." : "Sync"}
                      </button>
                    )}
                    <button className="danger" onClick={() => void removeAccount(a.id)}>Remove</button>
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
            <button className="primary" onClick={() => setAddModalOpen(true)}>Add Game</button>
          </div>
          {games.length === 0 ? (
            <p>No games.</p>
          ) : (
            <div className="game-list">
              {games.map((g) => (
                <article key={g.id} className="game-item">
                  {g.coverArtUrl ? (
                    <img src={assetUrl(g.coverArtUrl) ?? undefined} alt={g.title} />
                  ) : (
                    <div className="cover-fallback cover-fallback-list">{g.title}</div>
                  )}
                  <div>
                    <strong>{g.title}</strong>
                    <span>{g.platform}</span>
                  </div>
                  <button className="danger" onClick={() => void removeGame(g.id)}>Remove</button>
                </article>
              ))}
            </div>
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
                    const previewIndex = previewInsertIndex(tier);
                    return tierState.tiers[tier].map((id, idx) => {
                      const game = gameMap.get(id);
                      if (!game) return null;
                      const isOriginDragging =
                        dragGameId === id &&
                        originPlaceholderActive &&
                        dragOrigin?.target === tier &&
                        dragOrigin.index === idx &&
                        dragOver?.target === tier;
                      return (
                        <div key={id} className={`tier-item-slot${isOriginDragging ? " is-drag-origin" : ""}`}>
                          {dragGameId && previewIndex === idx && (
                            <div className="tier-insert-slot" aria-hidden="true" />
                          )}
                          <article
                            className={`tier-game${isOriginDragging ? " is-origin-placeholder" : ""}`}
                            data-drop-card="true"
                            data-target={tier}
                            data-index={idx}
                            onPointerDown={(e) => startTouchDrag(id, tier, idx, e)}
                            onPointerMove={onTouchPointerMove}
                          >
                            {game.coverArtUrl ? (
                                <img
                                  src={assetUrl(game.coverArtUrl) ?? undefined}
                                  alt={game.title}
                                  draggable={false}
                                  onError={() => markCoverLoadFailure(id)}
                                />
                            ) : (
                              <div className="cover-fallback cover-fallback-tier">{game.title}</div>
                            )}
                            <span>{game.title}</span>
                          </article>
                        </div>
                      );
                    });
                  })()}
                  {dragGameId && previewInsertIndex(tier) === tierState.tiers[tier].length && (
                    <div className="tier-insert-slot is-end" aria-hidden="true" />
                  )}
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
                {orderedUnrankedIds.map((id, idx) => {
                  const game = gameMap.get(id);
                  if (!game) return null;
                  const isOriginDragging =
                    dragGameId === id &&
                    originPlaceholderActive &&
                    dragOrigin?.target === "UNRANKED" &&
                    dragOrigin.index === idx &&
                    dragOver?.target === "UNRANKED";
                  return (
                    <div key={id} className={`tier-item-slot${isOriginDragging ? " is-drag-origin" : ""}`}>
                      <article
                        className={`tier-game${isOriginDragging ? " is-origin-placeholder" : ""}`}
                        data-drop-card="true"
                        data-target="UNRANKED"
                        data-index={idx}
                        onPointerDown={(e) => startTouchDrag(id, "UNRANKED", idx, e)}
                        onPointerMove={onTouchPointerMove}
                      >
                        {game.coverArtUrl ? (
                            <img
                              src={assetUrl(game.coverArtUrl) ?? undefined}
                              alt={game.title}
                              draggable={false}
                              onError={() => markCoverLoadFailure(id)}
                            />
                        ) : (
                          <div className="cover-fallback cover-fallback-tier">{game.title}</div>
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

      {steamManualOpen && (
        <div className="modal-backdrop" onClick={() => setSteamManualOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Steam Account Manually</h3>
            <p className="modal-note">Enter your SteamID64. Make sure your account games list is public.</p>
            <div className="modal-search">
              <input
                value={manualSteamId}
                onChange={(e) => setManualSteamId(e.target.value)}
                placeholder="SteamID64"
              />
              <button onClick={() => void addSteamManual()} disabled={manualSteamSaving}>
                {manualSteamSaving ? "Adding..." : "Add"}
              </button>
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
                  <div className="cover-fallback cover-fallback-tier">{game.title}</div>
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
