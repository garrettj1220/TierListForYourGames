import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./App.css";

type Screen = "setup" | "stats" | "accounts" | "games" | "editor";
type TierKey = "S" | "A" | "B" | "C" | "D" | "F";
type QuickMoveTier = TierKey;
type ThemeMode = "dark" | "light";
type DropTarget = TierKey | "UNRANKED";
type DragLocation = { target: DropTarget; index: number };
type DragPointer = { x: number; y: number };
type TierSlotRect = {
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  midX: number;
  midY: number;
};
type TouchDragState = {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
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
  metadata?: Record<string, unknown>;
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

type GamesTab = "main" | "removed";
type ExportPlanMode = "single" | "tier-paged";
type ExportPagePlan = {
  tiers: TierKey[];
  cardsPerRow: number;
  cardWidth: number;
  pageIndex: number;
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
const QUICK_MOVE_TIERS: QuickMoveTier[] = ["S", "A", "B", "C", "D", "F"];
const DEFAULT_TIER_STATE: TierListState = { tiers: { S: [], A: [], B: [], C: [], D: [], F: [] }, unranked: [], updatedAt: null };
const REORDER_DEADBAND_PX = 12;
const REORDER_ROW_MERGE_PX = 28;
const REORDER_ROW_OUTSIDE_BUFFER_PX = 24;
const AUTO_SCROLL_EDGE_THRESHOLD_PX = 130;
const AUTO_SCROLL_HOLD_MS = 260;
const PDF_PAGE_WIDTH_PX = 1320;
const PDF_PAGE_HEIGHT_PX = 1020;
const PDF_CONTENT_PADDING_X = 24;
const PDF_CONTENT_PADDING_Y = 24;
const PDF_TIER_ROW_INSET_X = 16;
const PDF_TIER_STACK_GAP_PX = 7;
const PDF_TIER_ROW_BASE_PX = 54;
const PDF_TIER_ROW_GAP_PX = 8;
const PDF_CARD_ASPECT_RATIO = 374 / 264;
const PDF_CARD_TEXT_HEIGHT_PX = 28;
const PDF_TITLE_BLOCK_PX = 62;
const PDF_DATE_BLOCK_PX = 24;
const PDF_MIN_CARD_WIDTH = 60;
const PDF_MAX_CARDS_PER_ROW = 20;
const COVER_EMPTY_VALUES = new Set(["", "null", "undefined", "n/a", "na"]);
const ACCOUNT_PLATFORMS = ["Steam", "Xbox", "PlayStation"];
const THEME_STORAGE_KEY_PREFIX = "tierlist_theme_mode_";
const USER_DATA_STORAGE_KEY_PREFIX = "tierlist_user_data_";
const PDF_PREFS_STORAGE_KEY_PREFIX = "tierlist_pdf_prefs_";

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

function getPdfPrefsStorageKey(userId: string) {
  return `${PDF_PREFS_STORAGE_KEY_PREFIX}${userId}`;
}

function defaultPdfTitle(username: string) {
  const name = String(username || "").trim() || "User";
  return `${name}'s All Time Tierlist of Games`;
}

function formatDateOnly(value: Date): string {
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  const yyyy = String(value.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function sanitizePdfFileName(title: string): string {
  const trimmed = String(title || "").trim();
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return safe || "tier-list";
}

function computeTierRowCount(tierGameCount: number, cardsPerRow: number): number {
  if (tierGameCount <= 0) return 1;
  const safeCardsPerRow = Math.max(1, cardsPerRow);
  return Math.max(1, Math.ceil(tierGameCount / safeCardsPerRow));
}

function estimateTierBlockHeight(tierGameCount: number, cardsPerRow: number, cardWidth: number): number {
  const rows = computeTierRowCount(tierGameCount, cardsPerRow);
  const cardHeight = Math.max(1, cardWidth * PDF_CARD_ASPECT_RATIO + PDF_CARD_TEXT_HEIGHT_PX);
  const cardsStackHeight = rows * cardHeight + Math.max(0, rows - 1) * PDF_TIER_ROW_GAP_PX;
  return Math.ceil(PDF_TIER_ROW_BASE_PX + cardsStackHeight);
}

function estimateBoardHeight(
  cardsPerRow: number,
  cardWidth: number,
  tierCounts: Record<TierKey, number>,
  includeDate: boolean,
  includeTitle: boolean
): number {
  const stackHeight = TIER_KEYS.reduce((total, tier, idx) => {
    const tierHeight = estimateTierBlockHeight(tierCounts[tier], cardsPerRow, cardWidth);
    return total + tierHeight + (idx > 0 ? PDF_TIER_STACK_GAP_PX : 0);
  }, 0);
  return (
    PDF_CONTENT_PADDING_Y * 2 +
    (includeTitle ? PDF_TITLE_BLOCK_PX : 0) +
    stackHeight +
    (includeDate ? PDF_DATE_BLOCK_PX : 0)
  );
}

function cardsPerRowForPageWidth(pageContentWidth: number, gap: number, minCardWidth: number): number {
  const numerator = pageContentWidth + gap;
  const denominator = Math.max(1, minCardWidth + gap);
  const estimate = Math.floor(numerator / denominator);
  return Math.max(1, Math.min(PDF_MAX_CARDS_PER_ROW, estimate));
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
      removedGames: Array.isArray(parsed.removedGames) ? (parsed.removedGames as Game[]) : [],
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

function normalizeCreatorName(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "unknown") return "";
  return text;
}

function extractCreators(item: { metadata?: Record<string, unknown> | null }): string[] {
  const creators: string[] = [];
  const addCreator = (value: unknown) => {
    const next = normalizeCreatorName(value);
    if (!next) return;
    if (!creators.some((existing) => existing.toLowerCase() === next.toLowerCase())) {
      creators.push(next);
    }
  };

  const metadata = item.metadata ?? {};
  const creatorCandidates = [
    (metadata as Record<string, unknown>).creator,
    (metadata as Record<string, unknown>).studio,
    (metadata as Record<string, unknown>).developer,
    (metadata as Record<string, unknown>).publisher
  ];
  for (const candidate of creatorCandidates) addCreator(candidate);

  const creatorGroups = [
    (metadata as Record<string, unknown>).creators,
    (metadata as Record<string, unknown>).developers,
    (metadata as Record<string, unknown>).publishers
  ];
  for (const raw of creatorGroups) {
    if (!Array.isArray(raw)) continue;
    for (const name of raw) addCreator(name);
  }

  return creators;
}

function creatorSummary(item: { metadata?: Record<string, unknown> | null }): string {
  const creators = extractCreators(item);
  return creators.length ? creators.join(" • ") : "Unknown creator";
}

function App() {
  const initialClientUserId = readStoredUsername();
  const [username, setUsername] = useState(initialClientUserId);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("setup");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredTheme(initialClientUserId));
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [removedGames, setRemovedGames] = useState<Game[]>([]);
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
  const [gamesTab, setGamesTab] = useState<GamesTab>("main");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfTitleInput, setPdfTitleInput] = useState("");
  const [pdfIncludeDate, setPdfIncludeDate] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [cardMenu, setCardMenu] = useState<{ gameId: string; x: number; y: number } | null>(null);
  const dragImageRef = useRef<HTMLElement | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const autoScrollEdgeEnteredAtRef = useRef<number | null>(null);
  const autoScrollEdgeDirectionRef = useRef<-1 | 0 | 1>(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const dragResolveRafRef = useRef<number | null>(null);
  const slotRefreshRafRef = useRef<number | null>(null);
  const dragGameIdRef = useRef<string | null>(null);
  const dragOriginRef = useRef<DragLocation | null>(null);
  const dragOverRef = useRef<DragLocation | null>(null);
  const pdfExportPageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingPointerRef = useRef<DragPointer | null>(null);
  const lastResolvedPointerRef = useRef<DragPointer | null>(null);
  const lastStableLocationRef = useRef<DragLocation | null>(null);
  const tierSlotRectsRef = useRef<Record<TierKey, TierSlotRect[]>>({
    S: [],
    A: [],
    B: [],
    C: [],
    D: [],
    F: []
  });
  const touchDragRef = useRef<TouchDragState | null>(null);
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
      const creator = creatorSummary(game).toLowerCase();
      const genre = String(game.genre || "").toLowerCase();
      return title.includes(needle) || creator.includes(needle) || genre.includes(needle);
    });
  }, [games, gamesSearchQuery]);

  const pdfPreviewTitle = pdfTitleInput.trim() || defaultPdfTitle(username);
  const pdfTierCounts = useMemo(() => {
    return TIER_KEYS.reduce<Record<TierKey, number>>((acc, tier) => {
      acc[tier] = tierState.tiers[tier].length;
      return acc;
    }, { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0 });
  }, [tierState]);
  const pdfExportPlan = useMemo((): { mode: ExportPlanMode; pages: ExportPagePlan[] } => {
    const tierContentWidth = PDF_PAGE_WIDTH_PX - PDF_CONTENT_PADDING_X * 2 - PDF_TIER_ROW_INSET_X;
    const maxCardsPerRow = cardsPerRowForPageWidth(tierContentWidth, PDF_TIER_ROW_GAP_PX, PDF_MIN_CARD_WIDTH);
    let singlePagePlan: ExportPagePlan | null = null;
    for (let cardsPerRow = 1; cardsPerRow <= maxCardsPerRow; cardsPerRow += 1) {
      const computedWidth = Math.floor((tierContentWidth - (cardsPerRow - 1) * PDF_TIER_ROW_GAP_PX) / cardsPerRow);
      if (computedWidth < PDF_MIN_CARD_WIDTH) continue;
      const boardHeight = estimateBoardHeight(cardsPerRow, computedWidth, pdfTierCounts, pdfIncludeDate, true);
      if (boardHeight <= PDF_PAGE_HEIGHT_PX) {
        singlePagePlan = { tiers: [...TIER_KEYS], cardsPerRow, cardWidth: computedWidth, pageIndex: 0 };
        break;
      }
    }
    if (singlePagePlan) return { mode: "single", pages: [singlePagePlan] };
    const fallbackCardsPerRow = maxCardsPerRow;
    const fallbackCardWidth = Math.max(
      PDF_MIN_CARD_WIDTH,
      Math.floor((tierContentWidth - (fallbackCardsPerRow - 1) * PDF_TIER_ROW_GAP_PX) / fallbackCardsPerRow)
    );
    const pageCapacity = PDF_PAGE_HEIGHT_PX - PDF_CONTENT_PADDING_Y * 2 - PDF_TITLE_BLOCK_PX - (pdfIncludeDate ? PDF_DATE_BLOCK_PX : 0);
    const pages: ExportPagePlan[] = [];
    let currentTiers: TierKey[] = [];
    let currentHeight = 0;
    for (const tier of TIER_KEYS) {
      const tierHeight = estimateTierBlockHeight(pdfTierCounts[tier], fallbackCardsPerRow, fallbackCardWidth);
      const nextHeight = currentHeight + (currentTiers.length ? PDF_TIER_STACK_GAP_PX : 0) + tierHeight;
      if (currentTiers.length > 0 && nextHeight > pageCapacity) {
        pages.push({
          tiers: currentTiers,
          cardsPerRow: fallbackCardsPerRow,
          cardWidth: fallbackCardWidth,
          pageIndex: pages.length
        });
        currentTiers = [tier];
        currentHeight = tierHeight;
      } else {
        currentTiers.push(tier);
        currentHeight = nextHeight;
      }
    }
    if (currentTiers.length) {
      pages.push({
        tiers: currentTiers,
        cardsPerRow: fallbackCardsPerRow,
        cardWidth: fallbackCardWidth,
        pageIndex: pages.length
      });
    }
    return { mode: "tier-paged", pages };
  }, [pdfTierCounts, pdfIncludeDate]);

  function readStoredPdfPrefs(userId: string): { title: string; includeDate: boolean } | null {
    try {
      const raw = window.localStorage.getItem(getPdfPrefsStorageKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        title: String(parsed.title || "").trim(),
        includeDate: Boolean(parsed.includeDate)
      };
    } catch {
      return null;
    }
  }

  function writeStoredPdfPrefs(userId: string, prefs: { title: string; includeDate: boolean }) {
    try {
      window.localStorage.setItem(getPdfPrefsStorageKey(userId), JSON.stringify(prefs));
    } catch {
      // ignore storage access failures
    }
  }

  function openPdfModal() {
    const userKey = username || "guest";
    const stored = readStoredPdfPrefs(userKey);
    setPdfTitleInput(stored?.title || defaultPdfTitle(username));
    setPdfIncludeDate(stored?.includeDate ?? true);
    setPdfModalOpen(true);
  }

  function closePdfModal() {
    if (pdfExporting) return;
    setPdfModalOpen(false);
  }

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
      setRemovedGames((local.removedGames || []).map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) ?? null })));
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
          removedGames,
          tierState,
          themeMode,
          updatedAt: Date.now()
        })
      );
    } catch {
      // ignore storage access failures
    }
  }, [linkedAccounts, games, removedGames, tierState, themeMode, loading, username]);

  useEffect(() => {
    dragGameIdRef.current = dragGameId;
  }, [dragGameId]);

  useEffect(() => {
    dragOriginRef.current = dragOrigin;
  }, [dragOrigin]);

  useEffect(() => {
    touchDragRef.current = touchDrag;
  }, [touchDrag]);

  function toNoDragIndex(target: DropTarget, fullIndex: number) {
    const origin = dragOriginRef.current;
    if (origin?.target !== target) return fullIndex;
    return origin.index < fullIndex ? fullIndex - 1 : fullIndex;
  }

  function toFullIndex(target: DropTarget, noDragIndex: number) {
    const origin = dragOriginRef.current;
    if (origin?.target !== target) return noDragIndex;
    return origin.index <= noDragIndex ? noDragIndex + 1 : noDragIndex;
  }

  function captureTierSlotRects() {
    const next: Record<TierKey, TierSlotRect[]> = { S: [], A: [], B: [], C: [], D: [], F: [] };
    for (const tier of TIER_KEYS) {
      const rowEl = document.querySelector<HTMLElement>(`[data-drop-row='true'][data-target='${tier}']`);
      if (!rowEl) continue;
      const cardEls = Array.from(rowEl.querySelectorAll<HTMLElement>(`[data-drop-card='true'][data-target='${tier}']`));
      next[tier] = cardEls.map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          midX: rect.left + rect.width / 2,
          midY: rect.top + rect.height / 2
        };
      });
    }
    tierSlotRectsRef.current = next;
  }

  function scheduleTierSlotRectRefresh() {
    if (slotRefreshRafRef.current) return;
    slotRefreshRafRef.current = window.requestAnimationFrame(() => {
      slotRefreshRafRef.current = null;
      if (!dragGameIdRef.current) return;
      captureTierSlotRects();
    });
  }

  function computeSameTierNoDragIndex(target: TierKey, x: number, y: number): number {
    const slots = tierSlotRectsRef.current[target];
    if (!slots.length) return 0;
    const sortedByFlow = [...slots].sort((a, b) => {
      if (Math.abs(a.top - b.top) <= 6) return a.left - b.left;
      return a.top - b.top;
    });
    const minTop = Math.min(...sortedByFlow.map((slot) => slot.top));
    const maxBottom = Math.max(...sortedByFlow.map((slot) => slot.bottom));
    if (y < minTop - REORDER_ROW_OUTSIDE_BUFFER_PX) return 0;
    if (y > maxBottom + REORDER_ROW_OUTSIDE_BUFFER_PX) return sortedByFlow.length;

    const rows: Array<{ midY: number; slots: TierSlotRect[] }> = [];
    for (const slot of sortedByFlow) {
      const lastRow = rows[rows.length - 1];
      if (!lastRow || Math.abs(slot.midY - lastRow.midY) > REORDER_ROW_MERGE_PX) {
        rows.push({ midY: slot.midY, slots: [slot] });
      } else {
        lastRow.slots.push(slot);
        lastRow.midY = lastRow.slots.reduce((sum, candidate) => sum + candidate.midY, 0) / lastRow.slots.length;
      }
    }
    for (const row of rows) {
      row.slots.sort((a, b) => a.midX - b.midX);
    }
    const activeRow = rows.reduce((best, candidate) => {
      if (!best) return candidate;
      return Math.abs(y - candidate.midY) < Math.abs(y - best.midY) ? candidate : best;
    }, rows[0]);

    const rowSlots = activeRow.slots;
    if (!rowSlots.length) return 0;
    if (x <= rowSlots[0].left) return rowSlots[0].index;
    if (x >= rowSlots[rowSlots.length - 1].right) return rowSlots[rowSlots.length - 1].index + 1;
    for (const slot of rowSlots) {
      if (x < slot.midX) return slot.index;
    }
    return rowSlots[rowSlots.length - 1].index + 1;
  }

  function applyDeadbandForSameTier(target: TierKey, rawNoDragIndex: number, x: number): number {
    const previous = lastStableLocationRef.current;
    const previousPointer = lastResolvedPointerRef.current;
    if (!previous || previous.target !== target) return rawNoDragIndex;
    const prevNoDragIndex = toNoDragIndex(target, previous.index);
    if (Math.abs(rawNoDragIndex - prevNoDragIndex) !== 1) return rawNoDragIndex;
    if (!previousPointer) return rawNoDragIndex;
    const directionX = x - previousPointer.x;
    if (directionX === 0) return prevNoDragIndex;

    const slots = tierSlotRectsRef.current[target];
    if (!slots.length) return rawNoDragIndex;
    const transitionIndex = Math.max(rawNoDragIndex, prevNoDragIndex);
    let boundaryX: number | null = null;
    if (transitionIndex <= 0) boundaryX = slots[0]?.left ?? null;
    else if (transitionIndex >= slots.length) boundaryX = slots[slots.length - 1]?.right ?? null;
    else {
      const leftSlot = slots[transitionIndex - 1];
      const rightSlot = slots[transitionIndex];
      if (leftSlot && rightSlot) boundaryX = (leftSlot.midX + rightSlot.midX) / 2;
    }
    if (boundaryX === null) return rawNoDragIndex;
    const movingRight = directionX > 0;
    if (rawNoDragIndex > prevNoDragIndex) {
      if (!movingRight) return prevNoDragIndex;
      if (x < boundaryX + REORDER_DEADBAND_PX) return prevNoDragIndex;
    } else {
      if (movingRight) return prevNoDragIndex;
      if (x > boundaryX - REORDER_DEADBAND_PX) return prevNoDragIndex;
    }
    return rawNoDragIndex;
  }

  useEffect(() => {
    if (!cardMenu) return;
    const closeMenu = () => setCardMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cardMenu]);

  useEffect(() => {
    if (!dragGameId) return;
    const handleWindowResize = () => scheduleTierSlotRectRefresh();
    const handleWindowScroll = () => scheduleTierSlotRectRefresh();
    const initTimer = window.setTimeout(() => captureTierSlotRects(), 0);
    window.addEventListener("resize", handleWindowResize);
    window.addEventListener("scroll", handleWindowScroll, true);
    return () => {
      window.clearTimeout(initTimer);
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("scroll", handleWindowScroll, true);
      if (slotRefreshRafRef.current) {
        window.cancelAnimationFrame(slotRefreshRafRef.current);
      }
      slotRefreshRafRef.current = null;
      tierSlotRectsRef.current = { S: [], A: [], B: [], C: [], D: [], F: [] };
    };
  }, [dragGameId]);

  useEffect(() => {
    if (!dragGameId) return;
    const resolve = () => {
      const pending = pendingPointerRef.current;
      if (pending) {
        pendingPointerRef.current = null;
        const nextLocation = locationFromPoint(pending.x, pending.y);
        lastResolvedPointerRef.current = pending;
        if (nextLocation) {
          setDragOver((prev) => {
            if (prev && prev.target === nextLocation.target && prev.index === nextLocation.index) {
              return prev;
            }
            dragOverRef.current = nextLocation;
            return nextLocation;
          });
          lastStableLocationRef.current = nextLocation;
        }
      }
      dragResolveRafRef.current = window.requestAnimationFrame(resolve);
    };
    dragResolveRafRef.current = window.requestAnimationFrame(resolve);
    return () => {
      if (dragResolveRafRef.current) {
        window.cancelAnimationFrame(dragResolveRafRef.current);
      }
      dragResolveRafRef.current = null;
      pendingPointerRef.current = null;
      lastResolvedPointerRef.current = null;
      lastStableLocationRef.current = null;
    };
  }, [dragGameId]);

  useEffect(() => {
    if (!touchDrag) return;
    const onGlobalPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== touchDrag.pointerId) return;
      dragPointerYRef.current = event.clientY;
      setTouchDrag((prev) => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev));
      pendingPointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const onGlobalPointerFinalize = (event: PointerEvent) => {
      if (event.pointerId !== touchDrag.pointerId) return;
      pendingPointerRef.current = { x: event.clientX, y: event.clientY };
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
  }, [touchDrag]);

  useEffect(() => {
    if (!dropFlashTarget) return;
    const timeout = window.setTimeout(() => setDropFlashTarget(null), 380);
    return () => window.clearTimeout(timeout);
  }, [dropFlashTarget]);

  useEffect(() => {
    if (!dragGameId) return;
    const step = () => {
      const y = dragPointerYRef.current;
      const activeDrag = touchDragRef.current;
      const now = performance.now();
      if (typeof y === "number" || activeDrag) {
        const viewport = window.innerHeight;
        const dragTop = activeDrag ? activeDrag.y - activeDrag.offsetY : y ?? 0;
        const dragBottom = activeDrag ? dragTop + activeDrag.height : y ?? viewport;
        const pointerY = typeof y === "number" ? y : dragTop;
        const topDistance = Math.min(pointerY, dragTop);
        const bottomDistance = Math.min(viewport - pointerY, viewport - dragBottom);
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
          const scroller = document.scrollingElement;
          if (scroller) {
            scroller.scrollTop += delta;
          } else {
            window.scrollBy({ top: delta, behavior: "auto" });
          }
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
  }, [dragGameId]);

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
        setRemovedGames([]);
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
      const nextRemovedGames = ((bootstrap?.removedGames ?? []) as Game[]).map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) ?? null }));
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
      setRemovedGames(nextRemovedGames);
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
    const removedGame = gameMap.get(gameId);
    if (!hasUsername) {
      setGames((prev) => prev.filter((g) => g.id !== gameId));
      if (removedGame) {
        setRemovedGames((prev) => (prev.some((g) => g.id === removedGame.id) ? prev : [removedGame, ...prev]));
      }
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
    if (removedGame) {
      setRemovedGames((prev) => (prev.some((g) => g.id === removedGame.id) ? prev : [removedGame, ...prev]));
    }
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

  async function restoreRemovedGame(gameId: string) {
    if (!hasUsername) {
      const game = removedGames.find((g) => g.id === gameId);
      if (!game) return;
      setRemovedGames((prev) => prev.filter((g) => g.id !== gameId));
      setGames((prev) => (prev.some((g) => g.id === gameId) ? prev : [game, ...prev]));
      setTierState((prev) => ({ ...prev, unranked: Array.from(new Set([gameId, ...prev.unranked])) }));
      return;
    }
    const resp = await apiFetch("/api/tierlist/games/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: [gameId] })
    });
    if (!resp.ok) return;
    const json = await resp.json().catch(() => null);
    const restored = Array.isArray(json?.games) ? (json.games as Game[]) : [];
    const restoredGame = restored[0] ? { ...restored[0], coverArtUrl: assetUrl(restored[0].coverArtUrl) ?? null } : null;
    setRemovedGames((prev) => prev.filter((g) => g.id !== gameId));
    if (restoredGame) {
      setGames((prev) => (prev.some((g) => g.id === restoredGame.id) ? prev : [restoredGame, ...prev]));
    }
    setTierState((prev) => ({ ...prev, unranked: Array.from(new Set([gameId, ...prev.unranked])) }));
  }

  function quickMoveGameToTier(gameId: string, tier: QuickMoveTier) {
    setTierState((prev) => {
      const next: TierListState = {
        ...prev,
        tiers: { S: [...prev.tiers.S], A: [...prev.tiers.A], B: [...prev.tiers.B], C: [...prev.tiers.C], D: [...prev.tiers.D], F: [...prev.tiers.F] },
        unranked: prev.unranked.filter((id) => id !== gameId)
      };
      for (const key of TIER_KEYS) {
        next.tiers[key] = next.tiers[key].filter((id) => id !== gameId);
      }
      next.tiers[tier].push(gameId);
      return next;
    });
  }

  function openCardContextMenu(event: React.MouseEvent<HTMLElement>, gameId: string) {
    event.preventDefault();
    setCardMenu({ gameId, x: event.clientX, y: event.clientY });
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
    lastStableLocationRef.current = null;
    pendingPointerRef.current = null;
    lastResolvedPointerRef.current = null;
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
    const tokens: Array<{ kind: "card"; id: string; sourceIndex: number; previewIndex: number } | { kind: "insert" }> = withoutDragged.map((id, previewIndex) => ({
      kind: "card",
      id,
      sourceIndex: indexById.get(id) ?? 0,
      previewIndex
    }));
    const insertIndex = previewInsertIndex(tier);
    if (dragGameId && insertIndex !== null) {
      const clamped = Math.max(0, Math.min(insertIndex, tokens.length));
      tokens.splice(clamped, 0, { kind: "insert" });
    }
    return tokens;
  }

  async function exportPdf() {
    if (pdfExporting) return;
    const normalizedTitle = pdfTitleInput.trim() || defaultPdfTitle(username);
    setPdfTitleInput(normalizedTitle);
    setPdfExporting(true);
    try {
      setStatus(
        pdfExportPlan.mode === "single"
          ? "Exporting PDF..."
          : "Large list detected, exporting multi-page by tiers."
      );
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      const [html2canvasModule, module] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const html2canvasFn: any = (html2canvasModule as any).default ?? html2canvasModule;
      if (typeof html2canvasFn !== "function") {
        throw new Error("Capture engine unavailable");
      }
      const JsPdfCtor: any = (module as any).jsPDF ?? (module as any).default?.jsPDF ?? (module as any).default;
      if (typeof JsPdfCtor !== "function") {
        throw new Error("PDF engine unavailable");
      }
      const doc = new JsPdfCtor({ orientation: "landscape", unit: "pt", format: "letter" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const sheets = pdfExportPlan.pages;
      if (!sheets.length) throw new Error("Nothing to export");
      const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#090c12";
      for (let pageIndex = 0; pageIndex < sheets.length; pageIndex += 1) {
        const pageNode = pdfExportPageRefs.current[pageIndex];
        if (!pageNode) throw new Error(`PDF export surface missing for page ${pageIndex + 1}`);
        const canvas = await html2canvasFn(pageNode, {
          scale: Math.max(2, window.devicePixelRatio || 1),
          backgroundColor,
          useCORS: true,
          logging: false
        });
        if (pageIndex > 0) doc.addPage("letter", "landscape");
        const imageData = canvas.toDataURL("image/png");
        doc.addImage(imageData, "PNG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
      }
      doc.setProperties({ title: normalizedTitle });
      doc.save(`${sanitizePdfFileName(normalizedTitle)}.pdf`);
      writeStoredPdfPrefs(username || "guest", { title: normalizedTitle, includeDate: pdfIncludeDate });
      setPdfModalOpen(false);
      setStatus("PDF downloaded.");
    } catch (error) {
      console.error(error);
      const details = error instanceof Error ? error.message : "Unknown error";
      setStatus(`PDF export failed. ${details}`);
    } finally {
      setPdfExporting(false);
      window.setTimeout(() => setStatus(""), 1400);
    }
  }

  if (loading) return <div className="app-shell loading">Loading...</div>;

  function startTouchDrag(gameId: string, target: DropTarget, index: number, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragGameId(gameId);
    setDragOrigin({ target, index });
    setDragOver({ target, index });
    dragOverRef.current = { target, index };
    lastStableLocationRef.current = { target, index };
    lastResolvedPointerRef.current = { x: e.clientX, y: e.clientY };
    pendingPointerRef.current = { x: e.clientX, y: e.clientY };
    setTouchDrag({
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height
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
    lastStableLocationRef.current = null;
    pendingPointerRef.current = null;
    lastResolvedPointerRef.current = null;
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
    const tierTarget = target as TierKey;
    let rawNoDragIndex = computeSameTierNoDragIndex(tierTarget, x, y);
    rawNoDragIndex = applyDeadbandForSameTier(tierTarget, rawNoDragIndex, x);
    const fullIndex = toFullIndex(target, rawNoDragIndex);
    return { target, index: Math.max(0, Math.min(ids.length, fullIndex)) };
  }

  function onTouchPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!touchDrag || e.pointerId !== touchDrag.pointerId) return;
    e.preventDefault();
    dragPointerYRef.current = e.clientY;
    setTouchDrag((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
    pendingPointerRef.current = { x: e.clientX, y: e.clientY };
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
          <button onClick={() => void setMode(themeMode === "dark" ? "light" : "dark")}>
            {themeMode === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button onClick={openPdfModal}>Export PDF</button>
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
            <h2>{gamesTab === "main" ? "Games" : "Removed Games"}</h2>
            <div className="header-actions">
              {gamesTab === "main" ? (
                <>
                  <button onClick={() => void syncMissingGamesFromLinkedAccounts()} disabled={syncingMissingGames || !hasUsername}>
                    {syncingMissingGames ? "Syncing..." : "Sync Missing Games"}
                  </button>
                  <button className="primary" onClick={() => setAddModalOpen(true)}>Add Game</button>
                  <button onClick={() => setGamesTab("removed")}>Removed Games ({removedGames.length})</button>
                </>
              ) : (
                <button onClick={() => setGamesTab("main")}>X</button>
              )}
            </div>
          </div>
          {gamesTab === "main" ? (
            games.length === 0 ? (
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
                        </div>
                        <button className="danger" onClick={() => void removeGame(g.id)}>Remove</button>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )
          ) : removedGames.length === 0 ? (
            <p>No removed games.</p>
          ) : (
            <div className="game-list">
              {removedGames.map((g) => (
                <article key={`removed-${g.id}`} className="game-item">
                  {g.coverArtUrl ? (
                    <img src={assetUrl(g.coverArtUrl) ?? undefined} alt={g.title} />
                  ) : (
                    <div className="cover-fallback cover-fallback-list cover-fallback-empty" aria-label="No cover art" />
                  )}
                  <div className="game-meta">
                    <strong>{g.title}</strong>
                  </div>
                  <button className="primary" onClick={() => void restoreRemovedGame(g.id)}>Add</button>
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
                            data-game-id={token.id}
                            data-target={tier}
                            data-index={token.previewIndex}
                            onContextMenu={(e) => openCardContextMenu(e, token.id)}
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
                        data-game-id={id}
                        data-target="UNRANKED"
                        data-index={idx}
                        onContextMenu={(e) => openCardContextMenu(e, id)}
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

      {pdfModalOpen && (
        <div className="modal-backdrop" onClick={closePdfModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export PDF</h3>
            <p className="modal-note">Choose a title and whether to include today&apos;s date.</p>
            <input
              value={pdfTitleInput}
              onChange={(e) => setPdfTitleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void exportPdf();
              }}
              placeholder={defaultPdfTitle(username)}
              aria-label="PDF title"
            />
            <label className="pdf-date-toggle">
              <input
                type="checkbox"
                checked={pdfIncludeDate}
                onChange={(e) => setPdfIncludeDate(e.target.checked)}
              />
              <span>Dated (MM/DD/YYYY)</span>
            </label>
            <div className="header-actions">
              <button onClick={closePdfModal} disabled={pdfExporting}>Cancel</button>
              <button className="primary" onClick={() => void exportPdf()} disabled={pdfExporting}>
                {pdfExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
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
                  </div>
                  <button onClick={() => void addGame(r)}>Add</button>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="pdf-export-pages-root" aria-hidden="true">
        {pdfExportPlan.pages.map((page) => {
          const isFirstPage = page.pageIndex === 0;
          const isLastPage = page.pageIndex === pdfExportPlan.pages.length - 1;
          return (
            <div
              key={`pdf-sheet-${page.pageIndex}`}
              ref={(node) => {
                pdfExportPageRefs.current[page.pageIndex] = node;
              }}
              className="pdf-export-sheet panel"
              style={
                {
                  "--pdf-page-width": `${PDF_PAGE_WIDTH_PX}px`,
                  "--pdf-page-height": `${PDF_PAGE_HEIGHT_PX}px`,
                  "--pdf-card-width": `${page.cardWidth}px`,
                  "--pdf-cards-per-row": String(page.cardsPerRow)
                } as CSSProperties
              }
            >
              {isFirstPage && <h1 className="pdf-export-title">{pdfPreviewTitle}</h1>}
              <div className="tier-wrap">
                {page.tiers.map((tier) => (
                  <section key={`pdf-${page.pageIndex}-${tier}`} className={`tier-row tier-${tier}`}>
                    <header>
                      <span className="tier-label">{tier}</span>
                    </header>
                    <div className={`tier-cards tier-cards-ranked ${tierState.tiers[tier].length === 0 ? "is-empty" : ""}`}>
                      {tierState.tiers[tier].map((id) => {
                        const game = gameMap.get(id);
                        if (!game) return null;
                        return (
                          <div key={`pdf-${page.pageIndex}-${tier}-${id}`} className="tier-item-slot">
                            <article className="tier-game">
                              {gameHasUsableCover(game, id) ? (
                                <img src={assetUrl(game.coverArtUrl) ?? undefined} alt={game.title} draggable={false} />
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
                ))}
              </div>
              {pdfIncludeDate && isLastPage && <p className="pdf-export-date">{formatDateOnly(new Date())}</p>}
            </div>
          );
        })}
      </div>

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
      {cardMenu && (
        <div
          className="card-context-menu"
          style={{ left: Math.round(cardMenu.x), top: Math.round(cardMenu.y) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="danger"
            onClick={() => {
              const gameId = cardMenu.gameId;
              setCardMenu(null);
              void removeGame(gameId);
            }}
          >
            Remove
          </button>
          {QUICK_MOVE_TIERS.map((tier) => (
            <button
              key={tier}
              onClick={() => {
                const gameId = cardMenu.gameId;
                setCardMenu(null);
                quickMoveGameToTier(gameId, tier);
              }}
            >
              Move to {tier}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
