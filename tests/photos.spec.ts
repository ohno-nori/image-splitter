import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      calls: [] as { name: string; type: string; data: number[] }[][],
      attempts: 0,
      mode: "ok",
      supported: true,
      activation: false,
    };
    Object.assign(window, { photoTest: state });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (d: ShareData) => state.supported && !!d.files?.length,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: ShareData) => {
        state.attempts++;
        state.activation = navigator.userActivation.isActive;
        if (state.mode === "cancel")
          throw new DOMException("Cancelled", "AbortError");
        if (state.mode === "error")
          throw new DOMException("Failed", "NotAllowedError");
        state.calls.push(
          await Promise.all(
            d.files!.map(async (f) => ({
              name: f.name,
              type: f.type,
              data: Array.from(new Uint8Array(await f.arrayBuffer())),
            })),
          ),
        );
      },
    });
  });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles("public/icon-192.png");
});

test("連番PNGをまとめて共有・ZIPと同一画像・クリック時に共有", async ({
  page,
}) => {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIPで一括保存 3枚" }).click();
  const zip = await JSZip.loadAsync(
    await readFile((await (await download).path())!),
  );
  await page
    .getByRole("button", { name: "写真にまとめて保存", exact: true })
    .click();
  await expect(
    page.getByText("3枚の画像を用意しました", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).photoTest.attempts)).toBe(0);
  await page
    .getByRole("button", { name: "写真に保存・共有", exact: true })
    .click();
  await expect(page.getByText("共有画面の操作が完了しました。")).toBeVisible();
  const state = await page.evaluate(() => (window as any).photoTest);
  expect(state.activation).toBe(true);
  expect(state.calls[0].map((f: any) => f.name)).toEqual([
    "icon-192_01.png",
    "icon-192_02.png",
    "icon-192_03.png",
  ]);
  for (const f of state.calls[0])
    expect(
      Buffer.from(f.data).equals(await zip.file(f.name)!.async("nodebuffer")),
    ).toBe(true);
});

test("キャンセル・共有エラーから再試行、二重呼び出しなし", async ({ page }) => {
  await page
    .getByRole("button", { name: "写真にまとめて保存", exact: true })
    .click();
  const share = page.getByRole("button", {
    name: "写真に保存・共有",
    exact: true,
  });
  await expect(share).toBeEnabled();
  await page.evaluate(() => ((window as any).photoTest.mode = "cancel"));
  await share.click();
  await expect(
    page.getByText("共有をキャンセルしました。もう一度開けます。"),
  ).toBeVisible();
  await page.evaluate(() => ((window as any).photoTest.mode = "error"));
  await share.click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "共有画面を開けませんでした",
  );
  await page.evaluate(() => ((window as any).photoTest.mode = "ok"));
  await share.click();
  await expect(page.getByText("共有画面の操作が完了しました。")).toBeVisible();
  expect(await page.evaluate(() => (window as any).photoTest.attempts)).toBe(3);
});

test("非対応は共有せずZIPに切り替え、変更後は画像を再生成", async ({
  page,
}) => {
  await page.evaluate(() => ((window as any).photoTest.supported = false));
  await page
    .getByRole("button", { name: "写真にまとめて保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "まとめて共有できません",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ZIPで保存する", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("icon-192_split.zip");
  await page.evaluate(() => ((window as any).photoTest.supported = true));
  await page
    .getByRole("spinbutton", { name: "分割枚数", exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "写真にまとめて保存", exact: true })
    .click();
  await expect(
    page.getByText("4枚の画像を用意しました", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "写真に保存・共有", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).photoTest.calls[0].length),
  ).toBe(4);
});

test("WebPは写真用PNGに変換・準備失敗から再試行", async ({ page }) => {
  await page.getByLabel("保存形式").selectOption("webp");
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    Object.assign(window, {
      restorePhotoEncode: () => (HTMLCanvasElement.prototype.toBlob = encode),
    });
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(null);
    };
  });
  await page
    .getByRole("button", { name: "写真にまとめて保存", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.evaluate(() => (window as any).restorePhotoEncode());
  await page.getByRole("button", { name: "もう一度準備する" }).click();
  await page
    .getByRole("button", { name: "写真に保存・共有", exact: true })
    .click();
  await expect(page.getByText("共有画面の操作が完了しました。")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).photoTest.calls[0].every(
        (f: any) => f.type === "image/png" && f.name.endsWith(".png"),
      ),
    ),
  ).toBe(true);
});
