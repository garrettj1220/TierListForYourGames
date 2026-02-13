import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Screen = "setup" | "accounts" | "games" | "editor";
type TierKey = "S" | "A" | "B" | "C" | "D" | "F";
type ThemeMode = "dark" | "light";

type Game = {
  id: string;
  sourceKey?: string | null;
  title: string;
  platform: string;
  genre: string;
  popularity: number;
  playtimeMinutes: number;
  coverArtUrl: string;
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

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const TIER_KEYS: TierKey[] = ["S", "A", "B", "C", "D", "F"];
const DEFAULT_TIER_STATE: TierListState = { tiers: { S: [], A: [], B: [], C: [], D: [], F: [] }, unranked: [], updatedAt: null };
const ACCOUNT_PLATFORMS = ["Steam", "Xbox", "PlayStation"];

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

function assetUrl(path: string) {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("data:")) return path;
  if (path.startsWith("/")) return API_BASE ? `${API_BASE}${path}` : path;
  return path;
}

function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("setup");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tierState, setTierState] = useState<TierListState>(DEFAULT_TIER_STATE);
  const [dragGameId, setDragGameId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const [newAccountPlatform, setNewAccountPlatform] = useState("Steam");
  const [newAccountName, setNewAccountName] = useState("");

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchSource, setSearchSource] = useState<"local" | "external">("local");
  const [searching, setSearching] = useState(false);

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

  const hasSetup = linkedAccounts.length > 0 || games.length > 0;

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const steam = params.get("steam");
    if (!steam) return;
    if (steam === "linked") setStatus("Steam account connected.");
    if (steam === "failed") setStatus("Steam sign-in failed.");
    window.history.replaceState({}, "", window.location.pathname);
    void refreshAll();
  }, []);

  async function refreshAll() {
    try {
      const bootstrapResp = await fetch(apiUrl("/api/v1/bootstrap"));
      const bootstrap = await bootstrapResp.json();
      const nextAccounts = (bootstrap?.linkedAccounts ?? []) as LinkedAccount[];
      const nextGames = ((bootstrap?.games ?? []) as Game[]).map((g) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl) }));
      const nextTheme = bootstrap?.theme?.themeId === "light" ? "light" : "dark";

      setLinkedAccounts(nextAccounts);
      setGames(nextGames);
      setTierState(bootstrap?.tierListState ?? DEFAULT_TIER_STATE);
      setThemeMode(nextTheme);
      if (nextAccounts.length > 0 || nextGames.length > 0) {
        setScreen((s) => (s === "setup" ? "accounts" : s));
      } else {
        setScreen("setup");
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveTierList() {
    setStatus("Saving...");
    const resp = await fetch(apiUrl("/api/v1/tier-list/state"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiers: tierState.tiers, unranked: tierState.unranked })
    });
    setStatus(resp.ok ? "Saved" : "Save failed");
    setTimeout(() => setStatus(""), 1200);
  }

  async function setMode(mode: ThemeMode) {
    setThemeMode(mode);
    await fetch(apiUrl("/api/v1/users/me/theme"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ themeId: mode })
    });
  }

  async function addManualAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newAccountName.trim()) return;
    const resp = await fetch(apiUrl("/api/v1/accounts/link"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: newAccountPlatform, accountName: newAccountName.trim() })
    });
    if (!resp.ok) return;
    const json = await resp.json();
    setLinkedAccounts((prev) => [json.linked, ...prev]);
    setNewAccountName("");
  }

  async function removeAccount(accountId: string) {
    const resp = await fetch(apiUrl(`/api/v1/accounts/${accountId}`), { method: "DELETE" });
    if (!resp.ok) return;
    setLinkedAccounts((prev) => prev.filter((a) => a.id !== accountId));
  }

  async function syncSteamAccount(accountId: string) {
    setSyncingAccountId(accountId);
    const resp = await fetch(apiUrl(`/api/v1/accounts/steam/sync/${accountId}`), { method: "POST" });
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
    const resp = await fetch(apiUrl("/api/v1/accounts/sync-all"), { method: "POST" });
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

  async function searchLocal() {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchSource("local");
    const resp = await fetch(apiUrl("/api/v1/metadata/search/local"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery.trim() })
    });
    const json = await resp.json().catch(() => ({ results: [] }));
    setSearchResults((json.results ?? []).map((g: SearchResult) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl || "") })));
    setSearching(false);
  }

  async function searchExternal() {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchSource("external");
    const resp = await fetch(apiUrl("/api/v1/metadata/search/external"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery.trim() })
    });
    const json = await resp.json().catch(() => ({ results: [] }));
    setSearchResults((json.results ?? []).map((g: SearchResult) => ({ ...g, coverArtUrl: assetUrl(g.coverArtUrl || "") })));
    setSearching(false);
  }

  async function addGame(result: SearchResult) {
    const resp = await fetch(apiUrl("/api/v1/games/manual"), {
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
    const resp = await fetch(apiUrl("/api/v1/games/remove"), {
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

  function dropGame(gameId: string, target: TierKey | "UNRANKED", insertIndex?: number) {
    setTierState((prev) => {
      const next: TierListState = {
        ...prev,
        tiers: { S: [...prev.tiers.S], A: [...prev.tiers.A], B: [...prev.tiers.B], C: [...prev.tiers.C], D: [...prev.tiers.D], F: [...prev.tiers.F] },
        unranked: [...prev.unranked]
      };
      next.unranked = next.unranked.filter((id) => id !== gameId);
      for (const key of TIER_KEYS) next.tiers[key] = next.tiers[key].filter((id) => id !== gameId);
      if (target === "UNRANKED") next.unranked.splice(insertIndex ?? next.unranked.length, 0, gameId);
      else next.tiers[target].splice(insertIndex ?? next.tiers[target].length, 0, gameId);
      return next;
    });
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Tier List Your Games</h1>
          <p>Created by GarrettJPG</p>
        </div>
        <div className="header-actions">
          <button onClick={() => void setMode(themeMode === "dark" ? "light" : "dark")}>
            {themeMode === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
          <button onClick={() => void exportPdf()}>Export PDF</button>
        </div>
      </header>

      {status && <div className="status-banner">{status}</div>}

      <nav className="app-nav">
        <button className={screen === "setup" ? "active" : ""} onClick={() => setScreen("setup")}>Setup</button>
        <button className={screen === "accounts" ? "active" : ""} onClick={() => setScreen("accounts")}>Accounts</button>
        <button className={screen === "games" ? "active" : ""} onClick={() => setScreen("games")}>Games</button>
        <button className={screen === "editor" ? "active" : ""} onClick={() => setScreen("editor")}>Tier List</button>
      </nav>

      {screen === "setup" && (
        <section className="panel setup-panel">
          <h2>Setup</h2>
          {!hasSetup ? (
            <>
              <p>Start by connecting an account.</p>
              <button className="primary" onClick={() => setScreen("accounts")}>Start Setup</button>
            </>
          ) : (
            <>
              <p>Your workspace is ready.</p>
              <div className="setup-stats">
                <div><strong>{games.length}</strong><span>Games</span></div>
                <div><strong>{linkedAccounts.length}</strong><span>Accounts</span></div>
              </div>
            </>
          )}
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
                  <button onClick={() => (window.location.href = apiUrl("/api/v1/accounts/steam/start"))}>Connect</button>
                ) : (
                  <button
                    onClick={() => {
                      setNewAccountPlatform(platform);
                      setNewAccountName("");
                    }}
                  >
                    Add Account
                  </button>
                )}
              </article>
            ))}
          </div>

          <form className="inline-form" onSubmit={addManualAccount}>
            <select value={newAccountPlatform} onChange={(e) => setNewAccountPlatform(e.target.value)}>
              {ACCOUNT_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
            <input value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="Account name" />
            <button type="submit">Add</button>
          </form>

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
                  <img src={assetUrl(g.coverArtUrl)} alt={g.title} />
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
            <button onClick={() => void saveTierList()}>Save</button>
          </div>
          <div className="tier-wrap">
            {TIER_KEYS.map((tier) => (
              <section
                key={tier}
                className={`tier-row tier-${tier}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragGameId && dropGame(dragGameId, tier)}
              >
                <header>{tier}</header>
                <div className="tier-cards">
                  {tierState.tiers[tier].map((id, idx) => {
                    const game = gameMap.get(id);
                    if (!game) return null;
                    return (
                      <article
                        key={id}
                        className="tier-game"
                        draggable
                        onDragStart={() => setDragGameId(id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dragGameId && dropGame(dragGameId, tier, idx)}
                      >
                        <img src={assetUrl(game.coverArtUrl)} alt={game.title} />
                        <span>{game.title}</span>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

            <section
              className="tier-row tier-pool"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragGameId && dropGame(dragGameId, "UNRANKED")}
            >
              <header>Unranked</header>
              <div className="tier-cards">
                {tierState.unranked.map((id, idx) => {
                  const game = gameMap.get(id);
                  if (!game) return null;
                  return (
                    <article
                      key={id}
                      className="tier-game"
                      draggable
                      onDragStart={() => setDragGameId(id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dragGameId && dropGame(dragGameId, "UNRANKED", idx)}
                    >
                      <img src={assetUrl(game.coverArtUrl)} alt={game.title} />
                      <span>{game.title}</span>
                    </article>
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
              <button onClick={() => void searchLocal()} disabled={searching}>{searching ? "Searching..." : "Search"}</button>
            </div>
            {searchSource === "local" && searchResults.length === 0 && searchQuery.trim().length >= 2 && !searching && (
              <button onClick={() => void searchExternal()}>Expand Search</button>
            )}
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
    </div>
  );
}

export default App;
