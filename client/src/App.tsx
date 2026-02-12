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

const DEFAULT_TIER_STATE: TierListState = {
  tiers: { S: [], A: [], B: [], C: [], D: [], F: [] },
  unranked: [],
  updatedAt: null
};

function displayLabel(key: TierKey) {
  return `${key} Tier`;
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
  }, []);

  async function loadInitialData() {
    try {
      const [bootstrapResp, themesResp] = await Promise.all([fetch("/api/v1/bootstrap"), fetch("/api/v1/themes")]);
      const bootstrap = await bootstrapResp.json();
      const themesData = await themesResp.json();

      setThemes(themesData.themes ?? []);
      setThemeId(bootstrap?.theme?.themeId ?? "apple-glass-white-default");
      setLinkedAccounts(bootstrap?.linkedAccounts ?? []);
      setGames(bootstrap?.games ?? []);
      setTierState(bootstrap?.tierListState ?? DEFAULT_TIER_STATE);
    } finally {
      setLoading(false);
    }
  }

  async function saveTierList() {
    setSaveStatus("Saving...");
    const payload = {
      tiers: tierState.tiers,
      unranked: tierState.unranked
    };
    const resp = await fetch("/api/v1/tier-list/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      setSaveStatus("Saved");
      setTimeout(() => setSaveStatus(""), 1000);
    } else {
      setSaveStatus("Save failed");
    }
  }

  async function linkAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) return;

    const resp = await fetch("/api/v1/accounts/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: accountPlatform, accountName: accountName.trim() })
    });
    if (!resp.ok) return;
    const json = await resp.json();
    setLinkedAccounts((prev) => [...prev, json.linked]);
    setAccountName("");
  }

  async function syncSteamAccount(accountId: string) {
    setSyncingAccountId(accountId);
    const resp = await fetch(`/api/v1/accounts/steam/sync/${accountId}`, { method: "POST" });
    if (resp.ok) {
      const bootstrapResp = await fetch("/api/v1/bootstrap");
      const bootstrap = await bootstrapResp.json();
      setGames(bootstrap?.games ?? []);
      setTierState(bootstrap?.tierListState ?? DEFAULT_TIER_STATE);
      setSteamStatus("Steam library synced.");
    } else {
      const error = await resp.json().catch(() => null);
      setSteamStatus(error?.error ?? "Steam sync failed.");
    }
    setSyncingAccountId(null);
  }

  async function searchMetadata() {
    if (manualQuery.trim().length < 2) return;
    setSearching(true);
    const resp = await fetch("/api/v1/metadata/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: manualQuery.trim() })
    });
    const json = await resp.json();
    setSearchResults(json.results ?? []);
    setSearching(false);
  }

  async function addGameFromSearch(result: {
    title: string;
    platform: string;
    genre: string;
    popularity: number;
    coverArtUrl: string | null;
  }) {
    const resp = await fetch("/api/v1/games/manual", {
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

    if (!resp.ok) return;
    const json = await resp.json();
    setGames((prev) => [...prev, json.game]);
    setTierState((prev) => ({ ...prev, unranked: [...prev.unranked, json.game.id] }));
    setSearchResults((prev) => prev.filter((r) => r.title !== result.title));
  }

  async function removeSelectedGames() {
    if (selectedGameIds.length === 0) return;
    const resp = await fetch("/api/v1/games/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: selectedGameIds })
    });
    if (!resp.ok) return;

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
    await fetch("/api/v1/users/me/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: theme.id })
    });
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
    doc.text("EveryGame Tier List", 40, 40);
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
    doc.save("everygame-tier-list.pdf");
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

  if (loading) return <div className="page"><p>Loading app state...</p></div>;

  return (
    <div className="page">
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
      <header className="topbar">
        <div>
          <h1>Tier List Your Games</h1>
          <p>Build your list across every linked platform.</p>
        </div>
        <div className="topbar-actions">
          {screen !== "menu" && (
            <button className="ghost" onClick={() => setScreen("menu")}>
              Back to Menu
            </button>
          )}
        </div>
      </header>

      {screen === "menu" && (
        <main className="menu-grid">
          <button className="menu-card primary" onClick={() => setScreen(hasTierData() ? "editor" : "accounts")}>
            <strong>{hasTierData() ? "Edit your tier list" : "Start your tier list"}</strong>
            <span>{hasTierData() ? "Continue ranking your games." : "Link accounts first, then rank your games."}</span>
          </button>
          <button className="menu-card" onClick={() => setScreen("accounts")}>
            <strong>Add accounts to your tier list</strong>
            <span>Connect supported platforms and sync your library.</span>
          </button>
          <button className="menu-card" onClick={() => setScreen("games")}>
            <strong>Games list</strong>
            <span>Search, filter, add, and bulk remove games.</span>
          </button>
          <button className="menu-card" onClick={() => setScreen("themes")}>
            <strong>Themes</strong>
            <span>Open the full theme list, preview, and apply instantly.</span>
          </button>
          <button className="menu-card" onClick={() => void exportPdf()}>
            <strong>Create PDF</strong>
            <span>Download your current tier list layout.</span>
          </button>
        </main>
      )}

      {screen === "accounts" && (
        <main className="panel">
          <h2>Account Linking</h2>
          <p>Link-only integrations. Manual input happens only in Games list.</p>
          <div className="row wrap">
            <button onClick={() => (window.location.href = "/api/v1/accounts/steam/start")}>Connect Steam (OAuth)</button>
            {steamStatus && <span>{steamStatus}</span>}
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
                <span className={`status status-${p.status}`}>{p.status}</span>
              </div>
            ))}
          </div>

          <h3>Linked accounts</h3>
          {linkedAccounts.length === 0 ? (
            <p>No linked accounts yet.</p>
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

          <button onClick={() => setScreen("editor")}>Continue to Tier Editor</button>
        </main>
      )}

      {screen === "editor" && (
        <main className="panel">
          <div className="row between">
            <h2>Tier Editor</h2>
            <div className="row">
              <button onClick={saveTierList}>Save</button>
              <span>{saveStatus}</span>
            </div>
          </div>

          {games.length === 0 && (
            <p>
              No games yet. Add games in Games list or link an account first.
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
                        <img src={game.coverArtUrl} alt={game.title} />
                        <span>{game.title}</span>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          <h3>Unranked</h3>
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
                    <img src={game.coverArtUrl} alt={game.title} />
                    <span>{game.title}</span>
                  </article>
                );
              })}
            </div>
          </section>
        </main>
      )}

      {screen === "games" && (
        <main className="panel">
          <div className="row between">
            <h2>Games List</h2>
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
            <h3>Manually Add Games</h3>
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
                <img src={g.coverArtUrl} alt={g.title} />
                <div>
                  <strong>{g.title}</strong>
                  <span>
                    {g.platform} | {g.genre} | popularity {g.popularity}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </main>
      )}

      {screen === "themes" && (
        <main className="panel">
          <h2>Themes</h2>
          <p>Pick a theme to apply app-wide instantly.</p>
          <div className="theme-grid">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-card ${themeId === theme.id ? "selected" : ""}`}
                onClick={() => applyTheme(theme)}
              >
                <strong>{theme.name}</strong>
                <span>{theme.tags.join(", ")}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const defaultTheme = themes.find((t) => t.id === "apple-glass-white-default");
              if (defaultTheme) void applyTheme(defaultTheme);
            }}
          >
            Reset to default
          </button>
        </main>
      )}
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
      bgImage: "url('/art/ThemeImages/BlondeAnimeGirlTheme/1.png')"
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
      "/art/ThemeImages/CatStackerTheme/Cats/Cat1.png",
      "/art/ThemeImages/CatStackerTheme/Cats/Cat2.png",
      "/art/ThemeImages/CatStackerTheme/Cats/Cat3.png",
      "/art/ThemeImages/CatStackerTheme/Cats/Cat4.png",
      "/art/ThemeImages/CatStackerTheme/Cats/Cat5.png",
      "/art/ThemeImages/CatStackerTheme/Platforms/teaplatform.png",
      "/art/ThemeImages/CatStackerTheme/Platforms/chickenplatform.png",
      "/art/ThemeImages/CatStackerTheme/Platforms/castleplatform.png"
    ];
  }
  if (themeId === "blonde-anime-glow") {
    return [
      "/art/ThemeImages/BlondeAnimeGirlTheme/1.png",
      "/art/ThemeImages/BlondeAnimeGirlTheme/2.png"
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
