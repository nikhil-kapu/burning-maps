import { chromium } from "playwright";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("demo-artifacts");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 410, height: 920 },
  recordVideo: { dir: outputDir, size: { width: 410, height: 920 } },
  colorScheme: "light",
});
const page = await context.newPage();
await page.goto("https://burning-maps.vercel.app", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

async function pause(_description, duration = 2600) {
  await page.waitForTimeout(duration);
}

await pause("Turtle Maps response mode home", 2400);

await page.locator("#begin-mission").click();
await pause("Review destination and mission brief", 2800);

await page.locator("#build-route").click();
await page.waitForTimeout(900);
await pause("Review route evidence", 3800);
await page.locator(".evidence-card").scrollIntoViewIfNeeded();
await pause("Inspect attached sources and confidence", 3200);
await page.locator("#start-route").scrollIntoViewIfNeeded();
await pause("Human starts selected route", 1800);

await page.locator("#start-route").click();
await pause("Active relief journey", 3000);

await page.locator("#active-action").click();
await pause("Replan around new access report", 3200);

await page.locator("#check-in").click();
await pause("Team K–2 checks in", 3200);

const video = page.video();
await context.close();
await browser.close();

if (video) {
  const sourcePath = await video.path();
  await rename(sourcePath, path.join(outputDir, "BurningMaps-Demo.webm"));
}
