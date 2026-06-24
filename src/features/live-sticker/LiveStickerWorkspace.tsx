import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCoreHealth, getCoreBaseUrl, type CoreHealth } from "../../lib/core-api";
import {
  assetKindLabels,
  type CompositionDocument,
  type CompositionLayer,
  type PersistenceState,
  type ProjectAsset,
  type ProjectAssetKind,
  type TypographyPresetKey,
  type TypographySettings,
  useProjectWorkspace,
} from "./project-state";
import "./live-sticker.css";

type ToolId = "background" | "typography" | "composition" | "exports";
type HealthState = "checking" | "online" | "offline";

const tools: Array<{ id: ToolId; step: string; label: string; caption: string }> = [
  { id: "background", step: "01", label: "背景生成", caption: "上贴 / 下贴 / 侧贴" },
  { id: "typography", step: "02", label: "文字图层", caption: "透明文字素材" },
  { id: "composition", step: "03", label: "效果融合", caption: "画板与遮罩" },
  { id: "exports", step: "04", label: "导出资产", caption: "选择与打包" },
];

const publicAssetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

const fontPresets: Array<{ key: TypographyPresetKey; label: string; detail: string; image?: string }> = [
  { key: "elegant-songti", label: "优雅宋体", detail: "明宋结构、细粗对比、克制的印刷感", image: publicAssetUrl("font-presets/elegant-songti.png") },
  { key: "expressive-calligraphy", label: "表现书法", detail: "笔势、压感变化与有方向的笔画", image: publicAssetUrl("font-presets/expressive-calligraphy.png") },
  { key: "rounded-cute", label: "圆润可爱", detail: "饱满圆角、轻松易读的贴纸字形", image: publicAssetUrl("font-presets/rounded-cute.png") },
  { key: "custom-reference", label: "自定义参考", detail: "使用你上传的字体参考图，不默认传入第二张预设图" },
];

export function LiveStickerWorkspace({
  language,
  onLanguageChange,
}: {
  language: "zh" | "en";
  onLanguageChange: (language: "zh" | "en") => void;
}) {
  const [activeTool, setActiveTool] = useState<ToolId>("background");
  const {
    assets,
    composition,
    typography,
    persistenceState,
    projectReady,
    canUndo,
    canRedo,
    addAsset,
    removeAsset,
    selectLayer,
    updateLayer,
    updateLayerMask,
    beginCompositionInteraction,
    endCompositionInteraction,
    undoComposition,
    redoComposition,
    setTypography,
  } = useProjectWorkspace();
  const [healthState, setHealthState] = useState<HealthState>("checking");
  const [health, setHealth] = useState<CoreHealth | null>(null);
  const [healthMessage, setHealthMessage] = useState("正在检查 Core 连接");

  const checkHealth = useCallback(async () => {
    setHealthState("checking");
    setHealthMessage("正在检查 Core 连接");
    try {
      const result = await fetchCoreHealth();
      setHealth(result);
      setHealthState("online");
      setHealthMessage("CORE READY · FOUNDATION");
    } catch (error) {
      setHealth(null);
      setHealthState("offline");
      setHealthMessage(error instanceof Error ? "CORE OFFLINE" : "CORE UNAVAILABLE");
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div className="brand-lockup">
          <img className="brand-mark" src={publicAssetUrl("tool-icon.svg")} alt="MUYANG 工具" />
          <div>
            <p>MUYANG x NOBOOK</p>
            <h1>AI 直播贴片工作台</h1>
          </div>
        </div>
        <div className="header-controls">
          <div className={`service-state ${healthState}`} title={getCoreBaseUrl() || "未配置 Core 地址"}>
            <span>{healthState === "online" ? "●" : "○"}</span>
            {healthMessage}
          </div>
          <button className="health-refresh" onClick={() => void checkHealth()} disabled={healthState === "checking"}>
            重新检查
          </button>
          <div className="language-switcher" aria-label="Language">
            <button className={language === "zh" ? "selected" : ""} onClick={() => onLanguageChange("zh")}>中文</button>
            <button className={language === "en" ? "selected" : ""} onClick={() => onLanguageChange("en")}>EN</button>
          </div>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="tool-sidebar" aria-label="工具导航">
          <p className="sidebar-label">工具箱</p>
          {tools.map((tool) => (
            <button
              className={activeTool === tool.id ? "tool-nav active" : "tool-nav"}
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
            >
              <span>{tool.step}</span>
              <strong>{tool.label}</strong>
              <small>{tool.caption}</small>
            </button>
          ))}
          <div className="sidebar-note">
            <span>当前项目资产</span>
            <p>{assets.length} 个本地素材。{persistenceCopy(persistenceState)}</p>
          </div>
        </aside>

        <section className="tool-canvas">
          <AssetRail assets={assets} onRemove={removeAsset} persistenceState={persistenceState} />
          <ToolPanel
            activeTool={activeTool}
            assets={assets}
            composition={composition}
            typography={typography}
            projectReady={projectReady}
            canUndo={canUndo}
            canRedo={canRedo}
            onAddAsset={addAsset}
            onSelectLayer={selectLayer}
            onUpdateLayer={updateLayer}
            onUpdateLayerMask={updateLayerMask}
            onBeginCompositionInteraction={beginCompositionInteraction}
            onEndCompositionInteraction={endCompositionInteraction}
            onUndo={undoComposition}
            onRedo={redoComposition}
            onTypographyChange={setTypography}
            health={health}
          />
        </section>
      </div>
    </main>
  );
}

function AssetRail({ assets, onRemove, persistenceState }: { assets: ProjectAsset[]; onRemove: (assetId: string) => void; persistenceState: PersistenceState }) {
  return (
    <section className="asset-rail" aria-label="当前项目资产">
      <div>
        <p>当前项目资产</p>
        <small>{persistenceCopy(persistenceState)}</small>
      </div>
      {assets.length === 0 ? (
        <span className="asset-empty">还没有上传素材</span>
      ) : (
        <div className="asset-chips">
          {assets.map((asset) => (
            <div className="asset-chip" key={asset.id}>
              <img alt="" src={asset.previewUrl} />
              <span>{assetKindLabels[asset.kind]} · {asset.fileName}</span>
              {asset.trimmed ? <em>已预剪裁</em> : null}
              <button aria-label={`移除 ${asset.fileName}`} onClick={() => onRemove(asset.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ToolPanel({
  activeTool,
  assets,
  composition,
  typography,
  projectReady,
  canUndo,
  canRedo,
  onAddAsset,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginCompositionInteraction,
  onEndCompositionInteraction,
  onUndo,
  onRedo,
  onTypographyChange,
  health,
}: {
  activeTool: ToolId;
  assets: ProjectAsset[];
  composition: CompositionDocument;
  typography: TypographySettings;
  projectReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginCompositionInteraction: () => void;
  onEndCompositionInteraction: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTypographyChange: (settings: TypographySettings) => void;
  health: CoreHealth | null;
}) {
  if (activeTool === "background") {
    return <BackgroundTool assets={assets} onAddAsset={onAddAsset} health={health} projectReady={projectReady} />;
  }
  if (activeTool === "typography") {
    return <TypographyTool assets={assets} onAddAsset={onAddAsset} projectReady={projectReady} typography={typography} onTypographyChange={onTypographyChange} />;
  }
  if (activeTool === "composition") {
    return <CompositionTool assets={assets} composition={composition} onAddAsset={onAddAsset} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginCompositionInteraction={onBeginCompositionInteraction} onEndCompositionInteraction={onEndCompositionInteraction} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} projectReady={projectReady} />;
  }
  return <ExportTool assets={assets} />;
}

function BackgroundTool({ assets, onAddAsset, health, projectReady }: ToolProps & { health: CoreHealth | null; projectReady: boolean }) {
  return (
    <ToolFrame eyebrow="01 / BACKGROUND ASSETS" title="背景生成" detail="上贴、下贴与侧贴将作为独立任务运行。当前先建立项目素材和 Core 连接；生成模块尚未接入。">
      <div className="tool-grid two">
        <AssetUpload kind="reference" label="添加直播间 / 色彩参考图" help="上传后可在后续背景生成与文字图层中复用。" onAddAsset={onAddAsset} disabled={!projectReady} />
        <StatusCard title="Core 服务" value={health ? "基础服务可用" : "等待 Core"} detail={health ? "模型 Provider 尚未配置。" : "请启动 live-sticker-api 后重新检查。"} />
      </div>
      <AssetCollection assets={assets.filter((asset) => asset.kind === "reference")} empty="添加一张参考图后，背景任务会从这里读取素材。" />
    </ToolFrame>
  );
}

function TypographyTool({ assets, onAddAsset, projectReady, typography, onTypographyChange }: ToolProps & { projectReady: boolean; typography: TypographySettings; onTypographyChange: (settings: TypographySettings) => void }) {
  const topAsset = latestAsset(assets, "top");
  const customColorReference = latestAsset(assets, "reference");
  const activeColorReference = customColorReference ?? topAsset;

  return (
    <ToolFrame eyebrow="02 / TYPOGRAPHY LAYER" title="文字图层" detail="该工具可独立使用。默认继承项目上贴的色彩、材质与装饰，也可由用户上传色彩纹理参考覆盖。">
      <div className="tool-grid two">
        <AssetUpload kind="reference" label="上传色彩纹理参考" help="最新上传的参考会优先于项目上贴。" onAddAsset={onAddAsset} disabled={!projectReady} />
        <AssetUpload kind="font-reference" label="上传字体参考" help="第一期仅保存一个主字体参考，后续服务端会去色处理。" onAddAsset={onAddAsset} disabled={!projectReady} />
      </div>
      <section className="font-preset-section" aria-label="默认生图字体">
        <div className="section-heading"><p>默认生图字体</p><small>这些参考图只约束字形与笔画节奏；色彩、材质与装饰仍以当前上贴或色彩纹理参考为准。</small></div>
        <div className="font-preset-grid">
          {fontPresets.map((preset) => (
            <button className={typography.fontPresetKey === preset.key ? "font-preset-card selected" : "font-preset-card"} key={preset.key} onClick={() => onTypographyChange({ fontPresetKey: preset.key })}>
              {preset.image ? <img src={preset.image} alt="" /> : <span className="custom-font-mark">Aa</span>}
              <strong>{preset.label}</strong>
              <small>{preset.detail}</small>
            </button>
          ))}
        </div>
      </section>
      <StatusCard
        title="当前色彩参考"
        value={activeColorReference ? `${assetKindLabels[activeColorReference.kind]} · ${activeColorReference.fileName}` : "尚未选择"}
        detail={activeColorReference ? "字体参考只影响字形、笔画和局部纹理，不覆盖整体色彩。" : "上传色彩纹理参考，或先向项目加入上贴素材。"}
      />
      <AssetCollection assets={assets.filter((asset) => asset.kind === "font-reference")} empty="当前使用内置字体预设；上传后可切换至自定义参考。" />
    </ToolFrame>
  );
}

function CompositionTool({
  assets,
  composition,
  onAddAsset,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginCompositionInteraction,
  onEndCompositionInteraction,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  projectReady,
}: ToolProps & {
  composition: CompositionDocument;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginCompositionInteraction: () => void;
  onEndCompositionInteraction: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  projectReady: boolean;
}) {
  const [mode, setMode] = useState<"select" | "mask">("select");
  const uploads: Array<{ kind: ProjectAssetKind; label: string }> = [
    { kind: "base-image", label: "直播间无贴片底图" },
    { kind: "top", label: "上贴" },
    { kind: "bottom", label: "下贴" },
    { kind: "side", label: "侧贴" },
    { kind: "typography", label: "文字图层" },
  ];

  const canvasLayers = composition.layers
    .map((layer) => ({ layer, asset: assets.find((asset) => asset.id === layer.assetId) }))
    .filter((item): item is { layer: CompositionLayer; asset: ProjectAsset } => Boolean(item.asset));
  const selectedLayer = canvasLayers.find((item) => item.layer.id === composition.selectedLayerId)?.layer ?? canvasLayers.at(-1)?.layer;

  return (
    <ToolFrame eyebrow="03 / COMPOSITION BOARD" title="效果融合" detail="该工具可独立使用。导入素材后会建立可保存的本地图层；位置、尺寸、透明度和遮罩预留字段都进入同一份项目文档。">
      <div className="upload-matrix">
        {uploads.map((upload) => (
          <AssetUpload key={upload.kind} kind={upload.kind} label={`导入${upload.label}`} help="新素材会替换画板中同类图层，历史素材仍保留在项目资产内。" onAddAsset={onAddAsset} compact disabled={!projectReady} />
        ))}
      </div>
      <div className="composition-workbench">
        <div className="composition-stage-wrap">
          <div className="composition-toolbar">
            <div className="canvas-mode-switch" aria-label="画板模式">
              <button className={mode === "select" ? "selected" : ""} onClick={() => setMode("select")}>选择图层</button>
              <button className={mode === "mask" ? "selected" : ""} onClick={() => setMode("mask")}>手绘渐隐</button>
            </div>
            <div className="history-controls">
              <button aria-label="撤销画板操作" title="撤销" disabled={!canUndo} onClick={onUndo}>↶</button>
              <button aria-label="恢复画板操作" title="恢复" disabled={!canRedo} onClick={onRedo}>↷</button>
            </div>
          </div>
          <CompositionCanvas layers={canvasLayers} selectedLayer={selectedLayer} mode={mode} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} />
          <p className="stage-note">{mode === "mask" ? "手绘模式：在上贴或下贴区域画渐隐边界线。上贴保留线以上，下贴保留线以下；按住 Shift 可画水平直线。" : "拖动图层可移动；拖右下角控制点可缩放。默认羽化和手绘渐隐都会保存到同一项目文档。"}</p>
        </div>
        <CompositionInspector layer={selectedLayer} asset={selectedLayer ? assets.find((asset) => asset.id === selectedLayer.assetId) : undefined} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} layers={canvasLayers} />
      </div>
    </ToolFrame>
  );
}

function CompositionCanvas({
  layers,
  selectedLayer,
  mode,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginInteraction,
  onEndInteraction,
}: {
  layers: Array<{ layer: CompositionLayer; asset: ProjectAsset }>;
  selectedLayer?: CompositionLayer;
  mode: "select" | "mask";
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<{
    type: "drag" | "resize";
    pointerId: number;
    layer: CompositionLayer;
    startX: number;
    startY: number;
  } | null>(null);
  const fadeDrawing = useRef<{ pointerId: number; layer: CompositionLayer; lockedY: number | null } | null>(null);
  const [previewPath, setPreviewPath] = useState<Array<{ x: number; y: number }>>([]);

  const percentPoint = (event: ReactPointerEvent<HTMLElement>, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, layer: CompositionLayer) => {
    if (mode !== "select") return;
    if (event.button !== 0) return;
    event.preventDefault();
    onSelectLayer(layer.id);
    onBeginInteraction();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { type: "drag", pointerId: event.pointerId, layer, startX: event.clientX, startY: event.clientY };
  };

  const onResizeDown = (event: ReactPointerEvent<HTMLSpanElement>, layer: CompositionLayer) => {
    if (mode !== "select" || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);
    onBeginInteraction();
    const parent = event.currentTarget.parentElement;
    parent?.setPointerCapture(event.pointerId);
    interaction.current = { type: "resize", pointerId: event.pointerId, layer, startX: event.clientX, startY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const stageBounds = stage.getBoundingClientRect();
    const deltaX = ((event.clientX - active.startX) / stageBounds.width) * 100;
    const deltaY = ((event.clientY - active.startY) / stageBounds.height) * 100;
    if (active.type === "drag") {
      onUpdateLayer(active.layer.id, { x: active.layer.x + deltaX, y: active.layer.y + deltaY });
    } else {
      onUpdateLayer(active.layer.id, { width: active.layer.width + deltaX, height: active.layer.height + deltaY });
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interaction.current || interaction.current.pointerId !== event.pointerId) return;
    interaction.current = null;
    onEndInteraction();
  };

  const fadeTargetAt = (point: { x: number; y: number }) => {
    const top = layers.find((item) => item.layer.kind === "top")?.layer;
    const bottom = layers.find((item) => item.layer.kind === "bottom")?.layer;
    if (top && point.y >= top.y && point.y <= top.y + top.height) return top;
    if (bottom && point.y >= bottom.y && point.y <= bottom.y + bottom.height) return bottom;
    return undefined;
  };

  const constrainFadePoint = (point: { x: number; y: number }, layer: CompositionLayer) => {
    const padding = Math.min(4, layer.height / 3);
    return { x: Math.max(layer.x, Math.min(layer.x + layer.width, point.x)), y: Math.max(layer.y + padding, Math.min(layer.y + layer.height - padding, point.y)) };
  };

  const onFadeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== "mask" || event.button !== 0) return;
    const rawPoint = percentPoint(event, event.currentTarget);
    const layer = fadeTargetAt(rawPoint);
    if (!layer) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = constrainFadePoint(rawPoint, layer);
    fadeDrawing.current = { pointerId: event.pointerId, layer, lockedY: event.shiftKey ? point.y : null };
    setPreviewPath([point]);
    onSelectLayer(layer.id);
    onBeginInteraction();
    onUpdateLayerMask(layer.id, (mask) => ({ ...mask, mode: "manual", fadePath: [point] }));
  };

  const onFadeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = fadeDrawing.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const rawPoint = percentPoint(event, event.currentTarget);
    const constrained = constrainFadePoint(rawPoint, active.layer);
    const point = active.lockedY === null ? constrained : { ...constrained, y: active.lockedY };
    setPreviewPath((current) => {
      const last = current.at(-1);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.8) return current;
      const next = [...current, point];
      onUpdateLayerMask(active.layer.id, (mask) => ({ ...mask, mode: "manual", fadePath: next }));
      return next;
    });
  };

  const onFadeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!fadeDrawing.current || fadeDrawing.current.pointerId !== event.pointerId) return;
    fadeDrawing.current = null;
    setPreviewPath([]);
    onEndInteraction();
  };

  return (
    <div className="composition-stage" ref={stageRef} aria-label="融合画板">
      {layers.length === 0 ? <p>导入底图或贴片素材后，图层会出现在这里。</p> : layers.map(({ layer, asset }) => (
        <div
          className={layer.id === selectedLayer?.id ? "canvas-layer selected" : "canvas-layer"}
          key={layer.id}
          onPointerDown={(event) => onPointerDown(event, layer)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          style={{
            left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100,
            zIndex: layer.zIndex, visibility: layer.visible ? "visible" : "hidden", ...maskStyle(layer),
          }}
          title={`${assetKindLabels[layer.kind]} · ${asset.fileName}`}
          role="button"
          tabIndex={0}
          aria-label={`${assetKindLabels[layer.kind]} 图层`}
        >
          <img src={asset.previewUrl} alt={assetKindLabels[layer.kind]} draggable={false} />
          <span>{assetKindLabels[layer.kind]}</span>
          {layer.id === selectedLayer?.id && mode === "select" ? <i className="resize-handle" onPointerDown={(event) => onResizeDown(event, layer)} title="拖动缩放" /> : null}
        </div>
      ))}
      {mode === "mask" ? <div className="fade-drawing-overlay" title="在上贴或下贴区域画渐隐线，按住 Shift 可画水平直线" onPointerDown={onFadeStart} onPointerMove={onFadeMove} onPointerUp={onFadeEnd} onPointerCancel={onFadeEnd}>{previewPath.length > 1 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={pointsToSvgPath(previewPath)} /></svg> : null}</div> : null}
    </div>
  );
}

function CompositionInspector({
  layer,
  asset,
  layers,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginInteraction,
  onEndInteraction,
}: {
  layer?: CompositionLayer;
  asset?: ProjectAsset;
  layers: Array<{ layer: CompositionLayer; asset: ProjectAsset }>;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
}) {
  return (
    <aside className="composition-inspector" aria-label="图层属性">
      <p>图层</p>
      <div className="layer-list">
        {layers.length === 0 ? <span>暂无图层</span> : layers.slice().sort((a, b) => b.layer.zIndex - a.layer.zIndex).map((item) => (
          <button className={item.layer.id === layer?.id ? "layer-row selected" : "layer-row"} key={item.layer.id} onClick={() => onSelectLayer(item.layer.id)}>
            <span>{assetKindLabels[item.layer.kind]}</span>
            <small>{item.asset.fileName}</small>
          </button>
        ))}
      </div>
      {layer && asset ? (
        <div className="layer-controls">
          <h3>{assetKindLabels[layer.kind]}</h3>
          <LayerRange label="横向位置" value={layer.x} max={100 - layer.width} onChange={(x) => onUpdateLayer(layer.id, { x })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label="纵向位置" value={layer.y} max={100 - layer.height} onChange={(y) => onUpdateLayer(layer.id, { y })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label="宽度" value={layer.width} min={1} onChange={(width) => onUpdateLayer(layer.id, { width })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label="高度" value={layer.height} min={1} onChange={(height) => onUpdateLayer(layer.id, { height })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label="透明度" value={layer.opacity} min={0} onChange={(opacity) => onUpdateLayer(layer.id, { opacity })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          {layer.kind !== "base-image" && layer.kind !== "typography" ? <LayerRange label="默认羽化" value={layer.mask.feather} max={48} onChange={(feather) => onUpdateLayerMask(layer.id, (mask) => ({ ...mask, feather }))} onBegin={onBeginInteraction} onEnd={onEndInteraction} /> : null}
          <label className="layer-visibility"><input type="checkbox" checked={layer.visible} onChange={(event) => { onBeginInteraction(); onUpdateLayer(layer.id, { visible: event.target.checked }); onEndInteraction(); }} /> 显示图层</label>
          <button className="mask-reset" onClick={() => { onBeginInteraction(); onUpdateLayer(layer.id, { mask: { mode: "default", feather: layer.mask.feather, fadePath: [], edgeTexture: "none" } }); onEndInteraction(); }}>重置手绘渐隐</button>
        </div>
      ) : <p className="empty-copy">选择一个图层后可调整它的本地状态。</p>}
    </aside>
  );
}

function LayerRange({ label, value, min = 0, max = 100, onChange, onBegin, onEnd }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void; onBegin: () => void; onEnd: () => void }) {
  return <label className="layer-range"><span>{label}<b>{Math.round(value)}%</b></span><input type="range" min={min} max={Math.max(min, max)} value={value} onPointerDown={onBegin} onPointerUp={onEnd} onBlur={onEnd} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function maskStyle(layer: CompositionLayer) {
  if (typeof document === "undefined") return {};
  if (layer.kind !== "top" && layer.kind !== "bottom") return {};
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (!context) return {};

  const width = canvas.width;
  const height = canvas.height;
  const fallbackY = layer.kind === "top"
    ? layer.y + layer.height * 0.72
    : layer.y + layer.height * 0.28;
  const source = layer.mask.fadePath.length > 1 ? layer.mask.fadePath : defaultFadeLine(fallbackY, layer.x, layer.x + layer.width);
  const path = normalizeFadePath(source, layer);
  const localPoints = path.map((point) => ({
    x: ((point.x - layer.x) / layer.width) * width,
    y: ((point.y - layer.y) / layer.height) * height,
  }));
  const blur = Math.max(2, (Math.min(width, height) * layer.mask.feather) / 600);
  context.save();
  context.filter = `blur(${blur}px)`;
  context.fillStyle = "#ffffff";
  context.beginPath();
  if (layer.kind === "top") {
    context.moveTo(0, -blur * 2);
    context.lineTo(width, -blur * 2);
    context.lineTo(width, localPoints.at(-1)?.y ?? height * 0.72);
    [...localPoints].reverse().forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(0, localPoints[0]?.y ?? height * 0.72);
  } else {
    context.moveTo(0, localPoints[0]?.y ?? height * 0.28);
    localPoints.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(width, localPoints.at(-1)?.y ?? height * 0.28);
    context.lineTo(width, height + blur * 2);
    context.lineTo(0, height + blur * 2);
  }
  context.closePath();
  context.fill();
  context.restore();

  const image = `url("${canvas.toDataURL("image/png")}")`;
  return { maskImage: image, WebkitMaskImage: image, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" };
}

function defaultFadeLine(y: number, startX = 0, endX = 100) {
  const width = endX - startX;
  return [{ x: startX, y }, { x: startX + width * 0.35, y: y + 1.6 }, { x: startX + width * 0.7, y: y - 2 }, { x: endX, y }];
}

function normalizeFadePath(points: Array<{ x: number; y: number }>, layer: CompositionLayer) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const first = sorted[0] ?? { x: 0, y: layer.y + layer.height / 2 };
  const last = sorted.at(-1) ?? first;
  const padding = Math.min(4, layer.height / 3);
  const constrain = (point: { x: number; y: number }) => ({
    x: Math.max(layer.x, Math.min(layer.x + layer.width, point.x)),
    y: Math.max(layer.y + padding, Math.min(layer.y + layer.height - padding, point.y)),
  });
  return [constrain({ x: layer.x, y: first.y }), ...sorted.map(constrain), constrain({ x: layer.x + layer.width, y: last.y })];
}

function pointsToSvgPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
}

function ExportTool({ assets }: { assets: ProjectAsset[] }) {
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const selectedCount = useMemo(() => assets.filter((asset) => selectedAssetIds.has(asset.id)).length, [assets, selectedAssetIds]);

  return (
    <ToolFrame eyebrow="04 / EXPORT ASSETS" title="导出资产" detail="导出接口尚未接入。你现在可以真实勾选项目资产，后续 ZIP 打包会沿用这套选择状态。">
      <div className="export-list">
        {assets.length === 0 ? <p className="empty-copy">还没有可导出的项目资产。</p> : assets.map((asset) => {
          const selected = selectedAssetIds.has(asset.id);
          return (
            <label className="export-row" key={asset.id}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => setSelectedAssetIds((current) => {
                  const next = new Set(current);
                  if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id);
                  return next;
                })}
              />
              <span>{assetKindLabels[asset.kind]}</span>
              <strong>{asset.fileName}</strong>
              <small>{formatBytes(asset.sizeBytes)}</small>
            </label>
          );
        })}
      </div>
      <div className="export-footer">
        <span>{selectedCount} 个资产已选择</span>
        <button disabled>批量导出 ZIP</button>
        <label className="advanced-option"><input type="checkbox" disabled /> 项目配置 JSON（后期高级功能）</label>
      </div>
    </ToolFrame>
  );
}

type ToolProps = { assets: ProjectAsset[]; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset> };

function ToolFrame({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail: string; children: React.ReactNode }) {
  return <div className="tool-panel"><p className="panel-eyebrow">{eyebrow}</p><h2>{title}</h2><p className="panel-detail">{detail}</p>{children}</div>;
}

function AssetUpload({ kind, label, help, onAddAsset, compact = false, disabled = false }: { kind: ProjectAssetKind; label: string; help: string; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; compact?: boolean; disabled?: boolean }) {
  const [message, setMessage] = useState("");
  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const asset = await onAddAsset(file, kind);
      setMessage(asset.trimmed ? `已预剪裁：${file.name}` : `已添加：${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法添加该素材。");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <label className={`${compact ? "asset-upload compact" : "asset-upload"}${disabled ? " disabled" : ""}`}>
      <span>{label}</span>
      <small>{help}</small>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onChange} disabled={disabled} />
      <strong>{message || (disabled ? "正在恢复项目" : "选择图片")}</strong>
    </label>
  );
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="status-card"><span>{title}</span><h3>{value}</h3><p>{detail}</p></article>;
}

function AssetCollection({ assets, empty }: { assets: ProjectAsset[]; empty: string }) {
  return assets.length === 0 ? <p className="empty-copy">{empty}</p> : <div className="asset-collection">{assets.map((asset) => <img key={asset.id} src={asset.previewUrl} alt={asset.fileName} title={`${assetKindLabels[asset.kind]} · ${asset.fileName}`} />)}</div>;
}

function latestAsset(assets: ProjectAsset[], kind: ProjectAssetKind) {
  return [...assets].reverse().find((asset) => asset.kind === kind);
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function persistenceCopy(state: PersistenceState) {
  if (state === "loading") return "正在恢复本地项目。";
  if (state === "saving") return "正在保存到此浏览器。";
  if (state === "error") return "本地保存不可用；当前会话仍可继续编辑。";
  return "已保存到此浏览器，可刷新后继续编辑。";
}
