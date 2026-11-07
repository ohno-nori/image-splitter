import JSZip from "jszip";
import {
  fileStem,
  tileName,
  type Plan,
  type Placement,
  type Settings,
} from "./model";
import {
  encode,
  release,
  renderFull,
  renderTile,
  type LoadedImage,
} from "./image";
async function* imageFiles(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
  index: number | null,
  progress: (text: string) => void,
): AsyncGenerator<File> {
  let full: HTMLCanvasElement | undefined;
  try {
    if (s.mode === "ratio") {
      progress("出力キャンバスを準備中…");
      await new Promise((r) => setTimeout(r, 0));
      full = renderFull(source, plan, s, p);
    }
    for (const i of index === null ? plan.tiles.map((_, i) => i) : [index]) {
      progress(`${i + 1} / ${plan.tiles.length} 枚を書き出し中…`);
      const tile = renderTile(source, plan, s, i, full);
      let blob: Blob;
      try {
        blob = await encode(tile, s);
      } finally {
        release(tile);
      }
      const name = tileName(source.name, i, s.format);
      yield new File([blob], name, { type: blob.type });
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    if (full) release(full);
  }
}

export async function exportImages(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
  index: number | null,
  progress: (text: string) => void,
): Promise<File> {
  const zip = new JSZip();
  let totalBytes = 0;
  for await (const file of imageFiles(source, plan, s, p, index, progress)) {
    if (index !== null) return file;
    totalBytes += file.size;
    if (totalBytes > 128 * 1024 * 1024)
      throw new Error(
        "ZIPが128MBを超えました。解像度を下げるか、JPEG・WebPまたは個別保存をお試しください。",
      );
    zip.file(file.name, await file.arrayBuffer());
  }
  progress("ZIPをまとめています…");
  const blob = await zip.generateAsync(
    { type: "blob", compression: "STORE", streamFiles: true },
    (m) => progress(`ZIPをまとめています… ${Math.round(m.percent)}%`),
  );
  return new File([blob], `${fileStem(source.name)}_split.zip`, {
    type: "application/zip",
  });
}

/** Photos-friendly types; retain alpha by converting WebP to PNG for sharing. */
export async function exportPhotos(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
  progress: (text: string) => void,
): Promise<File[]> {
  const settings: Settings = {
    ...s,
    format: s.format === "webp" ? "png" : s.format,
  };
  const files: File[] = [];
  let bytes = 0;
  for await (const file of imageFiles(
    source,
    plan,
    settings,
    p,
    null,
    progress,
  )) {
    bytes += file.size;
    if (bytes > 64 * 1024 * 1024)
      throw new Error(
        "まとめて共有する画像が64MBを超えました。解像度を下げるか、ZIP・個別保存をお試しください。",
      );
    files.push(file);
  }
  return files;
}

export function canShareFiles(files: File[]): boolean {
  try {
    return (
      files.length > 0 &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files })
    );
  } catch {
    return false;
  }
}
export function download(file: File) {
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  // Safari may consume the URL asynchronously. Keep it alive briefly.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
