import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const base = "/image-splitter-check/";
const build = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--outDir", "dist-subpath"],
  { stdio: "inherit", env: { ...process.env, VITE_BASE_PATH: base } },
);
await new Promise((resolve, reject) =>
  build.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`Build failed: ${code}`)),
  ),
);
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
    "--outDir",
    "dist-subpath",
  ],
  { stdio: "pipe", env: { ...process.env, VITE_BASE_PATH: base } },
);
let browser;
try {
  const url = `http://127.0.0.1:4174${base}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  });
  const context = await browser.newContext(),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("ここから、画像を分割。").waitFor();
  const manifest = await (await fetch(`${url}manifest.webmanifest`)).json();
  assert.equal(manifest.scope, base);
  assert.equal(manifest.start_url, base);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  assert.equal(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    `${url}sw.js`,
  );
  const cacheUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (k) =>
          (await (await caches.open(k)).keys()).map((r) => r.url),
        ),
      )
    ).flat();
  });
  assert.ok(cacheUrls.some((u) => u.includes(`${base}assets/`)));
  assert.ok(cacheUrls.every((u) => u.includes(base)));
  await context.setOffline(true);
  await page.reload();
  await page
    .getByTestId("file-input")
    .setInputFiles({
      name: "icon.png",
      mimeType: "image/png",
      buffer: await readFile("public/icon-192.png"),
    });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "ZIPで一括保存 3枚" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "icon_split.zip");
  assert.equal(await download.failure(), null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: サブパスのアプリ・Manifest・SWスコープ・キャッシュ・オフラインZIP保存",
  );
} finally {
  await browser?.close();
  server.kill();
}
