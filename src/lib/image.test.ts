import { expect, it } from "vitest";
import { inspectHeader } from "./image";
it("PNG寸法をデコード前に読む", () => {
  const a = new Uint8Array(24);
  a.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(a.buffer);
  v.setUint32(16, 1001);
  v.setUint32(20, 700);
  expect(inspectHeader(a.buffer)).toEqual({ width: 1001, height: 700 });
});
it("JPEG寸法をデコード前に読む", () => {
  const a = new Uint8Array([
    255, 216, 255, 192, 0, 17, 8, 2, 188, 3, 233, 3, 1, 0, 0,
  ]);
  expect(inspectHeader(a.buffer)).toEqual({ width: 1001, height: 700 });
});
it("破損データとSVGを拒否", () => {
  expect(() =>
    inspectHeader(new TextEncoder().encode("<svg/>").buffer),
  ).toThrow();
  expect(() => inspectHeader(new Uint8Array(0).buffer)).toThrow();
});
