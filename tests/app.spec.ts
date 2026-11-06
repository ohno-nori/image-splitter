import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
const W = 101,
  H = 77;
async function fixture(alpha = false) {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      data[i] = x * 2;
      data[i + 1] = y * 3;
      data[i + 2] = (x + y) % 256;
      data[i + 3] = alpha && x < 20 ? 0 : 255;
    }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
}
async function upload(
  page: Page,
  buffer?: Buffer,
  name = "pattern.png",
  mimeType = "image/png",
) {
  await page
    .getByTestId("file-input")
    .setInputFiles({ name, mimeType, buffer: buffer ?? (await fixture()) });
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
async function downloadBytes(page: Page, button: string) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const d = await promise;
  return {
    name: d.suggestedFilename(),
    data: await readFile((await d.path())!),
  };
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("原寸ZIPを全ピクセル一致で再結合・個別出力と比較", async ({ page }) => {
  const original = await fixture();
  await upload(page, original);
  await page.getByRole("button", { name: "グリッド", exact: true }).click();
  await page.getByRole("spinbutton", { name: "列数", exact: true }).fill("7");
  await page.getByRole("spinbutton", { name: "行数", exact: true }).fill("5");
  const d = await downloadBytes(page, "ZIPで一括保存 35枚");
  expect(d.name).toBe("pattern_split.zip");
  const zip = await JSZip.loadAsync(d.data);
  const names = Object.keys(zip.files);
  expect(names).toHaveLength(35);
  expect(names[0]).toBe("pattern_01.png");
  const rebuilt = Buffer.alloc(W * H * 4);
  for (let i = 0; i < 35; i++) {
    const bytes = await zip.file(names[i])!.async("nodebuffer"),
      { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const x = Math.floor(((i % 7) * W) / 7),
      y = Math.floor((Math.floor(i / 7) * H) / 5);
    for (let r = 0; r < info.height; r++)
      data.copy(
        rebuilt,
        ((y + r) * W + x) * 4,
        r * info.width * 4,
        (r + 1) * info.width * 4,
      );
  }
  expect(
    rebuilt.equals(await sharp(original).ensureAlpha().raw().toBuffer()),
  ).toBe(true);
  await page.getByRole("button", { name: "分割画像を確認" }).click();
  const single = await downloadBytes(page, "この画像を保存");
  expect(
    single.data.equals(await zip.file("pattern_01.png")!.async("nodebuffer")),
  ).toBe(true);
});
test("比率・全体表示・余白なし・透明PNG・プレビュー配置", async ({ page }) => {
  await upload(page);
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  await page.getByLabel("出力解像度").selectOption("custom");
  await page.getByRole("spinbutton", { name: "1枚の横幅" }).fill("120");
  await page.getByRole("button", { name: "全体表示", exact: true }).click();
  const d = await downloadBytes(page, "ZIPで一括保存 3枚");
  const zip = await JSZip.loadAsync(d.data);
  const meta = await sharp(
    await zip.file("pattern_01.png")!.async("nodebuffer"),
  ).metadata();
  expect(meta.width).toBe(120);
  expect(meta.height).toBe(160);
  const image = await sharp(
    await zip.file("pattern_01.png")!.async("nodebuffer"),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
  expect(image[3]).toBe(0);
  await page.getByRole("button", { name: "余白なし", exact: true }).click();
  const second = await downloadBytes(page, "ZIPで一括保存 3枚");
  const zip2 = await JSZip.loadAsync(second.data);
  for (const file of Object.values(zip2.files)) {
    const raw = await sharp(await file.async("nodebuffer"))
      .ensureAlpha()
      .raw()
      .toBuffer();
    expect(raw.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  }
  const c = page.locator(".preview-stage canvas");
  expect(
    await c.evaluate(
      (el: HTMLCanvasElement) =>
        el.getContext("2d")!.getImageData(0, 0, 1, 1).data[3],
    ),
  ).toBe(255);
});
test("JPEG・WebP出力、透明JPEGの白背景", async ({ page }) => {
  await upload(page, await fixture(true));
  for (const format of ["jpeg", "webp"]) {
    await page.getByLabel("保存形式").selectOption(format);
    await page.getByRole("button", { name: "分割画像を確認" }).click();
    const d = await downloadBytes(page, "この画像を保存");
    expect((await sharp(d.data).metadata()).format).toBe(format);
    if (format === "jpeg") {
      const p = await sharp(d.data).raw().toBuffer();
      expect(p[0]).toBeGreaterThan(245);
      expect(p[1]).toBeGreaterThan(245);
      expect(p[2]).toBeGreaterThan(245);
    }
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
  }
});
test("PNG・JPEG・WebP読み込みとEXIFの回転", async ({ page }) => {
  const png = await fixture();
  for (const format of ["jpeg", "webp"] as const) {
    await upload(
      page,
      await sharp(png)[format]().toBuffer(),
      `photo.${format}`,
      `image/${format}`,
    );
  }
  const exif = await sharp(png)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  await upload(page, exif, "rotated.jpg", "image/jpeg");
  await expect(page.getByText("77 × 101 px", { exact: false })).toBeVisible();
});
test("上下分割・不正画像・サイズ超過を拒否", async ({ page }) => {
  await upload(page);
  await page.getByRole("button", { name: "上下", exact: true }).click();
  const d = await downloadBytes(page, "ZIPで一括保存 3枚");
  const zip = await JSZip.loadAsync(d.data);
  expect(
    (
      await sharp(
        await zip.file("pattern_01.png")!.async("nodebuffer"),
      ).metadata()
    ).height,
  ).toBe(25);
  await page.getByTestId("file-input").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toContainText("有効な画像");
  await expect(page.getByText("pattern.png", { exact: true })).toBeVisible();
  const huge = Buffer.from(await fixture());
  huge.writeUInt32BE(99999, 16);
  await page
    .getByTestId("file-input")
    .setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: huge });
  await expect(page.getByRole("alert")).toContainText("2,400万画素");
});
test("設定永続化・カスタム比率・入力エラーと復帰", async ({ page }) => {
  await upload(page);
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  await page.getByLabel("1枚のアスペクト比").selectOption("custom");
  await page.getByLabel("比率の横").fill("1.25");
  await page.getByLabel("比率の縦").fill("1.5");
  await page.getByLabel("出力解像度").selectOption("custom");
  await page.getByRole("spinbutton", { name: "1枚の横幅" }).fill("107");
  await expect(page.getByText("横幅を105px", { exact: false })).toBeVisible();
  await page.getByLabel("比率の横").fill("0");
  await expect(page.getByRole("alert")).toContainText("比率");
  await expect(
    page.getByRole("button", { name: "ZIPで一括保存 3枚" }),
  ).toBeDisabled();
  await page.getByLabel("比率の横").fill("1.25");
  await page.reload();
  await expect(page.getByLabel("比率の横")).toHaveValue("1.25");
  await expect(page.getByText("ここから、画像を分割。")).toBeVisible();
});
test("ドラッグ・中央戻し・拡大とスマホ横幅", async ({ page, isMobile }) => {
  await upload(page);
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  const el = page.getByRole("application");
  await el.scrollIntoViewIfNeeded();
  const before = await el
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  const moved = await el
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(moved).not.toBe(before);
  await page.getByRole("button", { name: "画像を中央に戻す" }).click();
  expect(
    await el
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).toBe(before);
  await page.getByRole("slider", { name: "拡大率" }).fill("2");
  await expect(page.getByText("200%", { exact: true })).toBeVisible();
  if (isMobile) {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await el.evaluate((e) => getComputedStyle(e).touchAction)).toBe(
      "none",
    );
    await page.screenshot({
      path: "test-artifacts/mobile-editor.png",
      fullPage: true,
    });
  }
});
test("PWAのManifest・キャッシュ・オフライン分割", async ({ page, context }) => {
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.name).toBe("Image Splitter");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBe(3);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toEqual([]);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await upload(page);
  const result = await downloadBytes(page, "ZIPで一括保存 3枚");
  expect(Object.keys((await JSZip.loadAsync(result.data)).files)).toHaveLength(
    3,
  );
  await context.setOffline(false);
});
test("タッチのピンチ中心・ダブルタップ", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await upload(page);
  await page
    .getByRole("button", { name: "アスペクト比指定", exact: false })
    .click();
  const el = page.getByRole("application");
  await el.scrollIntoViewIfNeeded();
  const b = (await el.boundingBox())!,
    x = b.x + b.width * 0.5,
    y = b.y + b.height * 0.5;
  const session = await page.context().newCDPSession(page);
  const touch = async (
    type: string,
    points: { x: number; y: number; id: number }[],
  ) => session.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [
    { x: x - 20, y, id: 0 },
    { x: x + 20, y, id: 1 },
  ]);
  await touch("touchMove", [
    { x: x - 40, y, id: 0 },
    { x: x + 40, y, id: 1 },
  ]);
  await touch("touchEnd", []);
  await expect(page.getByText("200%", { exact: true })).toBeVisible();
  await touch("touchStart", [{ x, y, id: 0 }]);
  await touch("touchMove", [{ x: x + 20, y: y + 10, id: 0 }]);
  await touch("touchEnd", []);
  const moved = await el
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  for (let i = 0; i < 2; i++) {
    await touch("touchStart", [{ x, y, id: 0 }]);
    await touch("touchEnd", []);
  }
  expect(
    await el
      .locator("canvas")
      .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
  ).not.toBe(moved);
  await expect(page.getByText("200%", { exact: true })).toBeVisible();
  await session.detach();
});
