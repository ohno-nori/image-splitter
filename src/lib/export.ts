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
export async function exportImages(
  source: LoadedImage,
  plan: Plan,
  s: Settings,
  p: Placement,
  index: number | null,
  progress: (text: string) => void,
): Promise<File> {
  let full: HTMLCanvasElement | undefined;
  try {
    if (s.mode === "ratio") {
      progress("出力キャンバスを準備中…");
      await new Promise((r) => setTimeout(r, 0));
      full = renderFull(source, plan, s, p);
    }
    const zip = index === null ? new JSZip() : null;
    let totalBytes = 0;
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
      if (!zip) return new File([blob], name, { type: blob.type });
      totalBytes += blob.size;
      if (totalBytes > 128 * 1024 * 1024)
        throw new Error(
          "ZIPが128MBを超えました。解像度を下げるか、JPEG・WebPまたは個別保存をお試しください。",
        );
      zip.file(name, await blob.arrayBuffer());
      await new Promise((r) => setTimeout(r, 0));
    }
    progress("ZIPをまとめています…");
    const blob = await zip!.generateAsync(
      { type: "blob", compression: "STORE", streamFiles: true },
      (m) => progress(`ZIPをまとめています… ${Math.round(m.percent)}%`),
    );
    return new File([blob], `${fileStem(source.name)}_split.zip`, {
      type: "application/zip",
    });
  } finally {
    if (full) release(full);
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
