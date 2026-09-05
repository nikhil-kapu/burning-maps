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
await page.goto("https://burning-maps.vercel.app", { waitUntil: "networkidle" });

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
      background: rgba(23, 25, 20, 0.94);
      border-left: 5px solid #e85d2a;
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

await caption("After a flood, the shortest route on an ordinary map may no longer exist.", 3200);
await caption("Burning Maps turns timestamped reports into a human-approved relief mission.", 3000);

await page.getByRole("button", { name: "Analyze access evidence" }).click();
await caption("First, it checks official sources and field observations against every route candidate.", 3400);

await page.locator("#decision-panel").scrollIntoViewIfNeeded();
await caption("The faster river corridor is rejected because two reports mark its bridge impassable.", 3500);
await caption("Every recommendation keeps source age and confidence visible.", 2800);

await page.getByRole("button", { name: "Human approve & dispatch" }).click();
await caption("The system cannot dispatch by itself. A coordinator remains accountable.", 3000);

await page.getByRole("button", { name: "Simulate new road closure" }).click();
await caption("A new field report now invalidates the active route.", 2900);
await caption("The workflow recovers: it selects a longer fallback and lowers confidence instead of silently rerouting.", 3900);

await page.getByRole("button", { name: "Confirm responder check-in" }).click();
await caption("Team K–2 checks in safely. The access desk schedules the next confirmation.", 3200);
await caption("When floods erase the road, Burning Maps helps teams decide what remains reachable.", 3800);
await caption("Try it now: burning-maps.vercel.app", 3200);

const video = page.video();
await context.close();
await browser.close();

if (video) {
  const sourcePath = await video.path();
  await rename(sourcePath, path.join(outputDir, "BurningMaps-Demo.webm"));
}
