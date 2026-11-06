export type Direction = "horizontal" | "vertical" | "grid";
export type Format = "png" | "jpeg" | "webp";
export interface Settings {
  direction: Direction;
  count: number;
  columns: number;
  rows: number;
  mode: "original" | "ratio";
  ratio: string;
  customW: number;
  customH: number;
  format: Format;
  quality: number;
  background: string;
  resolution: "auto" | "custom";
  width: number;
  theme: "light" | "dark" | "system";
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  x: number;
  y: number;
}
export interface Placement {
  x: number;
  y: number;
  zoom: number;
}
export interface Plan extends Size {
  tiles: Rect[];
  columns: number;
  rows: number;
  adjusted: boolean;
}
export const DEFAULTS: Settings = {
  direction: "horizontal",
  count: 3,
  columns: 3,
  rows: 2,
  mode: "original",
  ratio: "3:4",
  customW: 3,
  customH: 4,
  format: "png",
  quality: 0.94,
  background: "transparent",
  resolution: "auto",
  width: 1080,
  theme: "system",
};
export const RATIOS = ["3:4", "4:5", "1:1", "16:9", "9:16", "3:2", "2:3"];
export const CENTER: Placement = { x: 0, y: 0, zoom: 1 };
export const MAX_PIXELS = 24_000_000;
export const MAX_SIDE = 16384;
export function sanitizeSettings(value: unknown): Settings {
  const s = { ...DEFAULTS };
  if (!value || typeof value !== "object") return s;
  const v = value as Record<string, unknown>;
  const choices = {
    direction: ["horizontal", "vertical", "grid"],
    mode: ["original", "ratio"],
    ratio: [...RATIOS, "custom"],
    format: ["png", "jpeg", "webp"],
    resolution: ["auto", "custom"],
    theme: ["light", "dark", "system"],
  };
  for (const [key, allowed] of Object.entries(choices))
    if (allowed.includes(v[key] as string)) Object.assign(s, { [key]: v[key] });
  for (const [key, min, max] of [
    ["count", 2, 20],
    ["columns", 1, 20],
    ["rows", 1, 20],
    ["customW", 0.001, 10000],
    ["customH", 0.001, 10000],
    ["quality", 0.1, 1],
    ["width", 1, 16384],
  ] as const) {
    const n = v[key];
    if (
      typeof n === "number" &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (["quality", "customW", "customH"].includes(key) || Number.isInteger(n))
    )
      Object.assign(s, { [key]: n });
  }
  if (s.columns * s.rows > 100) {
    s.columns = 3;
    s.rows = 2;
  }
  if (
    typeof v.background === "string" &&
    /^(transparent|#[\da-f]{6})$/i.test(v.background)
  )
    s.background = v.background;
  return s;
}
export function loadSettings(): Settings {
  try {
    return sanitizeSettings(
      JSON.parse(localStorage.getItem("splitter-settings") || "null"),
    );
  } catch {
    return { ...DEFAULTS };
  }
}
export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export function ratioUnits(w: number, h: number): Size {
  if (![w, h].every((n) => Number.isFinite(n) && n >= 0.001 && n <= 10000))
    throw new Error("比率は0.001〜10000の数値で指定してください。");
  if (![w, h].every((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-7))
    throw new Error("カスタム比率は小数点以下3桁までで指定してください。");
  const a = Math.round(w * 1000),
    b = Math.round(h * 1000),
    d = gcd(a, b);
  return { width: a / d, height: b / d };
}
export function grid(s: Settings) {
  return s.direction === "horizontal"
    ? [s.count, 1]
    : s.direction === "vertical"
      ? [1, s.count]
      : [s.columns, s.rows];
}
export function splitRects(
  width: number,
  height: number,
  columns: number,
  rows: number,
): Rect[] {
  if (
    ![width, height, columns, rows].every(
      (n) => Number.isInteger(n) && n > 0,
    ) ||
    columns > 20 ||
    rows > 20 ||
    columns * rows > 100
  )
    throw new Error("分割は各方向20以下、合計100枚以下にしてください。");
  if (width < columns || height < rows)
    throw new Error(
      "画像のピクセル数より分割数が多すぎます。分割数を減らしてください。",
    );
  return Array.from({ length: columns * rows }, (_, i) => {
    const c = i % columns,
      r = Math.floor(i / columns),
      x = Math.floor((c * width) / columns),
      y = Math.floor((r * height) / rows);
    return {
      x,
      y,
      width: Math.floor(((c + 1) * width) / columns) - x,
      height: Math.floor(((r + 1) * height) / rows) - y,
    };
  });
}
export function makePlan(source: Size, s: Settings): Plan {
  const [columns, rows] = grid(s);
  let { width, height } = source,
    adjusted = false;
  if (s.mode === "ratio") {
    if (
      s.resolution === "custom" &&
      (!Number.isInteger(s.width) || s.width < 1 || s.width > MAX_SIDE)
    ) {
      throw new Error("出力幅は1〜16,384pxの整数で指定してください。");
    }
    const [rw, rh] =
      s.ratio === "custom"
        ? [s.customW, s.customH]
        : s.ratio.split(":").map(Number);
    const units = ratioUnits(rw, rh);
    const factor =
      s.resolution === "auto"
        ? Math.floor(
            Math.min(
              source.width / (units.width * columns),
              source.height / (units.height * rows),
            ),
          )
        : Math.max(1, Math.round(s.width / units.width));
    if (factor < 1)
      throw new Error(
        "この比率を整数ピクセルで表すにはサイズが足りません。比率を簡単にするか、出力幅を大きくしてください。",
      );
    width = units.width * factor * columns;
    height = units.height * factor * rows;
    adjusted = s.resolution === "custom" && units.width * factor !== s.width;
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS)
    throw new Error(
      "出力が大きすぎます。全体を2,400万画素・各辺16,384px以内にしてください。",
    );
  return {
    width,
    height,
    columns,
    rows,
    adjusted,
    tiles: splitRects(width, height, columns, rows),
  };
}
export function imageRect(source: Size, canvas: Size, p: Placement): Rect {
  const scale =
    Math.min(canvas.width / source.width, canvas.height / source.height) *
    p.zoom;
  const width = source.width * scale,
    height = source.height * scale;
  return {
    x: (canvas.width - width) / 2 + p.x * canvas.width,
    y: (canvas.height - height) / 2 + p.y * canvas.height,
    width,
    height,
  };
}
export function fit(source: Size, canvas: Size, cover = false): Placement {
  const scales = [canvas.width / source.width, canvas.height / source.height];
  return {
    ...CENTER,
    zoom: cover ? Math.max(...scales) / Math.min(...scales) : 1,
  };
}
export function limitPlacement(
  source: Size,
  canvas: Size,
  p: Placement,
): Placement {
  const cover = fit(source, canvas, true).zoom;
  const zoom = Math.max(0.1, Math.min(Math.max(20, cover * 4), p.zoom));
  const rect = imageRect(source, canvas, { ...p, zoom });
  const maxX = 0.48 + rect.width / canvas.width / 2,
    maxY = 0.48 + rect.height / canvas.height / 2;
  return {
    zoom,
    x: Math.max(-maxX, Math.min(maxX, p.x)),
    y: Math.max(-maxY, Math.min(maxY, p.y)),
  };
}
export function zoomAt(
  source: Size,
  canvas: Size,
  p: Placement,
  next: number,
  anchor = { x: 0.5, y: 0.5 },
): Placement {
  const zoom = limitPlacement(source, canvas, { ...p, zoom: next }).zoom,
    factor = zoom / p.zoom;
  return limitPlacement(source, canvas, {
    zoom,
    x: anchor.x - 0.5 - (anchor.x - 0.5 - p.x) * factor,
    y: anchor.y - 0.5 - (anchor.y - 0.5 - p.y) * factor,
  });
}
export function fileStem(name: string) {
  return (
    name
      .replace(/\.[^.]*$/, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 100) || "image"
  );
}
export function tileName(name: string, index: number, format: Format) {
  return `${fileStem(name)}_${String(index + 1).padStart(2, "0")}.${format === "jpeg" ? "jpg" : format}`;
}
