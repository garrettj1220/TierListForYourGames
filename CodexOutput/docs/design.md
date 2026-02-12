# Tier List Your Games - Design Doc (Draft v1)

## 1. Product Summary
Build a page on your personal website where users can create a tier list from every game they have played across connected gaming accounts, plus manually added games.

Primary value:
- Pull owned/played games from linked platforms.
- Normalize each game with title + cover art.
- Let users drag games into `S/A/B/C/D/F` tiers.
- Save to shared cloud state and export as PDF.

## 2. Main Menu Requirements
Main menu actions:
- `Start your tier list` (first-time setup).
- `Edit your tier list` (if saved data exists).
- `Add accounts to your tier list`.
- `Games list` (manage imported/manual games).
- `Themes` (choose visual style for app + tier list presentation).
- `Create PDF` (download tier list as PDF).

Behavior:
- If no tier list exists yet, steer user to start flow.
- If tier list exists, allow immediate edit and account management.
- `Themes` opens a full themes list modal/page with preview, apply, and reset actions.
- Applying a theme updates the full app immediately and persists to backend user settings.
- Default theme is `Apple Glass White (Default)`.

## 3. First-Time Flow
1. User clicks `Start your tier list`.
2. User lands on `Add accounts` screen.
3. User chooses account type and links one or more accounts.
4. App fetches accessible game libraries + playtime (where supported).
5. User clicks `Continue` to tier editor.

Rule:
- Account flow is link-only via supported integrations. No manual account entry/import mode.

Supported account types (initial target list):
- Steam
- Epic Games
- Battle.net
- Nintendo
- PlayStation
- Xbox
- GOG
- Riot
- EA App / Origin
- Ubisoft Connect
- Itch.io

Account connection behavior:
- If a platform integration is not available in V1, show it as `Coming soon` in the account picker.
- Manual game additions happen only in `Games list`, not in account linking.

## 4. Tier Editor Requirements
Layout:
- Fixed tier rows: `S`, `A`, `B`, `C`, `D`, `F`.
- Each row contains draggable game cells.
- Game cell content: cover art + title.

Interactions:
- Drag/drop cells between tiers.
- Reorder inside a tier.
- Keep an `Unranked` pool for games not yet placed.
- `Save` button persists state to backend profile storage.
- `Back to menu` button always available.

Persistence:
- Save all current placements to backend using authenticated user profile.
- On return to editor, hydrate from backend snapshot.
- Optional: keep a local cache copy for faster reload/offline recovery.

## 5. Games List Requirements
Purpose:
- Manage all games currently known in the tier list profile.

Features:
- Search by title.
- Sort alphabetically (`A-Z`, `Z-A`).
- Filter by categories/genres.
- Filter by platforms.
- Filter by popularity.
- Bulk select with checkboxes.
- Bulk remove via top-right `Remove` action.
- Manually add games.

Manual add flow:
- Enter game name.
- Query Games DB API.
- User selects correct match.
- Add normalized game to list.

## 6. PDF Export Requirements
From main menu:
- `Create PDF` generates a formatted snapshot of current tier layout.
- PDF includes tier headers and game cells (title + optional cover thumbnail).
- File downloads to user device.
- Export uses the currently selected theme styling.

## 6.5 Theme System Requirements
Goal:
- Let users customize the look/feel of their tier list experience.

Core requirements:
- Theme picker available from main menu.
- Provide a broad preset library at launch (multiple distinct looks).
- Apply selected theme across menu, editor, games list, and PDF export styling.
- Preview theme before confirm.
- Persist selected theme in backend user settings.

Theme data model (V1):
- `themeId`
- `name`
- `tokens` (colors, typography, card style, backgrounds, tier row styling)

Suggested V1 preset set:
- Classic
- Neon Arcade
- Minimal Light
- Minimal Dark
- Retro Pixel
- Esports
- Fantasy
- Synthwave
- Monochrome
- High Contrast

## 7. Data & Integration Architecture
### 7.1 Core Data Objects
`LinkedAccount`
- `id`
- `platform`
- `displayName`
- `linkedAt`
- `accessTokenRef` (if backend-backed)

`Game`
- `id` (internal normalized id)
- `sourcePlatformIds` (array/map)
- `title`
- `coverArtUrl`
- `playtimeMinutes` (nullable)
- `manuallyAdded` (boolean)

`TierListState`
- `tiers`: map of tier name -> ordered game ids
- `unranked`: ordered game ids
- `updatedAt`

### 7.2 Game Normalization Pipeline
1. Pull raw game entries per platform.
2. De-duplicate cross-platform duplicates (same game on multiple services).
3. Resolve canonical title using Games DB API.
4. Attach best cover art from Games DB response.
5. Store normalized games for editor/list screens.

### 7.3 Platform Pull Strategy
Goal:
- Pull games + playtime where APIs and permissions allow.

Reality note:
- Not all platforms expose full public library/playtime APIs.
- Some platforms require official partner approval or have limited scopes.

Implementation approach:
- Use direct OAuth/API for platforms that support it.
- If a platform cannot be integrated in V1, mark it as `Coming soon` in accounts UI.
- Always support manual add in `Games list` so flow never blocks.

## 8. Frontend Information Architecture
Routes/pages:
- `/tierlist` -> Main menu
- `/tierlist/accounts` -> Link/manage accounts
- `/tierlist/editor` -> Drag/drop tier editor
- `/tierlist/games` -> Search/sort/bulk manage list

UI state:
- Detect existing saved state from backend profile at app start.
- Show `Start` vs `Edit` CTAs based on saved state.

## 9. Storage Model
V1 shared backend storage:
- `users`
- `linked_accounts`
- `games_normalized`
- `user_games`
- `tier_list_states`
- `user_theme_settings`

Optional local cache keys:
- `egtier.cache.games.v1`
- `egtier.cache.tierstate.v1`
- `egtier.cache.theme.v1`

## 10. Technical Stack (Suggested)
- Frontend: React + Vite + TypeScript
- Drag and drop: `dnd-kit`
- Data fetching/state sync: `tanstack-query`
- Backend: Node.js (`Fastify` or `Express`) + Postgres
- Auth: existing site auth/session integration
- Jobs (optional V1, recommended V2): queue workers for account sync
- PDF generation:
  - MVP: `jspdf` + `html2canvas` (client-side)
  - V2: server-side Playwright/Puppeteer for consistent rendering
- Styling: your website's existing design system + theme token layer

## 11. MVP Scope
In MVP, ship:
- Main menu and all core navigation.
- Account linking UI for supported API integrations only.
- Games normalization using Games DB API.
- Tier editor with drag/drop + save.
- Games list with search/sort/filter (categories, platforms, popularity), bulk remove, and manual add.
- Theme system with preset library and persisted selection.
- PDF export from current tier layout.
- backend-backed shared persistence (cross-device).

Defer:
- Real-time collaboration.
- Public tier list profiles.
- Social sharing feed.
- Advanced analytics/recommendations.
- CSV import/export.

## 12. Risks and Constraints
- Platform API limitations may block fully automatic import on some services.
- Duplicate matching can misidentify titles without a strong normalization strategy.
- Large libraries (500-2000+ games) need virtualization for performance.
- Cover art licensing/usage terms must be reviewed.

## 13. Next Design Decisions Needed
1. Which platforms are hard requirement for launch vs later?
2. What Games DB API are we standardizing on (IGDB, RAWG, GiantBomb, etc.)?
3. Is playtime required everywhere or optional when unavailable?
4. Should removed games stay hidden or be fully deleted from storage?
5. Should we support guest mode with temporary local cache before login?

## 14. Integration Strategy (Own Repo -> Personal Site)
Deployment model:
- Build and deploy this tool as its own app/repo first.
- Integrate into personal site via route mount or reverse proxy (for example `/tools/tierlist`).

Integration contract:
- Expose stable versioned APIs under `/api/v1/...`.
- Keep domain logic in backend services, not UI-only logic.
- Share authentication/session context with main site where possible.
- Keep UI visually aligned via shared design tokens.

Benefits:
- Independent release cycle for the tool.
- Safer iteration without touching core website pages.
- Cleaner rollback/versioning when features change.

## 15. Backend Service Boundaries
- `account-link-service`: handle platform OAuth/link lifecycle.
- `import-service`: pull owned/played games + playtime where available.
- `normalization-service`: map raw titles to canonical metadata provider entries.
- `dedupe-service`: merge duplicates across platforms into canonical user-game rows.
- `tierlist-service`: manage tiers, ordering, themes, and snapshots.
- `export-service`: generate downloadable PDF artifacts.

## 16. Platform Capability Matrix (Launch Plan)
`Supported in V1 (API-linked)`:
- Steam

`Pilot/Partial in V1 if feasible`:
- Xbox (title history/playtime may be partial)
- PlayStation (availability depends on approved access)

`Coming soon (show in UI, disabled)`:
- Epic Games
- Battle.net
- Nintendo
- GOG
- Riot
- EA App / Origin
- Ubisoft Connect
- Itch.io

Rules:
- Account linking screen only supports true integrations.
- No manual account import mode.
- Manual input is only via `Games list -> Add games`.

## 17. External Metadata and Caching Strategy
Recommended pattern:
- DB-first lookup, external API on cache miss.

Flow:
1. Attempt to match game in `games_normalized`.
2. If found, reuse cached canonical metadata.
3. If not found, query chosen games metadata API.
4. Normalize + persist canonical record.
5. Reuse cached record for future users/imports.

Why:
- Faster response and lower third-party API usage.
- More stable data over time.
- Better control over metadata quality and fallback behavior.
