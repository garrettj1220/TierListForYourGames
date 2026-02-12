import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = "/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/tests";
const shotsDir = "/Users/garrettjohnson/Desktop/Tools/Tier List Your Games/CodexOutput/screenshots";

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(shotsDir, { recursive: true });

const results = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);

try {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
  results.push("loaded_app");

  await page.getByRole("button", { name: "Games list" }).click();
  results.push("opened_games_list");

  await page.getByPlaceholder("Search game title...").fill("Hades");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add" }).first().waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Add" }).first().click();
  results.push("added_manual_game");

  await page.getByRole("button", { name: "Back to Menu" }).click();
  await page.getByRole("button", { name: /Start your tier list|Edit your tier list/ }).click();
  results.push("opened_editor");

  const unrankedCard = page.locator(".tier-row").nth(6).locator(".game-card").first();
  await unrankedCard.waitFor({ state: "visible" });
  const sTierDrop = page.locator(".tier-row").first();
  await unrankedCard.dragTo(sTierDrop);
  results.push("dragged_to_s_tier");

  await page.getByRole("button", { name: "Save" }).click();
  results.push("saved_tier_state");

  await page.getByRole("button", { name: "Back to Menu" }).click();
  await page.getByRole("button", { name: "Themes" }).click();
  await page.getByRole("button", { name: /catstacker arcade/i }).click();
  results.push("applied_theme");

  const shot = path.join(shotsDir, "smoke-after-theme.png");
  await page.screenshot({ path: shot, fullPage: true });
  results.push(`screenshot:${shot}`);

  await fs.writeFile(
    path.join(outDir, "smoke-result.json"),
    JSON.stringify({ ok: true, steps: results }, null, 2)
  );
} catch (error) {
  await fs.writeFile(
    path.join(outDir, "smoke-result.json"),
    JSON.stringify({ ok: false, steps: results, error: String(error) }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
