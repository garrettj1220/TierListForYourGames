# Theme Ideas - Tier List Your Games

## 1. Goal
Define a broad theme catalog that applies to the entire tool (main menu, accounts, editor, games list, and PDF export style).

Theme sources:
- Standard built-in visual themes.
- Art-driven themes powered by images in:
  - `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/CatStackerTheme`
  - `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/BlondeAnimeGirlTheme`

---

## 2. Core Theme Token Model (Shared)
Each theme should define:
- `themeId`
- `displayName` (Title Case, professional spacing)
- `name`
- `mode` (`light`, `dark`, `hybrid`)
- `fontHeading`
- `fontBody`
- `colorBg`
- `colorSurface`
- `colorSurfaceAlt`
- `colorTextPrimary`
- `colorTextSecondary`
- `colorAccent`
- `colorAccent2`
- `tierColors` (`S/A/B/C/D/F`)
- `cardStyle` (`flat`, `soft`, `glass`, `outline`, `comic`)
- `radiusScale` (`sm`, `md`, `lg`, `xl`)
- `shadowStyle`
- `backgroundStyle` (`solid`, `gradient`, `pattern`, `art`)
- `artOverlay` (optional)

---

## 3. Standard Themes (Non-Art)
1. `Apple Glass White (Default)` (`themeId`: `apple-glass-white-default`)
- Apple-glass inspired white theme with frosted panels, soft blur, subtle depth, and crisp readability.

2. `Classic Clean` (`themeId`: `classic-clean`)
- Neutral modern UI, high readability, low visual noise.

3. `Minimal Light` (`themeId`: `minimal-light`)
- White/gray palette, subtle separators, strong contrast text.

4. `Minimal Dark` (`themeId`: `minimal-dark`)
- Charcoal surfaces, cool accents, low-glare reading.

5. `Neon Arcade` (`themeId`: `neon-arcade`)
- Bright cyan/magenta accents, dark arcade backdrop, energetic UI.

6. `Retro Pixel` (`themeId`: `retro-pixel`)
- Pixel-font headings, chunky borders, nostalgic game-panel style.

7. `Esports Stage` (`themeId`: `esports-stage`)
- Sharp contrast, bold accent bars, broadcast-style information layout.

8. `Pastel Pop` (`themeId`: `pastel-pop`)
- Soft pastel gradients with playful cards and rounded corners.

9. `Mono Pro` (`themeId`: `mono-pro`)
- Monochrome palette with structure-first hierarchy and clean outlines.

10. `Forest Calm` (`themeId`: `forest-calm`)
- Natural greens, warm neutrals, soft texture background.

11. `High Contrast Access` (`themeId`: `high-contrast-access`)
- Accessibility-first palette with maximum text/button contrast.

12. `Paper Zine` (`themeId`: `paper-zine`)
- Off-white paper tones, print-style lines, editorial panel framing.

13. `Cyber Grid` (`themeId`: `cyber-grid`)
- Dark grid background, electric highlights, techno panel borders.

---

## 4. Art-Based Themes

### 4.1 CatStacker Theme
Display Name: `CatStacker Arcade`
`themeId`: `catstacker-arcade`

Art direction:
- Cute arcade-cat vibe.
- Rounded “loaf cat” silhouettes and playful UI.
- Cozy-but-energetic look with soft shading and bright gradients.

Asset source:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/CatStackerTheme/Cats`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/CatStackerTheme/Platforms`

Visual rules:
- Background: warm pastel gradient with subtle floating cat icons.
- Surfaces: soft, rounded cards with gentle shadows.
- Buttons: pill-shaped, bouncy hover animation.
- Tier rows: color-coded with fun but readable contrast.
- Empty states: cat-themed mascots/illustrations.

Suggested token profile:
- `mode`: `hybrid`
- `fontHeading`: playful rounded display
- `fontBody`: clean sans
- `cardStyle`: `soft`
- `radiusScale`: `xl`
- `backgroundStyle`: `art`
- `shadowStyle`: soft bloom
- `tierColors`:
  - `S`: `#FFB703`
  - `A`: `#8ECAE6`
  - `B`: `#90BE6D`
  - `C`: `#F9C74F`
  - `D`: `#F9844A`
  - `F`: `#F94144`

Motion style:
- Gentle spring easing for card drops.
- Tiny wobble settle after drag-drop.

### 4.2 Blonde Anime Girl Theme
Display Name: `Blonde Anime Glow`
`themeId`: `blonde-anime-glow`

Art direction:
- Character-led anime aesthetic with polished, elegant UI.
- Soft glow, clean linework, vivid accent framing.

Asset source:
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/BlondeAnimeGirlTheme/1.png`
- `/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/Art/ThemeImages/BlondeAnimeGirlTheme/2.png`

Visual rules:
- Background: blurred/faded character art behind a readability scrim.
- Surfaces: semi-opaque panels for text legibility.
- Accent system: gold + sky-blue (or pink-gold variant).
- Tier rows: balanced saturation to keep game cards readable.

Suggested token profile:
- `mode`: `hybrid`
- `fontHeading`: stylized serif/sans display
- `fontBody`: readable sans
- `cardStyle`: `glass`
- `radiusScale`: `lg`
- `backgroundStyle`: `art`
- `shadowStyle`: soft neon edge
- `tierColors`:
  - `S`: `#F4C95D`
  - `A`: `#8EC5FC`
  - `B`: `#B9FBC0`
  - `C`: `#FFD6A5`
  - `D`: `#FFADAD`
  - `F`: `#FF6B6B`

Motion style:
- Smooth fade + parallax drift on menu background.
- Fast snap feedback on drag-drop for responsiveness.

---

## 5. Approved Expansion Themes
These are approved and should be included in the theme catalog:

1. `ocean-depths`
- Deep blue gradients, glassy bubbles, clean aqua accents.

2. `desert-gold`
- Warm sand tones, sun-baked highlights, sharp amber tier bars.

3. `noir-detective`
- Black/cream palette, film-grain texture, red accent markers.

4. `graffiti-street`
- Spray-paint textures, bold color splashes, sticker-like cards.

5. `arcane-library`
- Dark wood + parchment palette, mystical glow details.

6. `jungle-ruins`
- Stone + moss textures, earthy greens, relic-style borders.

7. `candy-rush`
- High-saturation sweets palette, glossy UI, playful rounded shapes.

8. `glacier-tech`
- Icy cyan + silver tones, crisp borders, minimal futuristic look.

9. `volcanic-core`
- Charcoal base, lava orange highlights, energetic heat-glow effects.

10. `royal-velvet`
- Deep regal palette with gold trim and premium trophy framing.

11. `synth-sunset`
- Orange-pink dusk gradients, retro horizon lines, neon accents.

12. `comic-pop`
- Halftone dots, bold outlines, panel-style card framing.

13. `horror-arcade`
- Muted blacks/reds, subtle distortion textures, dramatic tier contrast.

14. `zen-garden`
- Stone neutrals, soft greens, calm low-noise minimalist UI.

15. `meadow-story`
- Soft floral tones, light paper texture, cozy whimsical vibe.

Also retained from prior approved concept list:
16. `celestial-shrine`
- Moonlit sky gradients, shrine motifs, calm mystical UI framing.

17. `mecha-hangar`
- Industrial dark panels, warning accents, angular chrome borders.

18. `vapor-dream`
- Sunset neon gradients, soft grain, retro-futurist glass cards.

19. `storybook-fantasy`
- Painted texture, parchment panels, whimsical iconography.

20. `storm-racer`
- Rain streak overlays, speed-line accents, electric blue highlights.

21. `samurai-ink`
- Ink brush textures, black/red minimalism, elegant strong typography.

22. `space-opera`
- Starfield motion background, holographic cards, luminous edges.

23. `chibi-cafe`
- Cozy pastel interiors, sticker-like cards, warm cute UI tone.

---

## 6. Theme UX Requirements
Main menu `Themes` panel should support:
- Grid preview cards for all themes.
- Live preview before applying.
- Search/filter by tags (`cute`, `dark`, `anime`, `arcade`, `minimal`).
- Favorite themes.
- One-click reset to default.

Persistence behavior:
- Save selected theme to backend user settings.
- Apply instantly app-wide.
- Include theme style in PDF export.
- First-time users start on `Apple Glass White (Default)`.

Fallback behavior:
- If art assets fail to load, use the nearest non-art fallback theme.

---

## 7. Launch Recommendation
Approved catalog includes:
- 13 standard themes.
- 2 featured art themes (`CatStacker`, `Blonde Anime Girl`).
- 23 expansion themes.

Release plan:
- Phase 1 launch pack: 12-16 themes.
- Phase 2 content pack: remaining approved themes.

All approved themes remain available in the main menu `Themes` list and can be rolled out progressively behind feature flags.
