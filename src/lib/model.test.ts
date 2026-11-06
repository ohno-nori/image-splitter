import { describe, expect, it } from "vitest";
import {
  CENTER,
  DEFAULTS,
  fileStem,
  fit,
  imageRect,
  limitPlacement,
  makePlan,
  ratioUnits,
  sanitizeSettings,
  splitRects,
  tileName,
  zoomAt,
} from "./model";

describe("原寸の整数分割", () => {
  it.each([
    [1001, 17, 3, 1],
    [13, 1001, 1, 3],
    [1001, 997, 7, 9],
    [1, 1, 1, 1],
  ])("%i×%i / %i列%i行で欠落も重複もない", (w, h, c, r) => {
    const rects = splitRects(w, h, c, r),
      pixels = new Uint8Array(w * h);
    for (const tile of rects)
      for (let y = tile.y; y < tile.y + tile.height; y++)
        for (let x = tile.x; x < tile.x + tile.width; x++) pixels[y * w + x]++;
    expect(pixels.every((n) => n === 1)).toBe(true);
    expect(
      Math.max(...rects.map((t) => t.width)) -
        Math.min(...rects.map((t) => t.width)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...rects.map((t) => t.height)) -
        Math.min(...rects.map((t) => t.height)),
    ).toBeLessThanOrEqual(1);
  });
  it("元データを分割・再結合して復元", () => {
    const w = 101,
      h = 77,
      original = Uint32Array.from({ length: w * h }, (_, i) => i * 37),
      result = new Uint32Array(w * h);
    for (const t of splitRects(w, h, 7, 5)) {
      const tile = Array.from({ length: t.height }, (_, y) =>
        original.slice((t.y + y) * w + t.x, (t.y + y) * w + t.x + t.width),
      );
      tile.forEach((row, y) => result.set(row, (t.y + y) * w + t.x));
    }
    expect(result).toEqual(original);
  });
  it("原寸はリサイズ指定や配置に依存しない", () => {
    const p = makePlan(
      { width: 1001, height: 700 },
      { ...DEFAULTS, resolution: "custom", width: 2048 },
    );
    expect(p.width).toBe(1001);
    expect(p.height).toBe(700);
  });
  it.each([
    [2, 2, 3, 1],
    [100, 100, 20, 20],
    [0, 10, 1, 1],
    [10, 10, 0, 1],
    [10, 10, 1.5, 1],
  ])("不正な寸法・枚数を拒否", (...args) =>
    expect(() =>
      splitRects(...(args as [number, number, number, number])),
    ).toThrow(),
  );
});
describe("比率と全体キャンバス", () => {
  it("指定幅より比率の最小単位が大きいとき最小有効幅へ調整", () => {
    const p = makePlan(
      { width: 100, height: 100 },
      { ...DEFAULTS, mode: "ratio", resolution: "custom", width: 1 },
    );
    expect(p.tiles[0].width).toBe(3);
    expect(p.tiles[0].height).toBe(4);
    expect(p.adjusted).toBe(true);
  });
  it.each(["3:4", "4:5", "1:1", "16:9", "9:16", "3:2", "2:3"])(
    "%sの各タイルが正確・連続",
    (ratio) => {
      const p = makePlan(
        { width: 2400, height: 1600 },
        {
          ...DEFAULTS,
          mode: "ratio",
          ratio,
          direction: "grid",
          columns: 3,
          rows: 2,
        },
      );
      const [w, h] = ratio.split(":").map(Number);
      for (const t of p.tiles) {
        expect(t.width * h).toBe(t.height * w);
        expect(t.width).toBe(p.width / 3);
        expect(t.height).toBe(p.height / 2);
      }
      expect(p.tiles[0].x + p.tiles[0].width).toBe(p.tiles[1].x);
      expect(p.tiles[0].y + p.tiles[0].height).toBe(p.tiles[3].y);
      expect(p.width).toBeLessThanOrEqual(2400);
      expect(p.height).toBeLessThanOrEqual(1600);
    },
  );
  it("カスタム小数比率は整数に約分して指定幅を調整", () => {
    expect(ratioUnits(1.25, 1.5)).toEqual({ width: 5, height: 6 });
    const p = makePlan(
      { width: 2400, height: 1600 },
      {
        ...DEFAULTS,
        mode: "ratio",
        ratio: "custom",
        customW: 1.25,
        customH: 1.5,
        resolution: "custom",
        width: 1082,
      },
    );
    expect(p.tiles[0].width).toBe(1080);
    expect(p.tiles[0].height).toBe(1296);
    expect(p.adjusted).toBe(true);
  });
  it("3:4を横3枚にすると全体9:4", () => {
    const p = makePlan(
      { width: 2400, height: 1600 },
      { ...DEFAULTS, mode: "ratio" },
    );
    expect(p.width * 4).toBe(p.height * 9);
  });
  it("過大出力、不正比率、小さすぎる自動サイズを拒否", () => {
    expect(() =>
      makePlan(
        { width: 2400, height: 1600 },
        { ...DEFAULTS, mode: "ratio", resolution: "custom", width: 10000 },
      ),
    ).toThrow();
    expect(() => ratioUnits(0, 1)).toThrow();
    expect(() => ratioUnits(NaN, 1)).toThrow();
    expect(() => ratioUnits(1.2345, 1)).toThrow("3桁");
    expect(() =>
      makePlan({ width: 1, height: 1 }, { ...DEFAULTS, mode: "ratio" }),
    ).toThrow();
  });
});
describe("画像配置", () => {
  const source = { width: 1800, height: 1000 },
    canvas = { width: 900, height: 1200 };
  it("全体表示はすべて収まる", () => {
    const r = imageRect(source, canvas, fit(source, canvas));
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(canvas.width);
    expect(r.y + r.height).toBeLessThanOrEqual(canvas.height);
  });
  it("余白なしは全体を覆う", () => {
    const r = imageRect(source, canvas, fit(source, canvas, true));
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.y).toBeLessThanOrEqual(0);
    expect(r.x + r.width).toBeGreaterThanOrEqual(canvas.width);
    expect(r.y + r.height).toBeGreaterThanOrEqual(canvas.height);
  });
  it("ピンチ中心にある画像上の点を保持", () => {
    const p = { x: 0.13, y: -0.04, zoom: 1.5 },
      anchor = { x: 0.3, y: 0.7 },
      a = imageRect(source, canvas, p),
      b = imageRect(source, canvas, zoomAt(source, canvas, p, 3, anchor));
    expect((anchor.x * canvas.width - a.x) / a.width).toBeCloseTo(
      (anchor.x * canvas.width - b.x) / b.width,
    );
    expect((anchor.y * canvas.height - a.y) / a.height).toBeCloseTo(
      (anchor.y * canvas.height - b.y) / b.height,
    );
  });
  it("中央に戻す操作は倍率を維持", () => {
    const p = { x: 0, y: 0, zoom: 4 };
    const r = imageRect(source, canvas, p);
    expect(r.x + r.width / 2).toBe(canvas.width / 2);
  });
  it("完全に見失う配置と過大倍率を抑える", () => {
    const p = limitPlacement(source, canvas, { x: 999, y: -999, zoom: 999 });
    const r = imageRect(source, canvas, p);
    expect(r.x).toBeLessThan(canvas.width);
    expect(r.y + r.height).toBeGreaterThan(0);
    expect(p.zoom).toBeLessThan(999);
    expect(zoomAt(source, canvas, CENTER, 0).zoom).toBe(0.1);
  });
});
describe("設定とファイル名", () => {
  it("破損設定を安全に復元", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULTS);
    const s = sanitizeSettings({
      count: -1,
      columns: 20,
      rows: 20,
      quality: NaN,
      background: "url(evil)",
      theme: "evil",
      customW: 0,
    });
    expect(s).toEqual(DEFAULTS);
  });
  it("有効な設定を保持", () =>
    expect(
      sanitizeSettings({
        ...DEFAULTS,
        format: "webp",
        theme: "dark",
        customW: 1.25,
      }).customW,
    ).toBe(1.25));
  it("連番と危険文字の除去", () => {
    expect(tileName("a:b?.png", 0, "png")).toBe("a_b__01.png");
    expect(tileName("写真.jpeg", 99, "jpeg")).toBe("写真_100.jpg");
    expect(fileStem(".png")).toBe("image");
  });
});
