# Tier List Your Games MVP

Standalone Tier List Your Games with:
- Main menu flow (`Start/Edit`, `Accounts`, `Games list`, `Themes`, `Create PDF`)
- Backend-backed persistence (dev JSON store shaped like shared DB entities)
- Tier editor (`S/A/B/C/D/F` + unranked) with drag/drop + save
- Games list with search/sort/filter + bulk remove + manual add
- Theme switching app-wide with `Apple Glass White (Default)`
- Steam OAuth connect + Steam owned-games sync endpoint
- Headless smoke test artifact output

## Run

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- API: http://localhost:8787/api/v1/health

## Optional TheGamesDB key

Add `.env` in repo root (or export env vars in shell):

```bash
THEGAMESDB_API_KEY=your_key
PORT=8787
APP_BASE_URL=http://localhost:8787
STEAM_WEB_API_KEY=your_steam_web_api_key
DATABASE_URL=postgres://user:pass@localhost:5432/tier_list_your_games
```

Without key, metadata search uses a mock fallback set.

## Postgres migration

If `DATABASE_URL` is set, the API uses Postgres automatically.

```bash
npm run migrate --workspace server
```

## Headless smoke test

```bash
node CodexOutput/tests/smoke-test.mjs
```

Outputs:
- `CodexOutput/tests/smoke-result.json`
- `CodexOutput/screenshots/smoke-after-theme.png`

## Key Paths

- Design doc: `CodexOutput/docs/design.md`
- Themes doc: `CodexOutput/docs/themes.md`
- API server: `server/src/index.js`
- Client app: `client/src/App.tsx`
