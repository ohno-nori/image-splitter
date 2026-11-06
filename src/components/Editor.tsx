import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { drawScene, type LoadedImage } from "../lib/image";
import {
  limitPlacement,
  zoomAt,
  type Plan,
  type Placement,
  type Settings,
} from "../lib/model";

interface Props {
  source: LoadedImage;
  plan: Plan;
  settings: Settings;
  placement: Placement;
  onPlacement: (p: Placement) => void;
  disabled?: boolean;
  tileIndex?: number;
}
export function Editor({
  source,
  plan,
  settings,
  placement,
  onPlacement,
  disabled,
  tileIndex,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    host = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const current = useRef(placement);
  current.current = placement;
  const tap = useRef({ time: 0, x: 0, y: 0 }),
    start = useRef({ x: 0, y: 0, moved: false, multi: false });
  const [size, setSize] = useState(0);
  const tile = tileIndex === undefined ? null : plan.tiles[tileIndex];
  const view = tile ?? { x: 0, y: 0, width: plan.width, height: plan.height };
  const editable = settings.mode === "ratio" && !disabled && !tile;
  useEffect(() => {
    const observer = new ResizeObserver(() => setSize((n) => n + 1));
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const width = Math.min(
      1800,
      Math.max(1, Math.round(c.clientWidth * devicePixelRatio)),
    );
    const scale = Math.min(width / view.width, 1800 / view.height);
    c.width = Math.max(1, Math.round(view.width * scale));
    c.height = Math.max(1, Math.round(view.height * scale));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(
      c.width / view.width,
      0,
      0,
      c.height / view.height,
      (-view.x * c.width) / view.width,
      (-view.y * c.height) / view.height,
    );
    drawScene(ctx, source, plan, settings, placement);
  }, [
    source,
    plan,
    settings,
    placement,
    view.x,
    view.y,
    view.width,
    view.height,
    size,
  ]);
  useEffect(() => {
    const el = host.current;
    if (!el || !editable) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      onPlacement(
        zoomAt(
          source,
          plan,
          current.current,
          current.current.zoom * Math.exp(-e.deltaY * 0.0015),
          {
            x: (e.clientX - r.left) / r.width,
            y: (e.clientY - r.top) / r.height,
          },
        ),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [editable, source, plan, onPlacement]);
  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };
  const update = (p: Placement) => {
    const next = limitPlacement(source, plan, p);
    current.current = next;
    onPlacement(next);
  };
  const end = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (
      e.type === "pointerup" &&
      !start.current.moved &&
      !start.current.multi &&
      e.pointerType !== "mouse"
    ) {
      const now = Date.now();
      if (
        now - tap.current.time < 320 &&
        Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) < 30
      ) {
        update({ ...current.current, x: 0, y: 0 });
        tap.current.time = 0;
      } else tap.current = { time: now, x: e.clientX, y: e.clientY };
    }
  };
  return (
    <div
      className={`canvas-wrap ${editable ? "editable" : ""}`}
      ref={host}
      style={{
        aspectRatio: `${view.width}/${view.height}`,
        maxWidth: `min(100%, ${(58 * view.width) / view.height}vh)`,
      }}
      tabIndex={editable ? 0 : undefined}
      role={editable ? "application" : undefined}
      aria-label={
        editable
          ? "画像配置エリア。ドラッグ・ピンチ・矢印キーで調整"
          : "画像プレビュー"
      }
      onKeyDown={(e) => {
        if (!editable) return;
        const delta = {
          ArrowLeft: [-0.01, 0],
          ArrowRight: [0.01, 0],
          ArrowUp: [0, -0.01],
          ArrowDown: [0, 0.01],
        }[e.key];
        if (delta) {
          e.preventDefault();
          update({
            ...current.current,
            x: current.current.x + delta[0],
            y: current.current.y + delta[1],
          });
        }
      }}
      onDoubleClick={() => {
        if (editable) update({ ...current.current, x: 0, y: 0 });
      }}
      onPointerDown={(e) => {
        if (!editable) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, local(e));
        if (pointers.current.size === 1)
          start.current = {
            x: e.clientX,
            y: e.clientY,
            moved: false,
            multi: false,
          };
        else start.current.multi = true;
      }}
      onPointerMove={(e) => {
        if (!editable || !pointers.current.has(e.pointerId)) return;
        if (
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >
          5
        )
          start.current.moved = true;
        const before = [...pointers.current.values()];
        pointers.current.set(e.pointerId, local(e));
        const after = [...pointers.current.values()];
        if (before.length === 1)
          update({
            ...current.current,
            x: current.current.x + after[0].x - before[0].x,
            y: current.current.y + after[0].y - before[0].y,
          });
        else {
          const mid = (a: typeof before) => ({
            x: (a[0].x + a[1].x) / 2,
            y: (a[0].y + a[1].y) / 2,
          });
          const rect = e.currentTarget.getBoundingClientRect();
          const dist = (a: typeof before) =>
            Math.hypot(
              (a[0].x - a[1].x) * rect.width,
              (a[0].y - a[1].y) * rect.height,
            );
          const a = mid(before),
            b = mid(after),
            d = dist(before);
          if (d < 2) return;
          const z = zoomAt(
            source,
            plan,
            current.current,
            (current.current.zoom * dist(after)) / d,
            a,
          );
          update({ ...z, x: z.x + b.x - a.x, y: z.y + b.y - a.y });
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
    >
      <canvas ref={canvasRef} />
      {!tile && (
        <div className="grid-overlay" aria-hidden="true">
          {plan.tiles.map((r, i) => (
            <div
              className="tile-outline"
              key={i}
              style={{
                left: `${(r.x / plan.width) * 100}%`,
                top: `${(r.y / plan.height) * 100}%`,
                width: `${(r.width / plan.width) * 100}%`,
                height: `${(r.height / plan.height) * 100}%`,
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
