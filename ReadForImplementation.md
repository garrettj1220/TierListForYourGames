# Read For Implementation

## 1) Product Summary
`Tier List Your Games` is a standalone web tool that lets users:
- Link gaming accounts (Steam implemented, others staged).
- Build a personal game library.
- Rank games into `S/A/B/C/D/F` tiers with drag/drop.
- Manage games via search/sort/filter and bulk remove.
- Switch visual themes globally (with art-driven themes).
- Export the current tier layout to PDF.

The app is designed to run independently, then be mounted into a larger site.

---

## 2) Project Structure

Root:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/package.json`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/README.md`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/ReadForImplementation.md`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/.env.example`

Frontend:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/client/src/App.tsx`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/client/src/App.css`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/client/src/index.css`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/client/vite.config.ts`

Backend:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/index.js`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/storage.js`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/themes.js`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/db.js`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/migrate.js`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/migrations/001_init.sql`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/data/db.json` (local fallback)

Art:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/...`

Artifacts:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/...`

---

## 3) Runtime Architecture

Frontend:
- React + Vite + TypeScript.
- Single-page app with in-app screen state (`menu`, `accounts`, `editor`, `games`, `themes`).
- API calls to `/api/v1/...` via Vite proxy.

Backend:
- Node + Express.
- Versioned REST endpoints under `/api/v1`.
- Storage abstraction:
  - Uses Postgres when `DATABASE_URL` exists.
  - Falls back to JSON file storage otherwise.
- Serves theme art files from `/art`.

Storage mode selection:
- Implemented in `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/storage.js` via `createStorage()`.

---

## 4) Data Model (Conceptual)

Core entities:
- `users`
- `linked_accounts`
- `games_normalized`
- `user_games`
- `tier_list_states`
- `user_theme_settings`
- `sync_runs`

Postgres schema is in:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/migrations/001_init.sql`

JSON fallback shape is in:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/data/db.json`

---

## 5) API Endpoints

Health/bootstrap:
- `GET /api/v1/health`
- `GET /api/v1/bootstrap`
- `GET /api/v1/themes`

Accounts:
- `GET /api/v1/accounts`
- `POST /api/v1/accounts/link`

Steam:
- `GET /api/v1/accounts/steam/start`
- `GET /api/v1/accounts/steam/callback`
- `POST /api/v1/accounts/steam/sync/:accountId`

Theme:
- `PUT /api/v1/users/me/theme`

Games:
- `GET /api/v1/games`
- `POST /api/v1/games/manual`
- `POST /api/v1/games/remove`
- `POST /api/v1/metadata/search`

Tier list:
- `PUT /api/v1/tier-list/state`

---

## 6) Frontend Behavior by Screen

Menu:
- Entry point to Start/Edit, Accounts, Games List, Themes, PDF export.

Accounts:
- Link-only account UX.
- Steam OAuth entry.
- Steam sync button for linked Steam accounts.
- Platform cards include `Supported`, `Pilot`, `Coming Soon`.

Editor:
- Drag game cards between S/A/B/C/D/F and Unranked.
- Save sends `tiers + unranked` to backend.
- Shows last saved timestamp if available.

Games List:
- Search by title.
- Sort A-Z / Z-A.
- Filter by genre, platform, popularity.
- Manual add via metadata search.
- Bulk select + remove.

Themes:
- List of professional display names.
- Apply theme globally and persist to backend.
- Reset to default.

---

## 7) Theme System

Catalog source:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/server/src/themes.js`

Important rule:
- `id` is stable machine key (slug).
- `name` is user-facing professional title (Title Case + spaces).

Default:
- `Apple Glass White (Default)` (`themeId = apple-glass-white-default`)

Theme application:
- Client sets CSS variables in `applyThemeVariables()` in `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/client/src/App.tsx`.
- Palette mapping is in `paletteFor(themeId)`.

Art-driven personality:
- `themeSpritesFor(themeId)` chooses sprite/image assets.
- `themeFlavorCopy(themeId)` adds intentional micro-copy.
- Current handcrafted themes:
  - `CatStacker Arcade`
  - `Blonde Anime Glow`

---

## 8) Art and Sprite Integration Rules

Where source art lives:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages`

Where generated/downloaded discovery artifacts live:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/game-art/...`

Implementation rule:
- Use discovered sprites intentionally in UI (strip, badges, decorative anchors, panel motifs), not as random background noise.
- Keep per-theme asset grouping under `Art/ThemeImages/<ThemeName>/`.

---

## 9) Environment Variables

From `.env.example`:
- `PORT`
- `APP_BASE_URL`
- `THEGAMESDB_API_KEY`
- `STEAM_WEB_API_KEY`
- `DATABASE_URL`

Behavior:
- Without `THEGAMESDB_API_KEY`, metadata search falls back to mock seed results.
- Without `DATABASE_URL`, JSON storage is used.
- Steam sync requires `STEAM_WEB_API_KEY`.

---

## 10) Commands

Install:
```bash
npm install
```

Run app:
```bash
npm run dev
```

Build:
```bash
npm run build
```

Run DB migration (Postgres mode):
```bash
npm run migrate --workspace server
```

Headless smoke test:
```bash
node CodexOutput/tests/smoke-test.mjs
```

---

## 11) Testing and Artifacts

Primary smoke test:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/tests/smoke-test.mjs`

Outputs:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/tests/smoke-result.json`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/screenshots/smoke-after-theme.png`

Smoke validates:
- load app
- open games list
- add game
- open editor
- drag to tier
- save
- apply theme
- screenshot

---

## 12) Known Gaps / Next Implementation Targets

1. Full multi-platform connectors beyond Steam are still staged.
2. Authentication is currently demo-user scoped; integrate real user auth context.
3. PDF export is client-side; server-side render pipeline can be added for deterministic output.
4. Editor currently uses native drag/drop; consider `dnd-kit` for richer interactions.
5. Expand handcrafted sprite integration to more themes.
6. Add virtualization for very large game lists.

---

## 13) Implementation Conventions for Future AI

1. Preserve stable API versioning under `/api/v1`.
2. Keep display names professional and human-readable.
3. Keep internal IDs slug-based and stable.
4. Store generated artifacts only under `CodexOutput/`.
5. Keep art grouped by theme under `Art/ThemeImages/`.
6. Run build + headless smoke before shipping changes.
7. Avoid introducing manual account import flow in Accounts; manual add belongs in Games List.
