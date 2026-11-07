import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Expand,
  Grid2X2,
  ImagePlus,
  LockKeyhole,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  Share2,
  Upload,
  X,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  CENTER,
  fit,
  grid,
  loadSettings,
  makePlan,
  RATIOS,
  zoomAt,
  type Placement,
  type Settings,
} from "./lib/model";
import { loadImage, type LoadedImage } from "./lib/image";
import {
  canShareFiles,
  download,
  exportImages,
  exportPhotos,
} from "./lib/export";
import { Editor } from "./components/Editor";
import { Dialog } from "./components/Dialog";

function Counter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="counter-label">
      <span>{label}</span>
      <span className="counter">
        <button
          type="button"
          aria-label={`${label}を減らす`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus size={16} />
        </button>
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          value={value || ""}
          onChange={(e) =>
            onChange(Math.min(max, Math.max(0, Number(e.target.value))))
          }
          onBlur={() => {
            if (value < min) onChange(min);
          }}
        />
        <button
          type="button"
          aria-label={`${label}を増やす`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus size={16} />
        </button>
      </span>
    </label>
  );
}
export default function App() {
  const [settings, setSettings] = useState(loadSettings),
    [source, setSource] = useState<LoadedImage | null>(null),
    [placement, setPlacement] = useState<Placement>(CENTER);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [modal, setModal] = useState<
      "settings" | "tiles" | "expand" | "photos" | null
    >(null),
    [index, setIndex] = useState(0),
    [dragging, setDragging] = useState(false),
    [saved, setSaved] = useState<File | null>(null),
    [notice, setNotice] = useState("");
  const [photos, setPhotos] = useState<File[] | null>(null);
  const [photoMessage, setPhotoMessage] = useState("");
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    setPhotos(null);
    setPhotoMessage("");
    setPhotoError("");
  }, [source, settings, placement]);
  const input = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    active = useRef<LoadedImage | null>(null),
    locked = useRef(false),
    swipe = useRef(0);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(null);
  };
  useEffect(() => {
    try {
      localStorage.setItem("splitter-settings", JSON.stringify(settings));
    } catch {}
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings]);
  useEffect(
    () => () => {
      generation.current++;
      active.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!busy) return;
    const prevent = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy]);
  const computed = useMemo(() => {
    if (!source) return { plan: null, error: "" };
    try {
      return { plan: makePlan(source, settings), error: "" };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }, [source, settings]);
  const plan = computed.plan;
  const [cols, rows] = grid(settings),
    count = cols * rows;
  useEffect(
    () =>
      setIndex((i) => Math.max(0, Math.min(i, (plan?.tiles.length ?? 1) - 1))),
    [plan],
  );
  async function openFile(file?: File) {
    if (!file || locked.current) return;
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    setSaved(null);
    try {
      const next = await loadImage(file);
      if (ticket !== generation.current) {
        next.close();
        return;
      }
      active.current?.close();
      active.current = next;
      setSource(next);
      setPlacement({ ...CENTER });
      setIndex(0);
    } catch (e) {
      if (ticket === generation.current) setError((e as Error).message);
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  async function save(tile: number | null) {
    if (!source || !plan || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setSaved(null);
    setPhotos(null);
    setProgress("書き出しを準備しています…");
    try {
      const file = await exportImages(
        source,
        plan,
        settings,
        placement,
        tile,
        setProgress,
      );
      setSaved(file);
      download(file);
      setNotice(`${file.name} を作成しました。`);
    } catch (e) {
      setError(
        `保存できませんでした。${e instanceof Error ? e.message : "メモリ不足の可能性があります。解像度を下げて再試行してください。"}`,
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  async function share() {
    if (!saved) return;
    try {
      await navigator.share({ files: [saved] });
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError("共有できませんでした。「もう一度保存」をお試しください。");
    }
  }
  async function preparePhotos() {
    if (!source || !plan || locked.current) return;
    setModal("photos");
    setPhotoError("");
    setPhotoMessage("");
    setSaved(null);
    if (photos) return;
    locked.current = true;
    setBusy(true);
    setProgress("画像を準備しています…");
    try {
      const files = await exportPhotos(
        source,
        plan,
        settings,
        placement,
        setProgress,
      );
      if (!canShareFiles(files))
        throw new Error(
          "この端末・ブラウザでは、これらの画像をまとめて共有できません。枚数を減らすか、ZIP・個別保存をお使いください。",
        );
      setPhotos(files);
    } catch (e) {
      setPhotoError(
        e instanceof Error
          ? e.message
          : "画像を準備できませんでした。解像度を下げて再試行してください。",
      );
    } finally {
      locked.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  async function sharePhotos() {
    if (!photos || locked.current) return;
    setPhotoError("");
    setPhotoMessage("");
    if (!canShareFiles(photos)) {
      setPhotoError(
        "この画像をまとめて共有できません。ZIP・個別保存をお使いください。",
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setProgress("共有画面を開いています…");
    try {
      // Invoke directly in the button handler: no encoding awaits before share().
      await navigator.share({ files: photos });
      setPhotoMessage("共有画面の操作が完了しました。");
    } catch (e) {
      if ((e as Error).name === "AbortError")
        setPhotoMessage("共有をキャンセルしました。もう一度開けます。");
      else
        setPhotoError(
          "共有画面を開けませんでした。もう一度押すか、ZIP・個別保存をお試しください。",
        );
    } finally {
      locked.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  const tile = plan?.tiles[Math.min(index, plan.tiles.length - 1)];
  const editor =
    source && plan ? (
      <Editor
        source={source}
        plan={plan}
        settings={settings}
        placement={placement}
        onPlacement={setPlacement}
        disabled={busy || loading}
      />
    ) : null;
  const sizeText = plan
    ? `${Math.min(...plan.tiles.map((t) => t.width))}${new Set(plan.tiles.map((t) => t.width)).size > 1 ? "–" + Math.max(...plan.tiles.map((t) => t.width)) : ""} × ${Math.min(...plan.tiles.map((t) => t.height))}${new Set(plan.tiles.map((t) => t.height)).size > 1 ? "–" + Math.max(...plan.tiles.map((t) => t.height)) : ""} px`
    : "—";
  return (
    <>
      <header className="app-header">
        <a href="." className="brand" aria-label="Image Splitter ホーム">
          <span className="brand-icon">
            <Columns3 size={23} />
          </span>
          <span>
            Image Splitter<small>画像を、自由に分ける。</small>
          </span>
        </a>
        <div className="header-right">
          <span className="private-badge">
            <LockKeyhole size={13} />
            端末内で処理
          </span>
          <button
            className="icon-button"
            aria-label="アプリ設定"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={21} />
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE TOOL, MORE POSSIBILITIES</div>
            <h1>1枚から、広がるかたち。</h1>
            <p>パノラマも、イラストも。思いどおりの分割を。</p>
          </div>
          <span className="version">
            LOCAL IMAGE WORKSPACE <span>v1.0</span>
          </span>
        </div>
        <input
          ref={input}
          data-testid="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          hidden
          onChange={(e) => {
            void openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button aria-label="エラーを閉じる" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section
            className="preview-panel"
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void openFile(e.dataTransfer.files[0]);
            }}
          >
            <div className="section-heading preview-heading">
              <h2>
                <span className="step">01</span>プレビュー
              </h2>
              <div className="row">
                {source && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => input.current?.click()}
                  >
                    <ImagePlus size={16} />
                    画像を変更
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="プレビューを拡大"
                  disabled={!plan}
                  onClick={() => setModal("expand")}
                >
                  <Expand size={17} />
                </button>
              </div>
            </div>
            <div
              className={`preview-stage ${dragging ? "dragging" : ""} ${!source ? "empty" : ""}`}
            >
              {loading ? (
                <div className="loading-cover" role="status">
                  <span className="spinner" />
                  画像を読み込んでいます…
                </div>
              ) : null}
              {source ? (
                (editor ?? (
                  <div className="invalid-preview">
                    <ImagePlus size={36} />
                    <p>
                      設定を調整すると、ここに
                      <br />
                      分割プレビューが表示されます。
                    </p>
                  </div>
                ))
              ) : (
                <button
                  className="upload-area"
                  onClick={() => input.current?.click()}
                  disabled={loading}
                >
                  <span className="upload-art">
                    <span />
                    <span />
                    <span />
                    <Upload size={26} />
                  </span>
                  <strong>ここから、画像を分割。</strong>
                  <span>画像をドロップ、または選択してください</span>
                  <span className="upload-cta">
                    <Plus size={18} />
                    画像を選択
                  </span>
                  <small>PNG / JPEG / WebP · 最大24MP・64MB</small>
                </button>
              )}
              {dragging && (
                <div className="drop-cover">画像をドロップして読み込む</div>
              )}
            </div>
            <div className="preview-footer">
              {source ? (
                <>
                  <div className="file-info">
                    <span className="file-icon">
                      <ImagePlus size={19} />
                    </span>
                    <div>
                      <strong title={source.name}>{source.name}</strong>
                      <small>
                        {source.width.toLocaleString()} ×{" "}
                        {source.height.toLocaleString()} px <span>·</span>{" "}
                        {(source.width / source.height).toFixed(3)}:1{" "}
                        <span>·</span> {(source.bytes / 1024 / 1024).toFixed(2)}{" "}
                        MB
                      </small>
                    </div>
                  </div>
                  <span className="tag">
                    {settings.mode === "original"
                      ? "原寸をキープ"
                      : "比率を指定"}
                  </span>
                </>
              ) : (
                <>
                  <LockKeyhole size={14} />
                  <span>
                    画像はアップロードされません。すべての処理がこの端末で完結します。
                  </span>
                </>
              )}
            </div>
            {source && (
              <p className="editor-hint">
                {settings.mode === "ratio"
                  ? "ドラッグで移動 · ピンチ／ホイールで拡大縮小 · ダブルタップで中央へ"
                  : "原寸分割では、拡大・縮小・トリミングをせずに画像を分けます。"}
              </p>
            )}
            <div className="workflow-notes">
              <div>
                <span>01</span>
                <strong>画像を選ぶ</strong>
                <p>写真やイラストを読み込み</p>
              </div>
              <div>
                <span>02</span>
                <strong>自由に分ける</strong>
                <p>方向・枚数・比率を調整</p>
              </div>
              <div>
                <span>03</span>
                <strong>まとめて保存</strong>
                <p>必要な形式でダウンロード</p>
              </div>
            </div>
          </section>
          <aside className="settings-panel">
            <div className="section-heading settings-heading">
              <h2>
                <span className="step">02</span>分割設定
              </h2>
              <span className="tag">{count}枚に分割</span>
            </div>
            <fieldset disabled={busy || loading}>
              <section className="control-section">
                <label className="field-title">分割方向</label>
                <div className="segmented direction">
                  {(
                    [
                      ["horizontal", "左右", ArrowLeftRight],
                      ["vertical", "上下", ArrowUpDown],
                      ["grid", "グリッド", Grid2X2],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      aria-pressed={settings.direction === key}
                      onClick={() => change("direction", key)}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="counts">
                  {settings.direction === "grid" ? (
                    <>
                      <Counter
                        label="列数"
                        value={settings.columns}
                        min={1}
                        max={Math.min(
                          20,
                          Math.floor(100 / Math.max(1, settings.rows)),
                        )}
                        onChange={(v) => change("columns", v)}
                      />
                      <Counter
                        label="行数"
                        value={settings.rows}
                        min={1}
                        max={Math.min(
                          20,
                          Math.floor(100 / Math.max(1, settings.columns)),
                        )}
                        onChange={(v) => change("rows", v)}
                      />
                    </>
                  ) : (
                    <Counter
                      label="分割枚数"
                      value={settings.count}
                      min={2}
                      max={20}
                      onChange={(v) => change("count", v)}
                    />
                  )}
                </div>
              </section>
              <section className="control-section">
                <label className="field-title">出力方式</label>
                <div className="mode-options">
                  {(
                    [
                      ["original", "原寸で分割", "元のピクセルを、そのまま。"],
                      [
                        "ratio",
                        "アスペクト比指定",
                        "1枚ごとの比率と配置を調整。",
                      ],
                    ] as const
                  ).map(([key, title, caption]) => (
                    <button
                      className={`mode-option ${settings.mode === key ? "selected" : ""}`}
                      key={key}
                      aria-pressed={settings.mode === key}
                      onClick={() => change("mode", key)}
                    >
                      <span className="radio-dot" />
                      <span>
                        <strong>{title}</strong>
                        <small>{caption}</small>
                      </span>
                      {key === "original" && (
                        <span className="tiny-tag">おすすめ</span>
                      )}
                    </button>
                  ))}
                </div>
                {settings.mode === "ratio" && (
                  <div className="ratio-controls">
                    <label className="field-title" htmlFor="ratio">
                      1枚のアスペクト比
                    </label>
                    <select
                      id="ratio"
                      value={settings.ratio}
                      onChange={(e) => change("ratio", e.target.value)}
                    >
                      {RATIOS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                      <option value="custom">カスタム</option>
                    </select>
                    {settings.ratio === "custom" && (
                      <div className="custom-ratio">
                        <label>
                          横
                          <input
                            type="number"
                            aria-label="比率の横"
                            step="0.001"
                            min="0.001"
                            max="10000"
                            value={settings.customW || ""}
                            onChange={(e) =>
                              change("customW", Number(e.target.value))
                            }
                          />
                        </label>
                        <span>:</span>
                        <label>
                          縦
                          <input
                            type="number"
                            aria-label="比率の縦"
                            step="0.001"
                            min="0.001"
                            max="10000"
                            value={settings.customH || ""}
                            onChange={(e) =>
                              change("customH", Number(e.target.value))
                            }
                          />
                        </label>
                      </div>
                    )}
                    <div className="fit-buttons">
                      <button
                        disabled={!plan}
                        onClick={() =>
                          source && plan && setPlacement(fit(source, plan))
                        }
                      >
                        全体表示
                      </button>
                      <button
                        disabled={!plan}
                        onClick={() =>
                          source &&
                          plan &&
                          setPlacement(fit(source, plan, true))
                        }
                      >
                        余白なし
                      </button>
                      <button
                        className="icon-button"
                        aria-label="画像を中央に戻す"
                        onClick={() =>
                          setPlacement((p) => ({ ...p, x: 0, y: 0 }))
                        }
                      >
                        <RotateCcw size={16} />
                      </button>
                    </div>
                    <label className="range-label">
                      拡大率{" "}
                      <output>{Math.round(placement.zoom * 100)}%</output>
                      <input
                        aria-label="拡大率"
                        type="range"
                        min="0.1"
                        max={
                          source && plan
                            ? Math.max(20, fit(source, plan, true).zoom * 4)
                            : 20
                        }
                        step="0.01"
                        value={placement.zoom}
                        disabled={!plan}
                        onChange={(e) =>
                          source &&
                          plan &&
                          setPlacement(
                            zoomAt(
                              source,
                              plan,
                              placement,
                              Number(e.target.value),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="field-title">余白の色</label>
                    <div className="background-options">
                      {[
                        ["#ffffff", "白"],
                        ["#000000", "黒"],
                        ["transparent", "透明"],
                      ].map(([color, label]) => (
                        <button
                          key={color}
                          aria-label={`背景：${label}`}
                          aria-pressed={settings.background === color}
                          onClick={() => change("background", color)}
                        >
                          <span
                            className={`swatch ${color === "transparent" ? "checker" : ""}`}
                            style={{ backgroundColor: color }}
                          />
                          {label}
                        </button>
                      ))}
                      <label className="color-choice">
                        <input
                          aria-label="カスタム背景色"
                          type="color"
                          value={
                            settings.background === "transparent"
                              ? "#ffffff"
                              : settings.background
                          }
                          onChange={(e) => change("background", e.target.value)}
                        />
                        カスタム
                      </label>
                    </div>
                    <label className="field-title" htmlFor="resolution">
                      出力解像度
                    </label>
                    <select
                      id="resolution"
                      value={settings.resolution}
                      onChange={(e) =>
                        change(
                          "resolution",
                          e.target.value as Settings["resolution"],
                        )
                      }
                    >
                      <option value="auto">自動（元画質優先）</option>
                      <option value="custom">1枚の横幅を指定</option>
                    </select>
                    {settings.resolution === "custom" && (
                      <label className="width-input">
                        横幅
                        <input
                          aria-label="1枚の横幅"
                          type="number"
                          min="1"
                          max="16384"
                          list="widths"
                          value={settings.width || ""}
                          onChange={(e) =>
                            change("width", Number(e.target.value))
                          }
                        />
                        <span>px</span>
                        <datalist id="widths">
                          <option value="1080" />
                          <option value="1440" />
                          <option value="2048" />
                        </datalist>
                      </label>
                    )}
                  </div>
                )}
              </section>
              <section className="control-section output-section">
                <div className="output-row">
                  <label htmlFor="format" className="field-title">
                    保存形式
                  </label>
                  <select
                    id="format"
                    value={settings.format}
                    onChange={(e) =>
                      change("format", e.target.value as Settings["format"])
                    }
                  >
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>
                {settings.format !== "png" && (
                  <label className="range-label">
                    品質<output>{Math.round(settings.quality * 100)}%</output>
                    <input
                      aria-label="品質"
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.01"
                      value={settings.quality}
                      onChange={(e) =>
                        change("quality", Number(e.target.value))
                      }
                    />
                  </label>
                )}
                {settings.format === "jpeg" &&
                  settings.background === "transparent" && (
                    <p className="inline-note">
                      JPEGの透明部分は白になります。透明を保持する場合はPNGまたはWebPを選択してください。
                    </p>
                  )}
                <div className="output-summary">
                  <span>
                    1枚の出力サイズ<strong>{sizeText}</strong>
                  </span>
                  <span>
                    出力枚数
                    <strong>
                      {plan?.tiles.length ?? count}
                      <small> 枚</small>
                    </strong>
                  </span>
                </div>
                {plan?.adjusted && (
                  <p className="inline-note">
                    正確な比率になるよう、横幅を{plan.tiles[0].width}
                    pxに調整しました。
                  </p>
                )}
                {computed.error && (
                  <p className="inline-error" role="alert">
                    {computed.error}
                  </p>
                )}
                {plan &&
                  (count >= 30 || plan.width * plan.height > 12_000_000) && (
                    <p className="inline-note">
                      出力が大きいため、端末によって時間やメモリが必要です。必要に応じて枚数・解像度を下げてください。
                    </p>
                  )}
              </section>
            </fieldset>
            <div className="save-actions">
              <button
                className="primary-button"
                disabled={!plan || busy || loading}
                onClick={() => void preparePhotos()}
              >
                <Share2 size={19} />
                写真にまとめて保存
              </button>
              <button
                className="secondary-button"
                disabled={!plan || busy || loading}
                onClick={() => setModal("tiles")}
              >
                <Grid2X2 size={17} />
                分割画像を確認
                <ChevronRight size={16} />
              </button>
              <button
                className="secondary-button"
                disabled={!plan || busy || loading}
                onClick={() => void save(null)}
              >
                {busy ? (
                  <span className="spinner" />
                ) : (
                  <ArrowDownToLine size={19} />
                )}{" "}
                {busy ? "書き出し中…" : "ZIPで一括保存"}
                {!busy && <span>{count}枚</span>}
              </button>
              <small>元の画像は変更されません</small>
            </div>
          </aside>
        </div>
        {busy && (
          <div className="toast" role="status">
            <span className="spinner" />
            {progress}
          </div>
        )}
        {!busy && saved && (
          <div className="saved-notice" role="status">
            <Check size={18} />
            <span>{notice}</span>
            <button onClick={() => download(saved)}>もう一度保存</button>
            {typeof navigator.canShare === "function" &&
              navigator.canShare({ files: [saved] }) && (
                <button onClick={() => void share()}>
                  <Share2 size={16} />
                  共有・ファイルに保存
                </button>
              )}
            <button
              aria-label="保存通知を閉じる"
              onClick={() => setSaved(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <footer className="app-footer">
          <span>
            <Columns3 size={14} />
            Image Splitter
          </span>
          <span>
            あなたの画像は、あなたの端末に。
            <span className="status-dot" />
            {offlineReady ? "オフライン準備完了" : "プライベートな画像ツール"}
          </span>
        </footer>
      </main>
      {modal === "photos" && (
        <Dialog
          title="写真にまとめて保存"
          locked={busy}
          onClose={() => {
            setModal(null);
            setPhotos(null);
          }}
        >
          <p>
            共有画面で「画像を保存」を選ぶと、写真アプリへまとめて保存できます。表示される項目や保存先は端末によって異なります。
          </p>
          {settings.format === "webp" && (
            <p className="inline-note">
              写真用にはPNGで用意します。ZIP・個別保存は選択中のWebP形式です。
            </p>
          )}
          {busy ? (
            <p className="inline-note" role="status">
              {progress}
            </p>
          ) : photos ? (
            <>
              <p className="inline-note">
                {photos.length}枚の画像を用意しました（
                {(
                  photos.reduce((sum, f) => sum + f.size, 0) /
                  1024 /
                  1024
                ).toFixed(1)}
                MB）。
              </p>
              <button
                className="primary-button"
                onClick={() => void sharePhotos()}
              >
                <Share2 size={18} />
                写真に保存・共有
              </button>
            </>
          ) : !photoError ? (
            <button
              className="primary-button"
              onClick={() => void preparePhotos()}
            >
              画像を準備する
            </button>
          ) : null}
          {photoError && (
            <>
              <p className="inline-error" role="alert">
                {photoError}
              </p>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void preparePhotos()}
              >
                もう一度準備する
              </button>
            </>
          )}
          {photoMessage && (
            <p className="inline-note" role="status">
              {photoMessage}
            </p>
          )}
          <button
            className="secondary-button"
            disabled={busy || !plan}
            onClick={() => {
              setModal(null);
              void save(null);
            }}
          >
            ZIPで保存する
          </button>
        </Dialog>
      )}
      {modal === "settings" && (
        <Dialog title="アプリ設定" onClose={() => setModal(null)}>
          <label className="field-title" htmlFor="theme">
            テーマ
          </label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) =>
              change("theme", e.target.value as Settings["theme"])
            }
          >
            <option value="system">端末の設定に合わせる</option>
            <option value="light">明るい</option>
            <option value="dark">暗い</option>
          </select>
          <h3>ホーム画面で使う</h3>
          <p>
            iPhoneではSafariの共有メニューから「ホーム画面に追加」を選択します。対応ブラウザではメニューからアプリをインストールできます。
          </p>
          <h3>オフラインとデータ</h3>
          <p>
            初回読み込み後、アプリ本体が保存されます。画像は外部に送信されず、再起動後は選び直します。設定のみをこのブラウザに保存します。
          </p>
          <p className="inline-note">
            {offlineReady
              ? "オフライン利用の準備ができました。"
              : "オフライン利用には、本番ビルドをHTTPSまたはlocalhostで一度読み込んでください。"}
          </p>
          {needRefresh && (
            <button
              className="primary-button"
              disabled={busy || loading}
              onClick={() => void updateServiceWorker(true)}
            >
              アプリを更新（画像は選び直しになります）
            </button>
          )}
        </Dialog>
      )}
      {modal === "expand" && (
        <Dialog title="プレビューを拡大" wide onClose={() => setModal(null)}>
          <div className="expanded-stage">{editor}</div>
          <p className="editor-hint">
            {settings.mode === "ratio"
              ? "ドラッグ・ピンチで調整できます。"
              : "分割番号は保存順です。"}
          </p>
        </Dialog>
      )}
      {modal === "tiles" && source && plan && tile && (
        <Dialog
          title="分割画像を確認"
          wide
          locked={busy}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <div
            className="individual-stage"
            onTouchStart={(e) => (swipe.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              if (busy) return;
              const dx = e.changedTouches[0].clientX - swipe.current;
              if (Math.abs(dx) > 45)
                setIndex((i) =>
                  Math.max(
                    0,
                    Math.min(plan.tiles.length - 1, i + (dx < 0 ? 1 : -1)),
                  ),
                );
            }}
          >
            <Editor
              source={source}
              plan={plan}
              settings={settings}
              placement={placement}
              onPlacement={setPlacement}
              tileIndex={index}
            />
          </div>
          <div className="tile-nav">
            <button
              aria-label="前の画像"
              disabled={index === 0 || busy}
              onClick={() => setIndex((i) => i - 1)}
            >
              <ChevronLeft />
            </button>
            <span>
              <strong>
                {String(index + 1).padStart(2, "0")} / {plan.tiles.length}
              </strong>
              <small>
                {tile.width} × {tile.height} px
              </small>
            </span>
            <button
              aria-label="次の画像"
              disabled={index === plan.tiles.length - 1 || busy}
              onClick={() => setIndex((i) => i + 1)}
            >
              <ChevronRight />
            </button>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void save(index)}
          >
            <ArrowDownToLine size={18} />
            {busy ? progress : "この画像を保存"}
          </button>
          <p className="editor-hint">左右スワイプでも切り替えられます。</p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {!busy && saved && (
            <div className="inline-note" role="status">
              <p>{saved.name} を作成しました。</p>
              <button onClick={() => download(saved)}>もう一度保存</button>
              {typeof navigator.canShare === "function" &&
                navigator.canShare({ files: [saved] }) && (
                  <button onClick={() => void share()}>
                    <Share2 size={16} />
                    共有・ファイルに保存
                  </button>
                )}
            </div>
          )}
        </Dialog>
      )}
      {needRefresh && modal !== "settings" && (
        <div className="update-banner">
          新しいバージョンがあります。
          <button
            disabled={busy || loading}
            onClick={() => setModal("settings")}
          >
            更新を確認
          </button>
        </div>
      )}
    </>
  );
}
