import {
  imageRect,
  MAX_PIXELS,
  MAX_SIDE,
  type Size,
  type Plan,
  type Placement,
  type Settings,
} from "./model";
export interface LoadedImage extends Size {
  bitmap: ImageBitmap | HTMLImageElement;
  name: string;
  bytes: number;
  close: () => void;
}

// Read dimensions before decoding to reject oversized/decompression-bomb inputs.
export function inspectHeader(buffer: ArrayBuffer): Size {
  const b = new Uint8Array(buffer),
    v = new DataView(buffer);
  const str = (i: number, n: number) =>
    String.fromCharCode(...b.slice(i, i + n));
  if (
    b.length >= 24 &&
    b[0] === 137 &&
    str(1, 3) === "PNG" &&
    b[4] === 13 &&
    b[5] === 10 &&
    b[6] === 26 &&
    b[7] === 10
  )
    return { width: v.getUint32(16), height: v.getUint32(20) };
  if (b.length >= 30 && str(0, 4) === "RIFF" && str(8, 4) === "WEBP") {
    if (str(12, 4) === "VP8X")
      return {
        width: 1 + b[24] + (b[25] << 8) + (b[26] << 16),
        height: 1 + b[27] + (b[28] << 8) + (b[29] << 16),
      };
    if (str(12, 4) === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42)
      return {
        width: v.getUint16(26, true) & 16383,
        height: v.getUint16(28, true) & 16383,
      };
    if (str(12, 4) === "VP8L" && b[20] === 47)
      return {
        width: 1 + (((b[22] & 63) << 8) | b[21]),
        height: 1 + (((b[24] & 15) << 10) | (b[23] << 2) | (b[22] >> 6)),
      };
  }
  if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = v.getUint16(i);
      if (length < 2) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return { height: v.getUint16(i + 3), width: v.getUint16(i + 5) };
      i += length;
    }
  }
  throw new Error("PNG・JPEG・WebPの有効な画像を選択してください。");
}
export async function loadImage(file: File): Promise<LoadedImage> {
  if (file.size > 64 * 1024 * 1024)
    throw new Error("ファイルは64MB以下にしてください。");
  const header = inspectHeader(await file.arrayBuffer());
  if (
    !header.width ||
    !header.height ||
    header.width > MAX_SIDE ||
    header.height > MAX_SIDE ||
    header.width * header.height > MAX_PIXELS
  )
    throw new Error("画像は2,400万画素・各辺16,384px以下にしてください。");
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    if (typeof createImageBitmap === "function")
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
    else {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        bitmap = img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    throw new Error(
      "画像を読み込めません。破損していない別の画像を選択してください。",
    );
  }
  const width =
      bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width,
    height =
      bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  return {
    bitmap,
    width,
    height,
    name: file.name,
    bytes: file.size,
    close: () => {
      if ("close" in bitmap) bitmap.close();
    },
  };
}
export function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  if (!c.getContext("2d"))
    throw new Error("描画領域を確保できません。解像度を下げてください。");
  return c;
}
export function release(c: HTMLCanvasElement) {
  c.width = 1;
  c.height = 1;
}
export function drawScene(
  ctx: CanvasRenderingContext2D,
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
) {
  ctx.clearRect(0, 0, plan.width, plan.height);
  if (
    (s.background !== "transparent" && s.mode === "ratio") ||
    s.format === "jpeg"
  ) {
    ctx.fillStyle = s.background === "transparent" ? "#ffffff" : s.background;
    ctx.fillRect(0, 0, plan.width, plan.height);
  }
  if (s.mode === "original") {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source.bitmap, 0, 0);
  } else {
    const r = imageRect(source, plan, p);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source.bitmap, r.x, r.y, r.width, r.height);
  }
}
export function renderFull(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
) {
  const c = canvas(plan.width, plan.height);
  drawScene(c.getContext("2d")!, source, plan, s, p);
  return c;
}
export function renderTile(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  index: number,
  full?: HTMLCanvasElement,
) {
  const r = plan.tiles[index],
    c = canvas(r.width, r.height),
    ctx = c.getContext("2d")!;
  if (s.format === "jpeg") {
    ctx.fillStyle = s.background === "transparent" ? "#fff" : s.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    full ?? source.bitmap,
    r.x,
    r.y,
    r.width,
    r.height,
    0,
    0,
    r.width,
    r.height,
  );
  return c;
}
export function encode(c: HTMLCanvasElement, s: Settings): Promise<Blob> {
  const type = `image/${s.format}`;
  return new Promise((resolve, reject) =>
    c.toBlob(
      (blob) =>
        blob && blob.type === type
          ? resolve(blob)
          : reject(
              new Error(
                "このブラウザで選択形式を書き出せません。PNGをお試しください。",
              ),
            ),
      type,
      s.quality,
    ),
  );
}
