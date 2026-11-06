import { test, expect } from "@playwright/test";
import sharp from "sharp";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

test("初期・暗色・320px表示とエラーのない描画", async ({ page, isMobile }) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      r.url().startsWith("http") &&
      !r.url().startsWith("http://127.0.0.1:4173/")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.screenshot({
    path: `test-artifacts/${isMobile ? "mobile" : "desktop"}-empty.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "アプリ設定" }).click();
  await page.getByLabel("テーマ", { exact: true }).selectOption("dark");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: `test-artifacts/${isMobile ? "mobile" : "desktop"}-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "グリッド", exact: true }).click();
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("比率プレビューと書き出しの構図、タイル境界が一致", async ({ page }) => {
  await page.goto("/");
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><path fill="#e43333" d="M0 0h180v90H0z"/><path fill="#33c644" d="M180 0h180v90H180z"/><path fill="#3355dd" d="M0 90h180v90H0z"/><path fill="#e8d030" d="M180 90h180v90H180z"/></svg>',
  );
  await page
    .getByTestId("file-input")
    .setInputFiles({
      name: "blocks.png",
      mimeType: "image/png",
      buffer: await sharp(svg).png().toBuffer(),
    });
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  await page.getByLabel("1枚のアスペクト比").selectOption("1:1");
  await page.getByLabel("出力解像度").selectOption("custom");
  await page.getByRole("spinbutton", { name: "1枚の横幅" }).fill("120");
  await page.getByRole("button", { name: "背景：黒" }).click();
  const app = page.getByRole("application");
  await app.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const points = [
    [0.1, 0.1],
    [0.2, 0.3],
    [0.7, 0.3],
    [0.3, 0.7],
    [0.7, 0.7],
    [0.95, 0.9],
  ];
  const preview = await app
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement, pts) => {
      const ctx = c.getContext("2d")!;
      return pts.map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.floor(x * c.width),
            Math.floor(y * c.height),
            1,
            1,
          ).data,
        ),
      );
    }, points);
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIPで一括保存 3枚" }).click();
  const d = await promise;
  const zip = await JSZip.loadAsync(await readFile((await d.path())!));
  const tiles = await Promise.all(
    Object.values(zip.files).map(async (file) =>
      sharp(await file.async("nodebuffer"))
        .ensureAlpha()
        .raw()
        .toBuffer(),
    ),
  );
  points.forEach(([x, y], i) => {
    const gx = Math.floor(x * 360),
      gy = Math.floor(y * 120),
      col = Math.floor(gx / 120),
      offset = (gy * 120 + (gx % 120)) * 4;
    expect(Array.from(tiles[col].subarray(offset, offset + 4))).toEqual(
      preview[i],
    );
  });
  const a = tiles[0],
    b = tiles[1];
  // The source is a flat color across this seam; composing once must not create an edge.
  expect(
    Array.from(a.subarray((60 * 120 + 119) * 4, (60 * 120 + 120) * 4)),
  ).toEqual(Array.from(b.subarray(60 * 120 * 4, (60 * 120 + 1) * 4)));
});

test("書き出し失敗をダイアログ内で表示して復帰", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles("public/icon-192.png");
  await page.getByRole("button", { name: "分割画像を確認" }).click();
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    Object.assign(window, {
      restoreEncode: () => (HTMLCanvasElement.prototype.toBlob = original),
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(null);
    };
  });
  await page.getByRole("button", { name: "この画像を保存" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "保存できませんでした",
  );
  await page.evaluate(() => {
    (window as unknown as { restoreEncode: () => void }).restoreEncode();
  });
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "この画像を保存" }).click();
  expect((await promise).suggestedFilename()).toBe("icon-192_01.png");
});
