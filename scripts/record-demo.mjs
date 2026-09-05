import { chromium } from "playwright";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve("demo-artifacts");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: outputDir, size: { width: 1280, height: 800 } },
  colorScheme: "light",
});
const page = await context.newPage();
await page.goto("https://burning-maps.vercel.app", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);

await page.addStyleTag({
  content: `
    #demo-caption {
      position: fixed;
      z-index: 10000;
      left: 50%;
      bottom: 28px;
      width: min(760px, calc(100% - 40px));
      transform: translateX(-50%);
      padding: 15px 22px;
      color: #fffdf7;
      background: rgba(17, 18, 15, 0.94);
      border-left: 5px solid #b64d32;
      box-shadow: 0 18px 60px rgba(23, 25, 20, 0.28);
      font: 700 18px/1.3 "IBM Plex Sans Condensed", sans-serif;
      letter-spacing: 0.02em;
      pointer-events: none;
    }
  `,
});
await page.evaluate(() => {
  const caption = document.createElement("div");
  caption.id = "demo-caption";
  document.body.appendChild(caption);
});

async function caption(text, duration = 2600) {
  await page.locator("#demo-caption").evaluate((element, copy) => {
    element.textContent = copy;
  }, text);
  await page.waitForTimeout(duration);
}

await caption("This is Turtle Maps in a disaster-response mode — the same map-first mobile workflow.", 3200);
await caption("No login is required for judging. Start with a plain-language relief mission.", 2800);

await page.locator("#begin-mission").click();
await caption("Destination, vehicle and mission constraints stay together in the familiar Turtle route draft.", 3200);

await page.locator("#build-route").click();
await page.waitForTimeout(900);
await caption("Burning Lens compares route options using timestamped official and field evidence.", 3400);
await caption("The faster river route is rejected because two reports mark its bridge impassable.", 3300);
await caption("Sources and confidence stay visible before a human starts the selected route.", 2900);

await page.locator("#start-route").click();
await caption("The active mission keeps Turtle's live map and safety check-in workflow.", 3000);

await page.locator("#active-action").click();
await caption("A new access report invalidates the route while the team is moving.", 2800);
await page.waitForTimeout(1400);
await caption("Burning Maps proposes the verified fallback and keeps dispatch control with the team.", 3400);

await page.locator("#check-in").click();
await caption("Team K–2 checks in safely; the next confirmation remains scheduled.", 3000);
await caption("When floods erase the road, Burning Maps helps teams decide what remains reachable.", 3400);
await caption("Try it now: burning-maps.vercel.app", 3200);

const video = page.video();
await context.close();
await browser.close();

if (video) {
  const sourcePath = await video.path();
  await rename(sourcePath, path.join(outputDir, "BurningMaps-Demo.webm"));
}
