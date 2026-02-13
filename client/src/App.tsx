import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Screen = "menu" | "accounts" | "editor" | "games" | "themes";
type TierKey = "S" | "A" | "B" | "C" | "D" | "F";

type Game = {
  id: string;
  title: string;
  platform: string;
  genre: string;
  popularity: number;
  playtimeMinutes: number;
  coverArtUrl: string;
  manuallyAdded: boolean;
};

type Theme = { id: string; name: string; tags: string[] };

type TierListState = {
  tiers: Record<TierKey, string[]>;
  unranked: string[];
  updatedAt: string | null;
};

const TIER_KEYS: TierKey[] = ["S", "A", "B", "C", "D", "F"];

const PLATFORM_OPTIONS = [
  { name: "Steam", status: "supported" },
  { name: "Xbox", status: "pilot" },
  { name: "PlayStation", status: "pilot" },
  { name: "Epic Games", status: "coming-soon" },
  { name: "Battle.net", status: "coming-soon" },
  { name: "Nintendo", status: "coming-soon" },
  { name: "GOG", status: "coming-soon" },
  { name: "Riot", status: "coming-soon" },
  { name: "EA App / Origin", status: "coming-soon" },
  { name: "Ubisoft Connect", status: "coming-soon" },
  { name: "Itch.io", status: "coming-soon" }
];

const FALLBACK_THEMES: Theme[] = [
  { id: "apple-glass-white-default", name: "Apple Glass White", tags: ["light", "glass"] },
  { id: "classic-clean", name: "Classic Clean", tags: ["clean", "neutral"] },
  { id: "minimal-light", name: "Minimal Light", tags: ["light", "minimal"] },
  { id: "minimal-dark", name: "Minimal Dark", tags: ["dark", "minimal"] },
  { id: "catstacker-arcade", name: "CatStacker Arcade", tags: ["playful", "arcade"] },
  { id: "blonde-anime-glow", name: "Blonde Anime Glow", tags: ["anime", "stylized"] },
  { id: "retro-pixel", name: "Retro Pixel", tags: ["retro", "pixel"] },
  { id: "forest-calm", name: "Forest Calm", tags: ["nature", "calm"] },
  { id: "synth-sunset", name: "Synth Sunset", tags: ["vibrant", "retro"] },
  { id: "zen-garden", name: "Zen Garden", tags: ["minimal", "calm"] }
];

const DEFAULT_TIER_STATE: TierListState = {
  tiers: { S: [], A: [], B: [], C: [], D: [], F: [] },
  unranked: [],
  updatedAt: null
};
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function displayLabel(key: TierKey) {
  return `${key} Tier`;
}

function statusLabel(status: string) {
  if (status === "coming-soon") return "Coming Soon";
  if (status === "supported") return "Supported";
  if (status === "pilot") return "Pilot";
  return status;
}

function apiUrl(pathname: string) {
  return `${API_BASE}${pathname}`;
}

function assetUrl(pathname: string) {
  if (!pathname) return pathname;
  if (pathname.startsWith("http://") || pathname.startsWith("https://") || pathname.startsWith("data:")) return pathname;
  if (pathname.startsWith("/")) return API_BASE ? `${API_BASE}${pathname}` : pathname;
  return pathname;
}

function normalizeGame(game: Game): Game {
  return { ...game, coverArtUrl: assetUrl(game.coverArtUrl) };
}

function normalizeThemes(rawThemes: unknown, currentThemeId: string): Theme[] {
  const input = Array.isArray(rawThemes) ? rawThemes : [];
  const parsed = input
    .map((t) => {
      const candidate = t as Partial<Theme>;
      if (!candidate?.id || !candidate?.name) return null;
      return {
        id: String(candidate.id),
        name: String(candidate.name),
        tags: Array.isArray(candidate.tags) ? candidate.tags.map(String) : []
      } satisfies Theme;
    })
    .filter((t): t is Theme => Boolean(t));

  const base = parsed.length > 0 ? parsed : FALLBACK_THEMES;
  const withDefault = base.some((t) => t.id === "apple-glass-white-default")
    ? base
    : [{ id: "apple-glass-white-default", name: "Apple Glass White", tags: ["light", "default"] }, ...base];

  if (!withDefault.some((t) => t.id === currentThemeId)) {
    return [{ id: currentThemeId, name: `Current (${currentThemeId})`, tags: ["current"] }, ...withDefault];
  }
  return withDefault;
}

function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeId, setThemeId] = useState("apple-glass-white-default");
  const [linkedAccounts, setLinkedAccounts] = useState<
    Array<{ id: string; platform: string; accountName: string; externalUserId?: string; syncStatus?: string }>
  >([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tierState, setTierState] = useState<TierListState>(DEFAULT_TIER_STATE);
  const [dragGameId, setDragGameId] = useState<string | null>(null);

  const [accountPlatform, setAccountPlatform] = useState("Steam");
  const [accountName, setAccountName] = useState("");
  const [steamStatus, setSteamStatus] = useState("");
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [genreFilter, setGenreFilter] = useState("All");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [popularityFilter, setPopularityFilter] = useState("All");
  const [sortMode, setSortMode] = useState<"A-Z" | "Z-A">("A-Z");
  const [selectedGameIds, setSelectedGameIds] = useState<string[]>([]);

  const [manualQuery, setManualQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ title: string; platform: string; genre: string; popularity: number; coverArtUrl: string | null }>
  >([]);
  const [searching, setSearching] = useState(false);

  const gameMap = useMemo(() => {
    const m = new Map<string, Game>();
    for (const game of games) m.set(game.id, game);
    return m;
  }, [games]);

  const activeThemeSprites = useMemo(() => themeSpritesFor(themeId), [themeId]);
  const activeThemeFlavor = useMemo(() => themeFlavorCopy(themeId), [themeId]);

  const tieredGameIds = useMemo(() => {
    return new Set([...tierState.unranked, ...TIER_KEYS.flatMap((tier) => tierState.tiers[tier])]);
  }, [tierState]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    applyThemeVariables(themeId);
  }, [themeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steam = params.get("steam");
    if (steam === "linked") setSteamStatus("Steam account linked.");
    if (steam === "failed") setSteamStatus("Steam link failed.");
    if (steam) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function loadInitialData() {
    try {
      const [bootstrapResp, themesResp] = await Promise.all([fetch(apiUrl("/api/v1/bootstrap")), fetch(apiUrl("/api/v1/themes"))]);
      const bootstrap = await bootstrapResp.json();
      const themesData = await themesResp.json();
      const nextThemeId = bootstrap?.theme?.themeId ?? "apple-glass-white-default";

      setThemes(normalizeThemes(themesData?.themes, nextThemeId));
      setThemeId(nextThemeId);
      setLinkedAccounts(bootstrap?.linkedAccounts ?? []);
      setGames((bootstrap?.games ?? []).map(normalizeGame));
      setTierState(bootstrap?.tierListState ?? DEFAULT_TIER_STATE);
    } catch {
      setThemes(normalizeThemes([], "apple-glass-white-default"));
    } finally {
      setLoading(false);
    }
  }

  async function saveTierList() {
    setSaveStatus("Saving...");
    try {
      const payload = {
        tiers: tierState.tiers,
        unranked: tierState.unranked
      };
      const resp = await fetch(apiUrl("/api/v1/tier-list/state"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus(""), 1200);
      } else {
        setSaveStatus("Save failed");
      }
    } catch {
      setSaveStatus("Save failed");
    }
  }

  async function linkAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) return;

    const resp = await fetch(apiUrl("/api/v1/accounts/link"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: accountPlatform, accountName: accountName.trim() })
    });
    if (!resp.ok) {
      setSteamStatus("Account link failed.");
      return;
    }
    const json = await resp.json();
    setLinkedAccounts((prev) => [...prev, json.linked]);
    setAccountName("");
  }

  async function syncSteamAccount(accountId: string) {
    setSyncingAccountId(accountId);
    try {
      const resp = await fetch(apiUrl(`/api/v1/accounts/steam/sync/${accountId}`), { method: "POST" });
      if (resp.ok) {
        const bootstrapResp = await fetch(apiUrl("/api/v1/bootstrap"));
        const bootstrap = await bootstrapResp.json();
        setGames((bootstrap?.games ?? []).map(normalizeGame));
        setTierState(bootstrap?.tierListState ?? DEFAULT_TIER_STATE);
        setSteamStatus("Steam library synced.");
      } else {
        const error = await resp.json().catch(() => null);
        setSteamStatus(error?.error ?? "Steam sync failed.");
      }
    } catch {
      setSteamStatus("Steam sync failed.");
    }
    setSyncingAccountId(null);
  }

  async function searchMetadata() {
    if (manualQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const resp = await fetch(apiUrl("/api/v1/metadata/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: manualQuery.trim() })
      });
      const json = await resp.json();
      setSearchResults(json.results ?? []);
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  }

  async function addGameFromSearch(result: {
    title: string;
    platform: string;
    genre: string;
    popularity: number;
    coverArtUrl: string | null;
  }) {
    const resp = await fetch(apiUrl("/api/v1/games/manual"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: result.title,
        platform: result.platform,
        genre: result.genre,
        popularity: result.popularity,
        coverArtUrl: result.coverArtUrl
      })
    });

    if (!resp.ok) {
      setSaveStatus("Add failed");
      return;
    }
    const json = await resp.json();
    setGames((prev) => [...prev, normalizeGame(json.game)]);
    setTierState((prev) => ({ ...prev, unranked: [...prev.unranked, json.game.id] }));
    setSearchResults((prev) => prev.filter((r) => r.title !== result.title));
  }

  async function removeSelectedGames() {
    if (selectedGameIds.length === 0) return;
    const resp = await fetch(apiUrl("/api/v1/games/remove"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: selectedGameIds })
    });
    if (!resp.ok) {
      setSaveStatus("Remove failed");
      return;
    }

    const removeSet = new Set(selectedGameIds);
    setGames((prev) => prev.filter((g) => !removeSet.has(g.id)));
    setTierState((prev) => ({
      ...prev,
      unranked: prev.unranked.filter((id) => !removeSet.has(id)),
      tiers: {
        S: prev.tiers.S.filter((id) => !removeSet.has(id)),
        A: prev.tiers.A.filter((id) => !removeSet.has(id)),
        B: prev.tiers.B.filter((id) => !removeSet.has(id)),
        C: prev.tiers.C.filter((id) => !removeSet.has(id)),
        D: prev.tiers.D.filter((id) => !removeSet.has(id)),
        F: prev.tiers.F.filter((id) => !removeSet.has(id))
      }
    }));
    setSelectedGameIds([]);
  }

  async function applyTheme(theme: Theme) {
    setThemeId(theme.id);
    await fetch(apiUrl("/api/v1/users/me/theme"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: theme.id })
    });
    setSaveStatus(`Theme set: ${theme.name}`);
    setTimeout(() => setSaveStatus(""), 1200);
  }

  function ensureGameInBuckets(gameId: string, target: TierKey | "UNRANKED", insertIndex?: number) {
    setTierState((prev) => {
      const next: TierListState = {
        ...prev,
        tiers: {
          S: [...prev.tiers.S],
          A: [...prev.tiers.A],
          B: [...prev.tiers.B],
          C: [...prev.tiers.C],
          D: [...prev.tiers.D],
          F: [...prev.tiers.F]
        },
        unranked: [...prev.unranked]
      };

      next.unranked = next.unranked.filter((id) => id !== gameId);
      for (const key of TIER_KEYS) {
        next.tiers[key] = next.tiers[key].filter((id) => id !== gameId);
      }

      if (target === "UNRANKED") {
        const idx = insertIndex ?? next.unranked.length;
        next.unranked.splice(idx, 0, gameId);
      } else {
        const idx = insertIndex ?? next.tiers[target].length;
        next.tiers[target].splice(idx, 0, gameId);
      }

      return next;
    });
  }

  function onDropToTier(tier: TierKey, insertIndex?: number) {
    if (!dragGameId) return;
    ensureGameInBuckets(dragGameId, tier, insertIndex);
    setDragGameId(null);
  }

  function onDropToUnranked(insertIndex?: number) {
    if (!dragGameId) return;
    ensureGameInBuckets(dragGameId, "UNRANKED", insertIndex);
    setDragGameId(null);
  }

  function hasTierData() {
    return games.length > 0 && tieredGameIds.size > 0;
  }

  async function exportPdf() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(18);
    doc.text("Tier List Your Games", 40, 40);
    doc.setFontSize(10);
    doc.text(`Theme: ${themeId}`, 40, 58);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 40, 72);

    let y = 98;
    for (const tier of TIER_KEYS) {
      const ids = tierState.tiers[tier];
      const names = ids.map((id) => gameMap.get(id)?.title ?? "Unknown");
      doc.setFillColor(245, 247, 255);
      doc.roundedRect(34, y - 14, 525, 24, 4, 4, "F");
      doc.setFontSize(12);
      doc.text(`${tier} Tier`, 40, y);
      doc.setFontSize(10);
      doc.text(names.length ? names.join(", ").slice(0, 180) : "(empty)", 110, y);
      y += 30;
      if (y > 760) {
        doc.addPage();
        y = 48;
      }
    }

    const unrankedNames = tierState.unranked.map((id) => gameMap.get(id)?.title ?? "Unknown");
    doc.setFontSize(12);
    doc.text("Unranked", 40, y + 8);
    doc.setFontSize(10);
    doc.text(unrankedNames.length ? unrankedNames.join(", ").slice(0, 180) : "(empty)", 110, y + 8);
    doc.save("tier-list-your-games.pdf");
  }

  const genres = useMemo(() => ["All", ...Array.from(new Set(games.map((g) => g.genre))).sort()], [games]);
  const platforms = useMemo(() => ["All", ...Array.from(new Set(games.map((g) => g.platform))).sort()], [games]);

  const filteredGames = useMemo(() => {
    let arr = games.filter((g) => g.title.toLowerCase().includes(searchTerm.toLowerCase()));
    if (genreFilter !== "All") arr = arr.filter((g) => g.genre === genreFilter);
    if (platformFilter !== "All") arr = arr.filter((g) => g.platform === platformFilter);
    if (popularityFilter === "Popular") arr = arr.filter((g) => g.popularity >= 80);
    if (popularityFilter === "Mid") arr = arr.filter((g) => g.popularity >= 50 && g.popularity < 80);
    if (popularityFilter === "Niche") arr = arr.filter((g) => g.popularity < 50);

    return [...arr].sort((a, b) =>
      sortMode === "A-Z" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title)
    );
  }, [games, searchTerm, genreFilter, platformFilter, popularityFilter, sortMode]);

  const availableThemes = useMemo(() => normalizeThemes(themes, themeId), [themes, themeId]);
  const rankedCount = tieredGameIds.size - tierState.unranked.length;
  const completion = games.length === 0 ? 0 : Math.round((rankedCount / games.length) * 100);

  if (loading) {
    return (
      <div className="page">
        <div className="shell">
          <section className="loading-card">
            <h2>Loading your workspace</h2>
            <p>Pulling accounts, games, and theme settings...</p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="shell">
        <header className="app-hero">
          <div className="hero-left">
            <p className="eyebrow">Created by GarrettJPG</p>
            <h1>Tier List Your Games</h1>
            <p className="hero-subtitle">A cleaner command center for collecting, ranking, and exporting your game backlog.</p>
          </div>
          <div className="hero-stats">
            <article>
              <span>Games</span>
              <strong>{games.length}</strong>
            </article>
            <article>
              <span>Linked Accounts</span>
              <strong>{linkedAccounts.length}</strong>
            </article>
            <article>
              <span>Ranked Progress</span>
              <strong>{completion}%</strong>
            </article>
          </div>
        </header>

        <nav className="screen-nav" aria-label="Primary navigation">
          {[
            ["menu", "Dashboard"],
            ["accounts", "Accounts"],
            ["games", "Games"],
            ["editor", "Tier Editor"],
            ["themes", "Themes"]
          ].map(([key, label]) => (
            <button
              key={key}
              className={`nav-pill ${screen === key ? "active" : ""}`}
              onClick={() => setScreen(key as Screen)}
            >
              {label}
            </button>
          ))}
          <button className="nav-pill ghost" onClick={() => void exportPdf()}>
            Export PDF
          </button>
        </nav>

        {(activeThemeSprites.length > 0 || activeThemeFlavor) && (
          <section className="theme-personality">
            {activeThemeFlavor && <p className="theme-flavor">{activeThemeFlavor}</p>}
            {activeThemeSprites.length > 0 && (
              <div className="sprite-strip" aria-label="Theme sprites">
                {activeThemeSprites.slice(0, 8).map((src) => (
                  <img key={src} src={src} alt="" />
                ))}
              </div>
            )}
          </section>
        )}

        {screen === "menu" && (
          <main className="workspace">
            <section className="menu-grid">
              <button className="menu-card primary" onClick={() => setScreen(hasTierData() ? "editor" : "accounts")}>
                <small>Workflow</small>
                <strong>{hasTierData() ? "Continue tier editing" : "Get started in under 2 minutes"}</strong>
                <span>{hasTierData() ? "Jump straight back into ranking and save when ready." : "Link one account, sync games, and start ranking."}</span>
              </button>
              <button className="menu-card" onClick={() => setScreen("accounts")}>
                <small>Connections</small>
                <strong>Manage linked platforms</strong>
                <span>Connect Steam now, keep Xbox/PlayStation pilot slots visible for future sync.</span>
              </button>
              <button className="menu-card" onClick={() => setScreen("games")}>
                <small>Library</small>
                <strong>Curate your games list</strong>
                <span>Search, filter, bulk remove, and add games from metadata lookup.</span>
              </button>
              <button className="menu-card" onClick={() => setScreen("themes")}>
                <small>Appearance</small>
                <strong>Apply visual themes</strong>
                <span>Pick a theme preset and change the whole app style instantly.</span>
              </button>
              <button className="menu-card" onClick={() => void exportPdf()}>
                <small>Share</small>
                <strong>Generate ranking PDF</strong>
                <span>Create a clean export of current tier rows and unranked pool.</span>
              </button>
            </section>
          </main>
        )}

        {screen === "accounts" && (
          <main className="workspace panel">
            <div className="panel-head">
              <h2>Account Linking</h2>
              <p>Connect platforms first, then sync libraries into your ranking workspace.</p>
            </div>
            <div className="row wrap">
              <button onClick={() => (window.location.href = apiUrl("/api/v1/accounts/steam/start"))}>Connect Steam (OAuth)</button>
              {steamStatus && <span className="status-inline">{steamStatus}</span>}
            </div>
            <form className="inline-form" onSubmit={linkAccount}>
              <select value={accountPlatform} onChange={(e) => setAccountPlatform(e.target.value)}>
                {PLATFORM_OPTIONS.filter((p) => p.status !== "coming-soon").map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account name"
                aria-label="Account name"
              />
              <button type="submit">Link Account</button>
            </form>

            <div className="platform-grid">
              {PLATFORM_OPTIONS.map((p) => (
                <div className="platform-card" key={p.name}>
                  <strong>{p.name}</strong>
                  <span className={`status status-${p.status}`}>{statusLabel(p.status)}</span>
                </div>
              ))}
            </div>

            <h3>Linked Accounts</h3>
            {linkedAccounts.length === 0 ? (
              <p className="muted-note">No linked accounts yet.</p>
            ) : (
              <ul className="simple-list">
                {linkedAccounts.map((a) => (
                  <li key={a.id}>
                    <strong>{a.platform}</strong> - {a.accountName}
                    {a.platform === "Steam" && (
                      <button onClick={() => void syncSteamAccount(a.id)} disabled={syncingAccountId === a.id}>
                        {syncingAccountId === a.id ? "Syncing..." : "Sync Steam library"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </main>
        )}

        {screen === "editor" && (
          <main className="workspace panel">
            <div className="row between">
              <div className="panel-head compact">
                <h2>Tier Editor</h2>
                <p>Drag games between tiers and keep your ranking state saved.</p>
              </div>
              <div className="row">
                <button onClick={saveTierList}>Save</button>
                <span className="status-inline">{saveStatus}</span>
              </div>
            </div>
            {tierState.updatedAt && (
              <p className="muted-note">Last saved: {new Date(tierState.updatedAt).toLocaleString()}</p>
            )}

            {games.length === 0 && (
              <p className="muted-note">
                No games yet. Add games in Games list or sync from a linked account first.
              </p>
            )}

            <section className="tier-wrap">
              {TIER_KEYS.map((tier) => (
                <div key={tier} className="tier-row" onDragOver={(e) => e.preventDefault()} onDrop={() => onDropToTier(tier)}>
                  <div className="tier-label">{displayLabel(tier)}</div>
                  <div className="tier-cards">
                    {tierState.tiers[tier].map((id, idx) => {
                      const game = gameMap.get(id);
                      if (!game) return null;
                      return (
                        <article
                          key={id}
                          className="game-card"
                          draggable
                          onDragStart={() => setDragGameId(id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onDropToTier(tier, idx)}
                        >
                          <img src={assetUrl(game.coverArtUrl)} alt={game.title} />
                          <span>{game.title}</span>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            <h3>Unranked Pool</h3>
            <section className="tier-row" onDragOver={(e) => e.preventDefault()} onDrop={() => onDropToUnranked()}>
              <div className="tier-label small">Pool</div>
              <div className="tier-cards">
                {tierState.unranked.map((id, idx) => {
                  const game = gameMap.get(id);
                  if (!game) return null;
                  return (
                    <article
                      key={id}
                      className="game-card"
                      draggable
                      onDragStart={() => setDragGameId(id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDropToUnranked(idx)}
                    >
                      <img src={assetUrl(game.coverArtUrl)} alt={game.title} />
                      <span>{game.title}</span>
                    </article>
                  );
                })}
              </div>
            </section>
          </main>
        )}

        {screen === "games" && (
          <main className="workspace panel">
            <div className="row between">
              <div className="panel-head compact">
                <h2>Games List</h2>
                <p>Filter your library and maintain a clean ranking-ready dataset.</p>
              </div>
              <button className="danger" onClick={removeSelectedGames}>
                Remove Selected ({selectedGameIds.length})
              </button>
            </div>
            <div className="filters">
              <input placeholder="Search title..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as "A-Z" | "Z-A")}>
                <option>A-Z</option>
                <option>Z-A</option>
              </select>
              <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
                {genres.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                {platforms.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <select value={popularityFilter} onChange={(e) => setPopularityFilter(e.target.value)}>
                <option>All</option>
                <option>Popular</option>
                <option>Mid</option>
                <option>Niche</option>
              </select>
            </div>

            <div className="manual-add">
              <h3>Metadata Search</h3>
              <div className="inline-form">
                <input
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="Search game title..."
                />
                <button onClick={searchMetadata} disabled={searching}>
                  {searching ? "Searching..." : "Search"}
                </button>
              </div>
              <div className="search-results">
                {searchResults.map((r) => (
                  <div className="search-result" key={`${r.title}-${r.platform}`}>
                    <div>
                      <strong>{r.title}</strong>
                      <span>
                        {r.platform} - {r.genre}
                      </span>
                    </div>
                    <button onClick={() => addGameFromSearch(r)}>Add</button>
                  </div>
                ))}
                {!searching && manualQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <p className="muted-note">No results found. Try a broader title.</p>
                )}
              </div>
            </div>

            <div className="games-table">
              {filteredGames.map((g) => (
                <label key={g.id} className="game-row">
                  <input
                    type="checkbox"
                    checked={selectedGameIds.includes(g.id)}
                    onChange={(e) =>
                      setSelectedGameIds((prev) =>
                        e.target.checked ? [...prev, g.id] : prev.filter((id) => id !== g.id)
                      )
                    }
                  />
                  <img src={assetUrl(g.coverArtUrl)} alt={g.title} />
                  <div>
                    <strong>{g.title}</strong>
                    <span>
                      {g.platform} | {g.genre} | popularity {g.popularity}
                    </span>
                  </div>
                </label>
              ))}
              {filteredGames.length === 0 && <p className="muted-note">No games match your current filters.</p>}
            </div>
          </main>
        )}

        {screen === "themes" && (
          <main className="workspace panel">
            <div className="row between">
              <div className="panel-head compact">
                <h2>Themes</h2>
                <p>Choose a visual style. Theme options now include built-in fallbacks if API data is empty.</p>
              </div>
              <button
                onClick={() => {
                  const defaultTheme = availableThemes.find((t) => t.id === "apple-glass-white-default");
                  if (defaultTheme) void applyTheme(defaultTheme);
                }}
              >
                Reset to default
              </button>
            </div>
            <div className="theme-grid">
              {availableThemes.map((theme) => (
                <button
                  key={theme.id}
                  className={`theme-card ${themeId === theme.id ? "selected" : ""}`}
                  onClick={() => applyTheme(theme)}
                >
                  <strong>{theme.name}</strong>
                  <span>{theme.tags.join(", ") || "theme preset"}</span>
                </button>
              ))}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function applyThemeVariables(themeId: string) {
  const root = document.documentElement;
  const palette = paletteFor(themeId);
  root.style.setProperty("--bg", palette.bg);
  root.style.setProperty("--surface", palette.surface);
  root.style.setProperty("--surface-alt", palette.surfaceAlt);
  root.style.setProperty("--text", palette.text);
  root.style.setProperty("--muted", palette.muted);
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-2", palette.accent2);
  root.style.setProperty("--tier-s", palette.tierS);
  root.style.setProperty("--tier-a", palette.tierA);
  root.style.setProperty("--tier-b", palette.tierB);
  root.style.setProperty("--tier-c", palette.tierC);
  root.style.setProperty("--tier-d", palette.tierD);
  root.style.setProperty("--tier-f", palette.tierF);
  root.style.setProperty("--bg-image", palette.bgImage ?? "none");
}

function paletteFor(themeId: string) {
  const explicit: Record<string, Record<string, string>> = {
    "apple-glass-white-default": {
      bg: "linear-gradient(145deg, #fbfbff 0%, #f2f7ff 100%)",
      surface: "rgba(255, 255, 255, 0.72)",
      surfaceAlt: "rgba(255, 255, 255, 0.84)",
      text: "#0f172a",
      muted: "#4b5563",
      accent: "#2563eb",
      accent2: "#0ea5e9",
      tierS: "#f59e0b",
      tierA: "#60a5fa",
      tierB: "#34d399",
      tierC: "#facc15",
      tierD: "#fb923c",
      tierF: "#ef4444",
      bgImage: "none"
    },
    "catstacker-arcade": {
      bg: "linear-gradient(145deg, #fff6dd 0%, #ffe6f0 100%)",
      surface: "rgba(255, 255, 255, 0.78)",
      surfaceAlt: "rgba(255, 255, 255, 0.9)",
      text: "#3f2a1d",
      muted: "#6b4d3c",
      accent: "#f97316",
      accent2: "#eab308",
      tierS: "#ffb703",
      tierA: "#8ecae6",
      tierB: "#90be6d",
      tierC: "#f9c74f",
      tierD: "#f9844a",
      tierF: "#f94144",
      bgImage: "none"
    },
    "blonde-anime-glow": {
      bg: "linear-gradient(145deg, #eef2ff 0%, #fdf2f8 100%)",
      surface: "rgba(255, 255, 255, 0.62)",
      surfaceAlt: "rgba(255, 255, 255, 0.82)",
      text: "#1f2937",
      muted: "#4b5563",
      accent: "#f4c95d",
      accent2: "#60a5fa",
      tierS: "#f4c95d",
      tierA: "#8ec5fc",
      tierB: "#b9fbc0",
      tierC: "#ffd6a5",
      tierD: "#ffadad",
      tierF: "#ff6b6b",
      bgImage: `url('${assetUrl("/art/ThemeImages/BlondeAnimeGirlTheme/1.png")}')`
    }
  };

  if (explicit[themeId]) return explicit[themeId];

  const seed = themeId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = seed % 360;
  const hue2 = (hue + 55) % 360;

  return {
    bg: `linear-gradient(145deg, hsl(${hue} 84% 95%) 0%, hsl(${hue2} 70% 92%) 100%)`,
    surface: "rgba(255, 255, 255, 0.75)",
    surfaceAlt: "rgba(255, 255, 255, 0.9)",
    text: "#0f172a",
    muted: "#475569",
    accent: `hsl(${hue} 75% 45%)`,
    accent2: `hsl(${hue2} 78% 45%)`,
    tierS: "#f59e0b",
    tierA: "#60a5fa",
    tierB: "#34d399",
    tierC: "#facc15",
    tierD: "#fb923c",
    tierF: "#ef4444",
    bgImage: "none"
  };
}

function themeSpritesFor(themeId: string) {
  if (themeId === "catstacker-arcade") {
    return [
      assetUrl("/art/ThemeImages/CatStackerTheme/Cats/Cat1.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Cats/Cat2.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Cats/Cat3.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Cats/Cat4.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Cats/Cat5.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Platforms/teaplatform.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Platforms/chickenplatform.png"),
      assetUrl("/art/ThemeImages/CatStackerTheme/Platforms/castleplatform.png")
    ];
  }
  if (themeId === "blonde-anime-glow") {
    return [
      assetUrl("/art/ThemeImages/BlondeAnimeGirlTheme/1.png"),
      assetUrl("/art/ThemeImages/BlondeAnimeGirlTheme/2.png")
    ];
  }
  return [];
}

function themeFlavorCopy(themeId: string) {
  if (themeId === "catstacker-arcade") {
    return "CatStacker Arcade: playful stacks, soft bounce, and cozy arcade energy.";
  }
  if (themeId === "blonde-anime-glow") {
    return "Blonde Anime Glow: polished character-forward style with soft light and clean contrast.";
  }
  return "";
}

export default App;
