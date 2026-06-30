import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BaseEdge, Controls, Handle, Position, ReactFlow, ReactFlowProvider, addEdge, getBezierPath, useEdgesState, useNodesState, type Connection, type EdgeProps, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createBackgroundJob, createTypographyJob, cutoutTypography, fetchCoreHealth, getCoreBaseUrl, type BackgroundKind, type CoreHealth, type ImageReferenceInput } from "../../lib/core-api";
import {
  assetKindLabels,
  COMPOSITION_OUTPUT,
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
type CompositionInputKind = "base-image" | "top" | "bottom" | "side" | "typography";
type FlowAssetNodeData = {
  kind: CompositionInputKind;
  label: string;
  language?: "zh" | "en";
  asset?: ProjectAsset;
  disabled?: boolean;
  onAddAsset?: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onSelectAsset?: (assetId: string) => void;
};

const tools: Array<{ id: ToolId; step: string; label: string; caption: string; englishLabel: string; englishCaption: string }> = [
  { id: "background", step: "01", label: "背景生成", caption: "上贴 / 下贴 / 侧贴", englishLabel: "Background", englishCaption: "Top / Bottom / Side" },
  { id: "typography", step: "02", label: "文字图层", caption: "透明文字素材", englishLabel: "Typography", englishCaption: "Transparent text" },
  { id: "composition", step: "03", label: "效果融合", caption: "画板与遮罩", englishLabel: "Composition", englishCaption: "Canvas & mask" },
  { id: "exports", step: "04", label: "导出资产", caption: "选择与打包", englishLabel: "Exports", englishCaption: "Select & package" },
];

const publicAssetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

const fontPresets: Array<{ key: TypographyPresetKey; label: string; detail: string; englishLabel: string; englishDetail: string; image?: string }> = [
  { key: "elegant-songti", label: "优雅宋体", detail: "明宋结构、细粗对比、克制的印刷感", englishLabel: "Elegant Songti", englishDetail: "Ming-style structure, measured contrast and print restraint", image: publicAssetUrl("font-presets/elegant-songti.png") },
  { key: "expressive-calligraphy", label: "表现书法", detail: "笔势、压感变化与有方向的笔画", englishLabel: "Expressive calligraphy", englishDetail: "Directional strokes with pressure variation", image: publicAssetUrl("font-presets/expressive-calligraphy.png") },
  { key: "rounded-cute", label: "圆润可爱", detail: "饱满圆角、轻松易读的贴纸字形", englishLabel: "Rounded playful", englishDetail: "Full rounded corners and easy sticker lettering", image: publicAssetUrl("font-presets/rounded-cute.png") },
  { key: "custom-reference", label: "自定义字体字形", detail: "上传去色字体图，只学习字形、笔画与局部纹理", englishLabel: "Custom glyph reference", englishDetail: "Upload a desaturated reference for glyphs and strokes" },
];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

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
  const isEnglish = language === "en";

  const checkHealth = useCallback(async () => {
    setHealthState("checking");
    setHealthMessage("正在检查 Core 连接");
    try {
      const result = await fetchCoreHealth();
      setHealth(result);
      setHealthState("online");
      setHealthMessage(`CORE READY · ${result.mode.toUpperCase()}`);
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
            <h1>{isEnglish ? "AI Live Sticker Studio" : "AI 直播贴片工作台"}</h1>
          </div>
        </div>
        <div className="header-controls">
          <div className={`service-state ${healthState}`} title={getCoreBaseUrl() || "未配置 Core 地址"}>
            <span>{healthState === "online" ? "●" : "○"}</span>
            {healthMessage}
          </div>
          <button className="health-refresh" onClick={() => void checkHealth()} disabled={healthState === "checking"}>
            {isEnglish ? "Retry" : "重新检查"}
          </button>
          <div className="language-switcher" aria-label="Language">
            <button className={language === "zh" ? "selected" : ""} onClick={() => onLanguageChange("zh")}>中文</button>
            <button className={language === "en" ? "selected" : ""} onClick={() => onLanguageChange("en")}>EN</button>
          </div>
        </div>
      </header>

      <div className="workspace-body">
        <aside className="tool-sidebar" aria-label="工具导航">
          <p className="sidebar-label">{isEnglish ? "TOOLBOX" : "工具箱"}</p>
          {tools.map((tool) => (
            <button
              className={activeTool === tool.id ? "tool-nav active" : "tool-nav"}
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
            >
              <span>{tool.step}</span>
              <strong>{isEnglish ? tool.englishLabel : tool.label}</strong>
              <small>{isEnglish ? tool.englishCaption : tool.caption}</small>
            </button>
          ))}
          <div className="sidebar-note">
            <span>{isEnglish ? "PROJECT ASSETS" : "当前项目资产"}</span>
            <p>{assets.length} {isEnglish ? "local assets. " : "个本地素材。"}{isEnglish ? persistenceCopyEn(persistenceState) : persistenceCopy(persistenceState)}</p>
          </div>
        </aside>

        <section className="tool-canvas">
          <AssetRail language={language} assets={assets} onRemove={removeAsset} persistenceState={persistenceState} />
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
            onTypographyChange={(patch) => setTypography((current) => ({ ...current, ...patch }))}
            onActivateTool={setActiveTool}
            health={health}
            language={language}
          />
        </section>
      </div>
    </main>
  );
}

function AssetRail({ language, assets, onRemove, persistenceState }: { language: "zh" | "en"; assets: ProjectAsset[]; onRemove: (assetId: string) => void; persistenceState: PersistenceState }) {
  const isEnglish = language === "en";
  return (
    <section className="asset-rail" aria-label={isEnglish ? "Current project assets" : "当前项目资产"}>
      <div>
        <p>{isEnglish ? "CURRENT PROJECT ASSETS" : "当前项目资产"}</p>
        <small>{isEnglish ? persistenceCopyEn(persistenceState) : persistenceCopy(persistenceState)}</small>
      </div>
      {assets.length === 0 ? (
        <span className="asset-empty">{isEnglish ? "No assets uploaded yet" : "还没有上传素材"}</span>
      ) : (
        <div className="asset-chips">
          {assets.map((asset) => (
            <div className="asset-chip" key={asset.id}>
              <img alt="" src={asset.previewUrl} />
              <span>{assetLabel(asset.kind, language)} · {asset.fileName}</span>
              {asset.trimmed ? <em>{isEnglish ? "trimmed" : "已预剪裁"}</em> : null}
              <button aria-label={isEnglish ? `Remove ${asset.fileName}` : `移除 ${asset.fileName}`} onClick={() => onRemove(asset.id)}>×</button>
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
  onActivateTool,
  health,
  language,
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
  onTypographyChange: (settings: Partial<TypographySettings>) => void;
  onActivateTool: (tool: ToolId) => void;
  health: CoreHealth | null;
  language: "zh" | "en";
}) {
  if (activeTool === "background") {
    return <BackgroundTool language={language} assets={assets} onAddAsset={onAddAsset} health={health} projectReady={projectReady} onActivateTool={onActivateTool} />;
  }
  if (activeTool === "typography") {
    return <TypographyTool language={language} assets={assets} onAddAsset={onAddAsset} projectReady={projectReady} typography={typography} onTypographyChange={onTypographyChange} />;
  }
  if (activeTool === "composition") {
    return <CompositionTool language={language} assets={assets} composition={composition} onAddAsset={onAddAsset} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginCompositionInteraction={onBeginCompositionInteraction} onEndCompositionInteraction={onEndCompositionInteraction} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} projectReady={projectReady} />;
  }
  return <ExportTool language={language} assets={assets} />;
}

function BackgroundTool({ language, assets, onAddAsset, health, projectReady, onActivateTool }: ToolProps & { language: "zh" | "en"; health: CoreHealth | null; projectReady: boolean; onActivateTool: (tool: ToolId) => void }) {
  const isEnglish = language === "en";
  const [prompt, setPrompt] = useState("");
  const [runningKind, setRunningKind] = useState<BackgroundKind | "all" | "">("");
  const [message, setMessage] = useState("");
  const reference = latestAsset(assets, "reference");
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const safeSetRunningKind = (value: BackgroundKind | "all" | "") => {
    if (mounted.current) setRunningKind(value);
  };

  const safeSetMessage = (value: string) => {
    if (mounted.current) setMessage(value);
  };

  const generateOne = async (kind: BackgroundKind) => {
    const job = await createBackgroundJob({ kind, prompt: prompt || undefined, reference: reference ? await assetReference(reference) : undefined });
    if (job.status === "failed") throw new Error(job.error?.message || "Background generation failed.");
    if (!job.result?.url) throw new Error(isEnglish ? "The job completed without an image." : "任务已完成，但没有返回图片。");
    await onAddAsset(await resultFile(job.result, `${kind}-${job.id}.jpg`), kind);
  };

  const runGeneration = async (kind: BackgroundKind | "all") => {
    if (!reference) {
      safeSetMessage(isEnglish ? "Add a room or colour reference before generation." : "请先添加直播间或色彩参考图。");
      return;
    }
    safeSetRunningKind(kind);
    safeSetMessage(isEnglish ? "OFOX is generating..." : "OFOX 正在生成…");
    try {
      if (kind === "all") {
        safeSetMessage(isEnglish ? "Generating top sticker first..." : "正在优先生成上贴，完成后会进入文字工具…");
        await generateOne("top");
        safeSetMessage(isEnglish ? "Top sticker is ready. Bottom and side continue in the background." : "上贴已完成；下贴与侧贴继续在后台生成。");
        onActivateTool("typography");
        void (async () => {
          for (const item of ["bottom", "side"] as BackgroundKind[]) {
            try {
              safeSetMessage(isEnglish ? `Generating ${item} in the background...` : `后台继续生成${item === "bottom" ? "下贴" : "侧贴"}…`);
              await generateOne(item);
            } catch (error) {
              console.warn(`Background ${item} generation failed`, error);
            }
          }
          safeSetMessage(isEnglish ? "Background assets generated." : "背景贴片已生成完成。");
          safeSetRunningKind("");
        })();
        return;
      } else {
        await generateOne(kind);
      }
      safeSetMessage(isEnglish ? "Generated and added to the project." : "生成成功，已加入当前项目。");
    } catch (error) {
      safeSetMessage(error instanceof Error ? error.message : (isEnglish ? "Generation failed." : "生成失败。"));
    } finally {
      if (kind !== "all") safeSetRunningKind("");
    }
  };

  return (
    <ToolFrame eyebrow="01 / BACKGROUND ASSETS" title={isEnglish ? "Background assets" : "背景生成"} detail={isEnglish ? "Generate each asset independently or run the fixed top, bottom and side sequence. The latest reference supplies palette, material and texture." : "上贴、下贴与侧贴既可独立生成，也可按上、下、侧的固定顺序依次生成；最新参考图提供色彩、材质与纹理。"}>
      <div className="tool-grid two">
        <AssetUpload language={language} kind="reference" label={isEnglish ? "Room / colour reference" : "添加直播间 / 色彩参考图"} help={isEnglish ? "Reuse it in later background and typography work." : "上传后可在后续背景生成与文字图层中复用。"} onAddAsset={onAddAsset} disabled={!projectReady} />
        <StatusCard title={isEnglish ? "Core service" : "Core 服务"} value={health?.providers.imageGeneration === "ready" ? (isEnglish ? "OFOX ready" : "OFOX 已就绪") : (isEnglish ? "Waiting for Core" : "等待 Core")} detail={health?.providers.imageGeneration === "ready" ? (isEnglish ? "Background generation is available." : "上、下、侧贴生成均可用。") : (isEnglish ? "Check the server OFOX configuration." : "请检查服务器 OFOX 配置。")} />
      </div>
      <TypographyInstructionInput language={language} value={prompt} onChange={setPrompt} disabled={!projectReady || Boolean(runningKind)} />
      <div className="generation-action-row background-generation-actions">
        <button type="button" onClick={() => void runGeneration("all")} disabled={!projectReady || !reference || Boolean(runningKind)}>{runningKind === "all" ? (isEnglish ? "Generating..." : "依次生成中…") : (isEnglish ? "Generate all" : "依次生成上 / 下 / 侧")}</button>
        {(["top", "bottom", "side"] as BackgroundKind[]).map((kind) => <button type="button" key={kind} onClick={() => void runGeneration(kind)} disabled={!projectReady || !reference || Boolean(runningKind)}>{runningKind === kind ? (isEnglish ? "Generating..." : "生成中…") : isEnglish ? `Generate ${kind}` : `生成${kind === "top" ? "上贴" : kind === "bottom" ? "下贴" : "侧贴"}`}</button>)}
        <p>{message || (!reference ? (isEnglish ? "Add a room or colour reference to enable OFOX generation." : "添加直播间或色彩参考图后即可启用 OFOX 生图。") : (isEnglish ? "Individual generation replaces that asset in the composition with the latest result." : "单项生成会把最新结果写入项目，并替换融合画板中的同类素材。"))}</p>
      </div>
      <AssetCollection language={language} assets={assets.filter((asset) => asset.kind === "reference")} empty={isEnglish ? "Add a reference image for later background work." : "添加一张参考图后，背景任务会从这里读取素材。"} />
      <BackgroundOutputPreview language={language} assets={assets} runningKind={runningKind} onRegenerate={runGeneration} />
    </ToolFrame>
  );
}

function TypographyTool({ language, assets, onAddAsset, projectReady, typography, onTypographyChange }: ToolProps & { language: "zh" | "en"; projectReady: boolean; typography: TypographySettings; onTypographyChange: (settings: Partial<TypographySettings>) => void }) {
  const topAsset = latestAsset(assets, "top");
  const projectReference = latestAsset(assets, "reference");
  const isRefineMode = typography.mode === "refine";
  const customColorReference = latestAsset(assets, "color-reference");
  const activeColorReference = customColorReference ?? (isRefineMode ? undefined : topAsset ?? projectReference);
  const isEnglish = language === "en";
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCuttingOut, setIsCuttingOut] = useState(false);
  const [generationMessage, setGenerationMessage] = useState("");
  const [cutoutMessage, setCutoutMessage] = useState("");

  const generateTypography = async () => {
    const layoutReference = latestAsset(assets, "layout-reference");
    const existingTypography = latestAsset(assets, "typography");
    if ((!typography.text.trim() && !layoutReference) || (isRefineMode && !existingTypography)) return;
    setIsGenerating(true);
    setGenerationMessage(isEnglish ? "OFOX is generating the first draft..." : "OFOX 正在生成首版文字图层…");
    try {
      const job = await createTypographyJob({
        text: typography.text,
        fontPresetKey: typography.fontPresetKey,
        mode: typography.mode,
        matte: typography.matte,
        instruction: typography.instruction || undefined,
        references: {
          color: activeColorReference ? await colorReference(activeColorReference) : undefined,
          font: isRefineMode ? undefined : await activeFontReference(typography.fontPresetKey, assets),
          layout: isRefineMode || !layoutReference ? undefined : await assetReference(layoutReference),
          typography: isRefineMode && existingTypography ? await assetReference(existingTypography) : undefined,
        },
      });
      if (job.status === "failed") throw new Error(job.error?.message || "Typography generation failed.");
      if (!job.result?.url) throw new Error(isEnglish ? "The job completed without an image." : "任务已完成，但没有返回图片。");
      await onAddAsset(await resultFile(job.result, `typography-draft-${job.id}.png`), "typography-draft");
      setCutoutMessage("");
      setGenerationMessage(isEnglish ? "Solid-matte draft generated. Cut it out from the output preview when needed." : "文字实底稿已生成；需要透明底时，请在产出预览中执行抠图。");
    } catch (error) {
      setGenerationMessage(error instanceof Error ? error.message : (isEnglish ? "Generation failed." : "生成失败。"));
    } finally {
      setIsGenerating(false);
    }
  };

  const runCutout = async () => {
    const draft = latestAsset(assets, "typography-draft");
    if (!draft) return;
    setIsCuttingOut(true);
    setCutoutMessage(isEnglish ? "Removing the solid matte..." : "正在抠除实底…");
    try {
      const payload = await cutoutTypography(await assetReference(draft));
      await onAddAsset(await resultFile(payload.result, `typography-${Date.now()}.png`), "typography");
      setCutoutMessage(isEnglish ? "Transparent PNG added to the project." : "透明 PNG 已加入当前项目与融合画板。");
    } catch (error) {
      setCutoutMessage(error instanceof Error ? error.message : (isEnglish ? "Cutout failed." : "文字抠图失败。"));
    } finally {
      setIsCuttingOut(false);
    }
  };

  return (
    <ToolFrame eyebrow="02 / TYPOGRAPHY LAYER" title={isEnglish ? "Typography" : "文字图层"} detail={isRefineMode ? (isEnglish ? "Reuse an existing layer's lettering, colour and texture. An optional colour reference overrides its visual treatment. Cutout is a separate output action." : "沿用已有文字图层的字形、颜色与纹理，可用新的色彩质感参考覆盖其视觉风格；透明抠图在产出预览中单独执行。") : (isEnglish ? "Use independently. The latest top sticker supplies colour, material and ornaments unless an optional colour reference overrides it." : "该工具可独立使用。默认继承项目上贴的色彩、材质与装饰，也可由用户上传色彩纹理参考覆盖。")}>
      <div className="typography-mode-switch" role="tablist" aria-label={isEnglish ? "Typography mode" : "文字图层模式"}>
        <button type="button" role="tab" aria-selected={!isRefineMode} className={!isRefineMode ? "selected" : ""} onClick={() => onTypographyChange({ mode: "create" })}>{isEnglish ? "Create new" : "新建文字图层"}</button>
        <button type="button" role="tab" aria-selected={isRefineMode} className={isRefineMode ? "selected" : ""} onClick={() => onTypographyChange({ mode: "refine" })}>{isEnglish ? "Refine existing" : "微调已有文字层"}</button>
      </div>
      {isRefineMode ? (
        <>
          <div className="tool-grid typography-refine-grid">
            <TypographyContentInput language={language} value={typography.text} onTextChange={(text) => onTypographyChange({ text })} disabled={!projectReady} />
            <AssetUpload language={language} kind="typography" label={isEnglish ? "Existing text layer" : "已有文字图层"} help={isEnglish ? "Upload transparent or solid text art to learn its lettering, font, colour and texture." : "上传透明或实底文字图；它会学习字形、字体、颜色与纹理。"} onAddAsset={onAddAsset} disabled={!projectReady} />
            <AssetUpload language={language} kind="color-reference" label={isEnglish ? "Colour/material override" : "颜色与质感覆盖参考"} help={isEnglish ? "Optional. When present it takes priority for colour, material and ornaments." : "非必填；上传后优先采用此图的颜色、材质与装饰。"} onAddAsset={onAddAsset} disabled={!projectReady} />
          </div>
          <div className="typography-matte-row">
            <div><strong>{isEnglish ? "Draft background" : "生成底稿"}</strong><small>{isEnglish ? "A solid matte makes the next automatic cutout reliable." : "输出为实底文字图，便于下一步自动抠图。"}</small></div>
            <div className="matte-switcher" role="radiogroup" aria-label={isEnglish ? "Draft background" : "生成底稿背景"}>
              <button type="button" role="radio" aria-checked={typography.matte === "white"} className={typography.matte === "white" ? "selected" : ""} onClick={() => onTypographyChange({ matte: "white" })}>{isEnglish ? "White matte" : "纯白底"}</button>
              <button type="button" role="radio" aria-checked={typography.matte === "black"} className={typography.matte === "black" ? "selected" : ""} onClick={() => onTypographyChange({ matte: "black" })}>{isEnglish ? "Black matte" : "纯黑底"}</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="tool-grid two typography-input-grid">
            <TypographyContentInput language={language} value={typography.text} onTextChange={(text) => onTypographyChange({ text })} onAddAsset={onAddAsset} disabled={!projectReady} allowLayoutReference />
            <AssetUpload language={language} kind="color-reference" label={isEnglish ? "Text colour/material reference" : "文字颜色与质感参考"} help={isEnglish ? "Overrides the top sticker. Otherwise the latest top sticker is inherited." : "上传后覆盖上贴；未上传时自动继承当前项目上贴。"} onAddAsset={onAddAsset} disabled={!projectReady} />
          </div>
          <TypographyInstructionInput language={language} value={typography.instruction} onChange={(instruction) => onTypographyChange({ instruction })} disabled={!projectReady} />
          <section className="font-preset-section" aria-label={isEnglish ? "Default generation fonts" : "默认生图字体"}>
            <div className="section-heading"><p>{isEnglish ? "Default generation fonts" : "默认生图字体"}</p><small>{isEnglish ? "These images only guide lettering and stroke rhythm; colour, material and ornaments continue to follow the active top-sticker or colour reference." : "这些参考图只约束字形与笔画节奏；色彩、材质与装饰仍以当前上贴或色彩纹理参考为准。"}</small></div>
            <div className="font-preset-grid">
              {fontPresets.map((preset) => preset.key === "custom-reference" ? (
                <CustomFontReferenceCard
                  key={preset.key}
                  language={language}
                  selected={typography.fontPresetKey === preset.key}
                  disabled={!projectReady}
                  onAddAsset={onAddAsset}
                  onActivate={() => onTypographyChange({ fontPresetKey: preset.key })}
                />
              ) : (
                <button className={typography.fontPresetKey === preset.key ? "font-preset-card selected" : "font-preset-card"} key={preset.key} onClick={() => onTypographyChange({ fontPresetKey: preset.key })}>
                  {preset.image ? <img src={preset.image} alt="" /> : <span className="custom-font-mark">Aa</span>}
                  <strong>{isEnglish ? preset.englishLabel : preset.label}</strong>
                  <small>{isEnglish ? preset.englishDetail : preset.detail}</small>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      <StatusCard
        title={isEnglish ? "Active colour source" : "当前色彩参考"}
        value={activeColorReference ? `${assetLabel(activeColorReference.kind, language)} · ${activeColorReference.fileName}` : (isEnglish ? "Not selected" : "尚未选择")}
        detail={isRefineMode ? (activeColorReference ? (isEnglish ? "The uploaded colour/material reference has priority." : "上传的颜色质感参考优先；未上传时沿用已有文字图层的颜色、纹理与字体。") : (isEnglish ? "Without an override, the existing text layer supplies lettering, colour and texture." : "未上传覆盖参考时，系统只沿用已有文字图层的字形、颜色和纹理。")) : (activeColorReference ? (isEnglish ? "This reference sets colour, material and ornaments. Glyph references do not override it." : "当前参考决定文字的颜色、质感与小装饰；字体字形参考不会覆盖它。") : (isEnglish ? "The latest top sticker is inherited when available; upload an override any time." : "尚未上传时会自动继承当前项目上贴；也可在右侧单独上传覆盖。"))}
      />
      <div className="generation-action-row">
        <button type="button" onClick={() => void generateTypography()} disabled={!projectReady || isGenerating || (!typography.text.trim() && !latestAsset(assets, "layout-reference")) || (isRefineMode && !latestAsset(assets, "typography"))}>
          {isGenerating ? (isEnglish ? "Generating..." : "正在生成…") : isRefineMode ? (isEnglish ? "Refine with OFOX" : "使用 OFOX 微调文字图层") : (isEnglish ? "Generate with OFOX" : "使用 OFOX 生成文字图层")}
        </button>
        <p>{generationMessage || (isRefineMode ? (isEnglish ? "Upload an existing typography layer, enter replacement text, then refine it." : "上传已有文字层并填写替换文本后即可微调。") : (isEnglish ? "The editable text above is generated as a solid-matte draft first." : "上方文本可直接复制或修改；生成后先得到实底文字稿。"))}</p>
      </div>
      <AssetCollection language={language} assets={assets.filter((asset) => isRefineMode ? asset.kind === "typography" : asset.kind === "layout-reference" || asset.kind === "font-reference")} empty={isRefineMode ? (isEnglish ? "Upload an existing text layer to refine it with new copy." : "上传一张已有文字图层后，可按新的文本内容微调。") : (isEnglish ? "Enter copy to generate, or upload layout and glyph references." : "输入文本即可生成；也可以上传布局文本图或字体参考。")} />
      <TypographyOutputPreview language={language} assets={assets} isCuttingOut={isCuttingOut} message={cutoutMessage} onCutout={runCutout} />
    </ToolFrame>
  );
}

function CompositionTool({
  language,
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
  language: "zh" | "en";
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
  const canvasLayers = composition.layers
    .map((layer) => ({ layer, asset: assets.find((asset) => asset.id === layer.assetId) }))
    .filter((item): item is { layer: CompositionLayer; asset: ProjectAsset } => Boolean(item.asset));
  const selectedLayer = canvasLayers.find((item) => item.layer.id === composition.selectedLayerId)?.layer ?? canvasLayers.at(-1)?.layer;

  const isEnglish = language === "en";
  return (
    <ToolFrame eyebrow="03 / COMPOSITION BOARD" title={isEnglish ? "Composition" : "效果融合"} detail={isEnglish ? "Input nodes inherit the latest upstream assets and remain magnetically attached to the output. Use the canvas for precise placement, scale and boundary fading." : "素材节点会自动继承前面工具的最新结果，也可在节点内替换。所有输入始终吸附到融合输出，画板继续用于精细位置、尺寸与遮罩调整。"}>
      <CompositionFlow language={language} assets={assets} composition={composition} onAddAsset={onAddAsset} onSelectLayer={onSelectLayer} projectReady={projectReady} />
      <div className="composition-workbench">
        <div className="composition-stage-wrap">
          <div className="composition-toolbar">
            <div className="canvas-mode-switch" aria-label={isEnglish ? "Canvas mode" : "画板模式"}>
              <button className={mode === "select" ? "selected" : ""} onClick={() => setMode("select")}>{isEnglish ? "Select" : "选择图层"}</button>
              <button className={mode === "mask" ? "selected" : ""} onClick={() => setMode("mask")}>{isEnglish ? "Fade draw" : "手绘渐隐"}</button>
            </div>
            <div className="history-controls">
              <button aria-label="撤销画板操作" title="撤销" disabled={!canUndo} onClick={onUndo}>↶</button>
              <button aria-label="恢复画板操作" title="恢复" disabled={!canRedo} onClick={onRedo}>↷</button>
            </div>
          </div>
          <CompositionCanvas language={language} layers={canvasLayers} selectedLayer={selectedLayer} mode={mode} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} />
          <p className="stage-note">{mode === "mask" ? (isEnglish ? "Fade draw: draw a boundary within top or bottom sticker. The top retains above the line, bottom retains below. Hold Shift for a straight horizontal line." : "手绘模式：在上贴或下贴区域画渐隐边界线。上贴保留线以上，下贴保留线以下；按住 Shift 可画水平直线。") : (isEnglish ? "The canvas previews a 1080 x 1920 output. Select any layer and use arrow keys to position it; hold Shift for larger steps. Only side stickers may be dragged." : "画板等比例预览 1080 × 1920 输出。选中任意图层后用方向键定位，按住 Shift 可加速；只有侧贴可鼠标拖动位置。")}</p>
        </div>
        <CompositionInspector language={language} layer={selectedLayer} asset={selectedLayer ? assets.find((asset) => asset.id === selectedLayer.assetId) : undefined} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} layers={canvasLayers} />
      </div>
    </ToolFrame>
  );
}

const compositionNodeTypes = { asset: FlowAssetNode, output: FlowOutputNode };
const compositionEdgeTypes = { octopus: OctopusEdge };

function CompositionFlow({ language, assets, composition, onAddAsset, onSelectLayer, projectReady }: { language: "zh" | "en"; assets: ProjectAsset[]; composition: CompositionDocument; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onSelectLayer: (layerId: string) => void; projectReady: boolean }) {
  const compactFlow = useMediaQuery("(max-width: 520px)");
  const flowPositions = compactFlow ? compactFlowNodePositions : desktopFlowNodePositions;
  const [nodes, setNodes, onNodesChange] = useNodesState([
    { id: "base-image", type: "asset", position: flowPositions["base-image"], data: { kind: "base-image", label: "直播间底图" } },
    { id: "top", type: "asset", position: flowPositions.top, data: { kind: "top", label: "上贴" } },
    { id: "side", type: "asset", position: flowPositions.side, data: { kind: "side", label: "侧贴" } },
    { id: "bottom", type: "asset", position: flowPositions.bottom, data: { kind: "bottom", label: "下贴" } },
    { id: "typography", type: "asset", position: flowPositions.typography, data: { kind: "typography", label: "文字图层" } },
    { id: "merge-output", type: "output", position: flowPositions["merge-output"], data: { label: "融合输出", detail: "拖入画板继续微调" } },
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([
    "base-image", "top", "side", "bottom", "typography",
  ].map((source) => ({ id: `${source}-merge`, source, sourceHandle: "output", target: "merge-output", targetHandle: "input", type: "octopus", animated: true })));

  const selectAsset = useCallback((assetId: string) => {
    const layer = composition.layers.find((item) => item.assetId === assetId);
    if (layer) onSelectLayer(layer.id);
  }, [composition.layers, onSelectLayer]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      if (node.id === "merge-output") return { ...node, data: { label: language === "en" ? "Merged output" : "融合输出", detail: language === "en" ? "Continue on canvas" : "拖入画板继续微调" } };
      const data = node.data as FlowAssetNodeData;
      const asset = [...assets].reverse().find((item) => item.kind === data.kind);
      return { ...node, data: { ...data, language, label: flowNodeLabel(data.kind, language), asset, disabled: !projectReady, onAddAsset, onSelectAsset: selectAsset } };
    }));
  }, [assets, language, onAddAsset, projectReady, selectAsset, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    if (connection.target !== "merge-output") return;
    setEdges((current) => addEdge({ ...connection, type: "octopus", animated: true }, current));
  }, [setEdges]);

  useEffect(() => {
    const positions = compactFlow ? compactFlowNodePositions : desktopFlowNodePositions;
    setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id as keyof typeof positions] ?? node.position })));
  }, [compactFlow, setNodes]);

  const onNodeDragStop = useCallback((_event: unknown, node: { id: string; position: { x: number; y: number } }) => {
    if (node.id === "merge-output") return;
    const position = { x: Math.min(770, Math.max(10, node.position.x)), y: Math.min(150, Math.max(14, node.position.y)) };
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, position, className: "flow-node-rebound" } : item));
    window.setTimeout(() => setNodes((current) => current.map((item) => item.id === node.id ? { ...item, className: "" } : item)), 360);
  }, [setNodes]);

  return (
    <div className="composition-flow-shell">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={compositionNodeTypes}
          edgeTypes={compositionEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          snapToGrid
          snapGrid={compactFlow ? [8, 8] : [16, 16]}
          nodesConnectable
          minZoom={0.7}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color="rgba(123, 248, 156, .1)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

const desktopFlowNodePositions = {
  "base-image": { x: 24, y: 38 },
  top: { x: 190, y: 38 },
  side: { x: 356, y: 38 },
  bottom: { x: 522, y: 38 },
  typography: { x: 688, y: 38 },
  "merge-output": { x: 354, y: 216 },
};

const compactFlowNodePositions = {
  "base-image": { x: 18, y: 20 },
  top: { x: 142, y: 20 },
  side: { x: 266, y: 20 },
  bottom: { x: 80, y: 142 },
  typography: { x: 204, y: 142 },
  "merge-output": { x: 94, y: 284 },
};

function FlowAssetNode({ data }: NodeProps) {
  const node = data as FlowAssetNodeData;
  const isEnglish = node.language === "en";
  const fileInput = useRef<HTMLInputElement>(null);
  const unavailableUpload = useCallback(async () => { throw new Error(isEnglish ? "This node cannot accept an upload." : "当前节点不可上传。"); }, [isEnglish]);
  const upload = useImagePasteUpload({ kind: node.kind, onAddAsset: node.onAddAsset ?? unavailableUpload, disabled: Boolean(node.disabled || !node.onAddAsset) });

  return (
    <div
      className={`flow-asset-node${upload.isPasteTarget ? " paste-ready" : ""}`}
      title={isEnglish ? "Hover and press Ctrl / Cmd + V to paste an image" : "悬停后可按 Ctrl / Cmd + V 粘贴图片"}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
      onClick={() => node.asset && node.onSelectAsset?.(node.asset.id)}
    >
      <span>{node.label}</span>
      {node.asset ? <img src={node.asset.previewUrl} alt="" /> : <small>{isEnglish ? "Inherit prior output" : "继承前序结果"}</small>}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={node.disabled} />
      <button className="nodrag nopan" type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }} disabled={node.disabled}>{upload.message || (isEnglish ? "Choose image" : "选择图片")}</button>
      <Handle className="flow-handle source" type="source" position={Position.Bottom} id="output" />
    </div>
  );
}

function FlowOutputNode({ data }: NodeProps) {
  const output = data as { label?: string; detail?: string };
  return (
    <div className="flow-output-node">
      <Handle className="flow-handle target" type="target" position={Position.Top} id="input" />
      <span>{output.label ?? "融合输出"}</span>
      <small>{output.detail ?? "拖入画板继续微调"}</small>
    </div>
  );
}

function flowNodeLabel(kind: CompositionInputKind, language: "zh" | "en") {
  if (language === "zh") return assetKindLabels[kind];
  return { "base-image": "Room background", top: "Top sticker", bottom: "Bottom sticker", side: "Side sticker", typography: "Typography" }[kind];
}

function OctopusEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.42 });
  return <BaseEdge path={path} style={{ stroke: "#7bf89c", strokeWidth: 1.5, strokeLinecap: "round", ...style }} />;
}

function CompositionCanvas({
  language,
  layers,
  selectedLayer,
  mode,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginInteraction,
  onEndInteraction,
}: {
  language: "zh" | "en";
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
    event.currentTarget.focus();
    onSelectLayer(layer.id);
    if (layer.kind !== "side") return;
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

  const onLayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, layer: CompositionLayer) => {
    if (mode !== "select") return;
    const step = event.shiftKey ? 5 : 1;
    const patch = event.key === "ArrowLeft" ? { x: layer.x - step }
      : event.key === "ArrowRight" ? { x: layer.x + step }
        : event.key === "ArrowUp" ? { y: layer.y - step }
          : event.key === "ArrowDown" ? { y: layer.y + step }
            : undefined;
    if (!patch) return;
    event.preventDefault();
    onSelectLayer(layer.id);
    onBeginInteraction();
    onUpdateLayer(layer.id, patch);
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
    <div className="composition-stage" ref={stageRef} aria-label={language === "en" ? "Composition canvas" : "融合画板"}>
      <span className="composition-output-size">{COMPOSITION_OUTPUT.width} × {COMPOSITION_OUTPUT.height}</span>
      {layers.length === 0 ? <p>{language === "en" ? "Import a room background or sticker asset to place it here." : "导入底图或贴片素材后，图层会出现在这里。"}</p> : layers.map(({ layer, asset }) => (
        <div
          className={`${layer.id === selectedLayer?.id ? "canvas-layer selected" : "canvas-layer"}${layer.kind === "side" ? " draggable-side" : " keyboard-positioned"}`}
          key={layer.id}
          onPointerDown={(event) => onPointerDown(event, layer)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={(event) => onLayerKeyDown(event, layer)}
          style={{
            left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: layer.opacity / 100,
            zIndex: layer.zIndex, visibility: layer.visible ? "visible" : "hidden", ...maskStyle(layer),
          }}
          title={`${language === "en" ? flowNodeLabel(layer.kind, "en") : assetKindLabels[layer.kind]} · ${asset.fileName} · ${language === "en" ? (layer.kind === "side" ? "drag or use arrow keys" : "use arrow keys to position") : (layer.kind === "side" ? "可拖动或使用方向键定位" : "使用方向键定位")}`}
          role="button"
          tabIndex={0}
          aria-label={`${language === "en" ? flowNodeLabel(layer.kind, "en") : assetKindLabels[layer.kind]} ${language === "en" ? "layer" : "图层"}`}
        >
          <img src={asset.previewUrl} alt={language === "en" ? flowNodeLabel(layer.kind, "en") : assetKindLabels[layer.kind]} draggable={false} />
          <span>{language === "en" ? flowNodeLabel(layer.kind, "en") : assetKindLabels[layer.kind]}</span>
          {layer.id === selectedLayer?.id && mode === "select" ? <i className="resize-handle" onPointerDown={(event) => onResizeDown(event, layer)} title={language === "en" ? "Drag to resize" : "拖动缩放"} /> : null}
        </div>
      ))}
      {mode === "mask" ? <div className="fade-drawing-overlay" title={language === "en" ? "Draw on a top or bottom sticker. Hold Shift for a horizontal line." : "在上贴或下贴区域画渐隐线，按住 Shift 可画水平直线"} onPointerDown={onFadeStart} onPointerMove={onFadeMove} onPointerUp={onFadeEnd} onPointerCancel={onFadeEnd}>{previewPath.length > 1 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={pointsToSvgPath(previewPath)} /></svg> : null}</div> : null}
    </div>
  );
}

function CompositionInspector({
  language,
  layer,
  asset,
  layers,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginInteraction,
  onEndInteraction,
}: {
  language: "zh" | "en";
  layer?: CompositionLayer;
  asset?: ProjectAsset;
  layers: Array<{ layer: CompositionLayer; asset: ProjectAsset }>;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
}) {
  const isEnglish = language === "en";
  return (
    <aside className="composition-inspector" aria-label={isEnglish ? "Layer properties" : "图层属性"}>
      <p>{isEnglish ? "LAYERS" : "图层"}</p>
      <div className="layer-list">
        {layers.length === 0 ? <span>{isEnglish ? "No layers" : "暂无图层"}</span> : layers.slice().sort((a, b) => b.layer.zIndex - a.layer.zIndex).map((item) => (
          <button className={item.layer.id === layer?.id ? "layer-row selected" : "layer-row"} key={item.layer.id} onClick={() => onSelectLayer(item.layer.id)}>
            <span>{assetLabel(item.layer.kind, language)}</span>
            <small>{item.asset.fileName}</small>
          </button>
        ))}
      </div>
      {layer && asset ? (
        <div className="layer-controls">
          <h3>{assetLabel(layer.kind, language)}</h3>
          <p className="keyboard-tip">{isEnglish ? "Select on canvas, then use arrow keys to position. Hold Shift for larger steps." : "在画板选中后用方向键定位，按住 Shift 可加速。"}</p>
          <LayerPositionReadout language={language} x={layer.x} y={layer.y} />
          <LayerRange label={isEnglish ? "Width" : "宽度"} value={layer.width} min={1} onChange={(width) => onUpdateLayer(layer.id, { width })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label={isEnglish ? "Height" : "高度"} value={layer.height} min={1} onChange={(height) => onUpdateLayer(layer.id, { height })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          <LayerRange label={isEnglish ? "Opacity" : "透明度"} value={layer.opacity} min={0} onChange={(opacity) => onUpdateLayer(layer.id, { opacity })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          {layer.kind !== "base-image" && layer.kind !== "typography" ? <LayerRange label={isEnglish ? "Default feather" : "默认羽化"} value={layer.mask.feather} max={48} onChange={(feather) => onUpdateLayerMask(layer.id, (mask) => ({ ...mask, feather }))} onBegin={onBeginInteraction} onEnd={onEndInteraction} /> : null}
          <label className="layer-visibility"><input type="checkbox" checked={layer.visible} onChange={(event) => { onBeginInteraction(); onUpdateLayer(layer.id, { visible: event.target.checked }); onEndInteraction(); }} /> {isEnglish ? "Show layer" : "显示图层"}</label>
          <button className="mask-reset" onClick={() => { onBeginInteraction(); onUpdateLayer(layer.id, { mask: { mode: "default", feather: layer.mask.feather, fadePath: [], edgeTexture: "none" } }); onEndInteraction(); }}>{isEnglish ? "Reset hand-drawn fade" : "重置手绘渐隐"}</button>
        </div>
      ) : <p className="empty-copy">{isEnglish ? "Select a layer to edit its local properties." : "选择一个图层后可调整它的本地状态。"}</p>}
    </aside>
  );
}

function LayerRange({ label, value, min = 0, max = 100, onChange, onBegin, onEnd }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void; onBegin: () => void; onEnd: () => void }) {
  return <label className="layer-range"><span>{label}<b>{Math.round(value)}%</b></span><input type="range" min={min} max={Math.max(min, max)} value={value} onPointerDown={onBegin} onPointerUp={onEnd} onBlur={onEnd} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function LayerPositionReadout({ language, x, y }: { language: "zh" | "en"; x: number; y: number }) {
  const isEnglish = language === "en";
  return <div className="layer-position-readout"><span>{isEnglish ? "Position (keyboard)" : "位置（键盘控制）"}</span><b>{Math.round((x / 100) * COMPOSITION_OUTPUT.width)} × {Math.round((y / 100) * COMPOSITION_OUTPUT.height)} px</b></div>;
}

function maskStyle(layer: CompositionLayer) {
  if (typeof document === "undefined") return {};
  if (layer.kind !== "top" && layer.kind !== "bottom") return {};
  const width = 480;
  const height = 480;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return {};

  const fallbackY = layer.kind === "top"
    ? layer.y + layer.height * 0.72
    : layer.y + layer.height * 0.28;
  const source = layer.mask.fadePath.length > 1 ? layer.mask.fadePath : defaultFadeLine(fallbackY, layer.x, layer.x + layer.width);
  const path = normalizeFadePath(source, layer);
  const localPoints = path.map((point) => ({
    x: ((point.x - layer.x) / layer.width) * width,
    y: ((point.y - layer.y) / layer.height) * height,
  }));
  const sorted = localPoints.sort((a, b) => a.x - b.x);
  const feather = Math.max(1, (height * layer.mask.feather) / 520);
  const alpha = context.createImageData(width, height);
  for (let x = 0; x < width; x += 1) {
    const boundary = boundaryYAt(sorted, x);
    for (let y = 0; y < height; y += 1) {
      const distance = layer.kind === "top" ? boundary - y : y - boundary;
      const opacity = smoothMaskAlpha(distance, feather);
      const index = (y * width + x) * 4;
      alpha.data[index] = 255;
      alpha.data[index + 1] = 255;
      alpha.data[index + 2] = 255;
      alpha.data[index + 3] = opacity;
    }
  }
  context.putImageData(alpha, 0, 0);
  const image = `url("${canvas.toDataURL("image/png")}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskMode: "alpha",
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
}

function boundaryYAt(points: Array<{ x: number; y: number }>, x: number) {
  if (points.length === 0) return 240;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (x >= start.x && x <= end.x) {
      const ratio = end.x === start.x ? 0 : (x - start.x) / (end.x - start.x);
      return start.y + (end.y - start.y) * ratio;
    }
  }
  return x < points[0].x ? points[0].y : points.at(-1)?.y ?? points[0].y;
}

function smoothMaskAlpha(distance: number, feather: number) {
  if (distance <= -feather) return 0;
  if (distance >= feather) return 255;
  const value = (distance + feather) / (feather * 2);
  const eased = value * value * (3 - 2 * value);
  return Math.round(eased * 255);
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

function ExportTool({ language, assets }: { language: "zh" | "en"; assets: ProjectAsset[] }) {
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const selectedAssets = useMemo(() => assets.filter((asset) => selectedAssetIds.has(asset.id)), [assets, selectedAssetIds]);
  const selectedCount = selectedAssets.length;
  const isEnglish = language === "en";
  const exportSelected = async () => {
    if (!selectedAssets.length) return;
    setIsExporting(true);
    setExportMessage(isEnglish ? "Packing selected assets..." : "正在打包已选资产…");
    try {
      const zip = await makeProjectZip(selectedAssets, language);
      downloadBlob(zip, `muyang-live-sticker-assets-${new Date().toISOString().slice(0, 10)}.zip`);
      setExportMessage(isEnglish ? "ZIP exported." : "ZIP 已导出。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : (isEnglish ? "Export failed." : "导出失败。"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ToolFrame eyebrow="04 / EXPORT ASSETS" title={isEnglish ? "Export assets" : "导出资产"} detail={isEnglish ? "Select project assets and export a local ZIP. Images are packed in the browser with a manifest file." : "选择项目资产后可直接导出本地 ZIP；图片会在浏览器内打包，并附带一份项目清单。"}>
      <div className="export-list">
        {assets.length === 0 ? <p className="empty-copy">{isEnglish ? "There are no project assets to export." : "还没有可导出的项目资产。"}</p> : assets.map((asset) => {
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
              <span>{assetLabel(asset.kind, language)}</span>
              <strong>{asset.fileName}</strong>
              <small>{formatBytes(asset.sizeBytes)}</small>
            </label>
          );
        })}
      </div>
      <div className="export-footer">
        <span>{isEnglish ? `${selectedCount} assets selected` : `${selectedCount} 个资产已选择`}</span>
        <button type="button" disabled={!assets.length || isExporting} onClick={() => setSelectedAssetIds(new Set(assets.map((asset) => asset.id)))}>{isEnglish ? "Select all" : "全选"}</button>
        <button type="button" disabled={!selectedCount || isExporting} onClick={() => setSelectedAssetIds(new Set())}>{isEnglish ? "Clear" : "清空"}</button>
        <button type="button" disabled={!selectedCount || isExporting} onClick={() => void exportSelected()}>{isExporting ? (isEnglish ? "Exporting..." : "正在导出…") : (isEnglish ? "Export ZIP" : "导出 ZIP")}</button>
        <label className="advanced-option"><input type="checkbox" disabled /> {isEnglish ? "Project configuration JSON (advanced later)" : "项目配置 JSON（后期高级功能）"}</label>
        <small className="export-message">{exportMessage || (isEnglish ? "The manifest records asset kind, file name and size." : "清单会记录素材类型、文件名与大小。")}</small>
      </div>
    </ToolFrame>
  );
}

type ToolProps = { assets: ProjectAsset[]; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset> };

function ToolFrame({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail: string; children: React.ReactNode }) {
  return <div className="tool-panel"><p className="panel-eyebrow">{eyebrow}</p><h2>{title}</h2><p className="panel-detail">{detail}</p>{children}</div>;
}

function useImagePasteUpload({ kind, onAddAsset, disabled, onActivate }: { kind: ProjectAssetKind; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; disabled: boolean; onActivate?: () => void }) {
  const [message, setMessage] = useState("");
  const [isPasteTarget, setIsPasteTarget] = useState(false);

  const addFile = useCallback(async (file: File) => {
    if (disabled) return;
    onActivate?.();
    try {
      const asset = await onAddAsset(file, kind);
      setMessage(asset.trimmed ? `已预剪裁：${file.name}` : `已添加：${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法添加该素材。");
    }
  }, [disabled, kind, onActivate, onAddAsset]);

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await addFile(file);
    event.target.value = "";
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!isPasteTarget || disabled) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void addFile(file);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile, disabled, isPasteTarget]);

  return {
    message,
    onChange,
    onPointerEnter: () => setIsPasteTarget(true),
    onPointerLeave: () => setIsPasteTarget(false),
    isPasteTarget,
  };
}

function AssetUpload({ language, kind, label, help, onAddAsset, compact = false, disabled = false }: { language: "zh" | "en"; kind: ProjectAssetKind; label: string; help: string; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; compact?: boolean; disabled?: boolean }) {
  const upload = useImagePasteUpload({ kind, onAddAsset, disabled });

  return (
    <label
      className={`${compact ? "asset-upload compact" : "asset-upload"}${disabled ? " disabled" : ""}${upload.isPasteTarget ? " paste-ready" : ""}`}
      title={language === "en" ? "Hover and press Ctrl / Cmd + V to paste an image" : "悬停后可按 Ctrl / Cmd + V 粘贴图片"}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
    >
      <span>{label}</span>
      <small>{help}</small>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={disabled} />
      <strong>{upload.message || (disabled ? (language === "en" ? "Restoring project" : "正在恢复项目") : (language === "en" ? "Choose image" : "选择图片"))}</strong>
    </label>
  );
}

function TypographyContentInput({ language, value, onTextChange, onAddAsset, disabled, allowLayoutReference = false }: { language: "zh" | "en"; value: string; onTextChange: (text: string) => void; onAddAsset?: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; disabled: boolean; allowLayoutReference?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const unavailableUpload = useCallback(async () => { throw new Error("当前输入框不接收图片。 "); }, []);
  const upload = useImagePasteUpload({ kind: "layout-reference", onAddAsset: onAddAsset ?? unavailableUpload, disabled: disabled || !allowLayoutReference });

  return (
    <section
      className={`typography-content-input${disabled ? " disabled" : ""}${allowLayoutReference && upload.isPasteTarget ? " paste-ready" : ""}`}
      title={allowLayoutReference ? (language === "en" ? "Hover and press Ctrl / Cmd + V to paste a layout reference" : "悬停后可按 Ctrl / Cmd + V 粘贴带布局的文本图片") : (language === "en" ? "Enter or paste multiline text" : "可直接输入或粘贴多行文本")}
      onPointerEnter={allowLayoutReference ? upload.onPointerEnter : undefined}
      onPointerLeave={allowLayoutReference ? upload.onPointerLeave : undefined}
    >
      <label htmlFor="typography-text">{language === "en" ? "Text content" : "文本内容"}</label>
      <textarea
        id="typography-text"
        value={value}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={language === "en" ? "For example:\nNOBOOK · 618 Festival\nA new journey begins" : '例如：\n“NOBOOK · 618 狂欢季\n重走真理诞生路”'}
        disabled={disabled}
      />
      {allowLayoutReference ? <>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={disabled} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>{upload.message || (language === "en" ? "Choose layout text image" : "选择带布局文本图片")}</button>
      </> : <small className="text-input-hint">{language === "en" ? "Multiline text is supported." : "支持换行；可直接粘贴多行文本。"}</small>}
    </section>
  );
}

function TypographyInstructionInput({ language, value, onChange, disabled }: { language: "zh" | "en"; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className={`typography-instruction${disabled ? " disabled" : ""}`}>
      <span>{language === "en" ? "Custom direction" : "定制化要求"} <em>{language === "en" ? "Optional" : "非必填"}</em></span>
      <textarea value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={language === "en" ? "For example: emphasise 618 with a distinct colour; keep the subtitle smaller and restrained." : "例如：突出“618”并使用另一种强调色；副标题更小、更克制。"} />
    </label>
  );
}

function CustomFontReferenceCard({ language, selected, disabled, onAddAsset, onActivate }: { language: "zh" | "en"; selected: boolean; disabled: boolean; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onActivate: () => void }) {
  const upload = useImagePasteUpload({ kind: "font-reference", onAddAsset, disabled, onActivate });

  return (
    <label
      className={`font-preset-card custom-font-preset${selected ? " selected" : ""}${disabled ? " disabled" : ""}${upload.isPasteTarget ? " paste-ready" : ""}`}
      title={language === "en" ? "Select a glyph reference or hover and press Ctrl / Cmd + V" : "点击选择字体参考，或悬停后按 Ctrl / Cmd + V 粘贴图片"}
      onClick={onActivate}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
    >
      <span className="custom-font-mark">Aa</span>
      <strong>{language === "en" ? "Custom glyph reference" : "自定义字体字形"}</strong>
      <small>{upload.message || (language === "en" ? "Use a desaturated font image to learn glyphs and strokes." : "建议上传去色字体图，只学习字形与笔画")}</small>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={disabled} />
    </label>
  );
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="status-card"><span>{title}</span><h3>{value}</h3><p>{detail}</p></article>;
}

function AssetCollection({ language, assets, empty }: { language: "zh" | "en"; assets: ProjectAsset[]; empty: string }) {
  return assets.length === 0 ? <p className="empty-copy">{empty}</p> : <div className="asset-collection">{assets.map((asset) => <img key={asset.id} src={asset.previewUrl} alt={asset.fileName} title={`${assetLabel(asset.kind, language)} · ${asset.fileName}`} />)}</div>;
}

function BackgroundOutputPreview({ language, assets, runningKind, onRegenerate }: { language: "zh" | "en"; assets: ProjectAsset[]; runningKind: BackgroundKind | "all" | ""; onRegenerate: (kind: BackgroundKind | "all") => Promise<void> }) {
  const isEnglish = language === "en";
  return (
    <section className="tool-output-preview background-output-preview" aria-label={isEnglish ? "Background output preview" : "背景产出预览"}>
      <div className="output-preview-heading"><div><p>OUTPUT</p><h3>{isEnglish ? "Sticker output · 1080 × 1920" : "贴片输出 · 1080 × 1920"}</h3></div></div>
      <div className="background-output-stage">
        <span className="background-output-size">1080 × 1920</span>
        {(["top", "side", "bottom"] as BackgroundKind[]).map((kind) => {
          const asset = latestAsset(assets, kind);
          const label = assetLabel(kind, language);
          return (
            <article className={`background-output-slot ${kind}`} key={kind}>
              <span>{label}</span>
              {asset ? <img src={asset.previewUrl} alt={asset.fileName} /> : <small>{isEnglish ? "Waiting for output" : "等待产出"}</small>}
              <button type="button" onClick={() => void onRegenerate(kind)} disabled={Boolean(runningKind)}>{runningKind === kind || runningKind === "all" ? (isEnglish ? "Generating..." : "生成中…") : asset ? (isEnglish ? "Regenerate" : "重生") : (isEnglish ? "Generate" : "生成")}</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TypographyOutputPreview({ language, assets, isCuttingOut, message, onCutout }: { language: "zh" | "en"; assets: ProjectAsset[]; isCuttingOut: boolean; message: string; onCutout: () => Promise<void> }) {
  const isEnglish = language === "en";
  const draft = latestAsset(assets, "typography-draft");
  const transparent = latestAsset(assets, "typography");
  const currentTransparent = transparent && (!draft || Date.parse(transparent.createdAt) >= Date.parse(draft.createdAt)) ? transparent : undefined;
  return (
    <section className="tool-output-preview" aria-label={isEnglish ? "Typography output preview" : "文字图层产出预览"}>
      <div className="output-preview-heading"><div><p>OUTPUT PREVIEW</p><h3>{isEnglish ? "Typography output" : "文字图层产出预览"}</h3></div></div>
      <div className="typography-output-grid">
        <article className="tool-output-card typography-draft">
          <span>{isEnglish ? "Solid-matte draft" : "文字实底稿"}</span>
          <div className="tool-output-surface">{draft ? <img src={draft.previewUrl} alt={draft.fileName} /> : <small>{isEnglish ? "Generate a draft first" : "请先生成文字实底稿"}</small>}</div>
          <button className="output-action" type="button" disabled={!draft || isCuttingOut} onClick={() => void onCutout()}>{isCuttingOut ? (isEnglish ? "Cutting out..." : "正在抠图…") : (isEnglish ? "Remove matte" : "抠出透明底")}</button>
        </article>
        <article className="tool-output-card typography">
          <span>{isEnglish ? "Transparent PNG" : "透明文字图层"}</span>
          <div className="tool-output-surface">{currentTransparent ? <img src={currentTransparent.previewUrl} alt={currentTransparent.fileName} /> : <small>{isEnglish ? "No transparent output for this draft" : "当前实底稿尚未执行透明抠图"}</small>}</div>
          <small>{message || (currentTransparent ? currentTransparent.fileName : (isEnglish ? "Optional output" : "可选产出"))}</small>
        </article>
      </div>
    </section>
  );
}

function assetLabel(kind: ProjectAssetKind, language: "zh" | "en") {
  if (language === "zh") return assetKindLabels[kind];
  return {
    reference: "Colour/material reference",
    "color-reference": "Typography colour/material reference",
    "font-reference": "Glyph reference",
    "layout-reference": "Layout text reference",
    top: "Top sticker",
    bottom: "Bottom sticker",
    side: "Side sticker",
    "typography-draft": "Typography draft",
    typography: "Typography",
    "base-image": "Room background",
  }[kind];
}

async function makeProjectZip(assets: ProjectAsset[], language: "zh" | "en") {
  const usedNames = new Map<string, number>();
  const files = await Promise.all(assets.map(async (asset, index) => ({
    name: uniqueZipName(`${String(index + 1).padStart(2, "0")}-${assetLabel(asset.kind, language)}-${asset.fileName || asset.kind}.${extensionForAsset(asset)}`, usedNames),
    bytes: new Uint8Array(await asset.blob.arrayBuffer()),
  })));
  const manifest = {
    exportedAt: new Date().toISOString(),
    outputSize: COMPOSITION_OUTPUT,
    assets: assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      label: assetLabel(asset.kind, language),
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      trimmed: asset.trimmed,
      createdAt: asset.createdAt,
    })),
  };
  files.push({ name: "project-manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return new Blob([createStoredZip(files)], { type: "application/zip" });
}

function uniqueZipName(name: string, usedNames: Map<string, number>) {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "asset";
  const count = usedNames.get(cleaned) ?? 0;
  usedNames.set(cleaned, count + 1);
  if (count === 0) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  return dot > 0 ? `${cleaned.slice(0, dot)}-${count + 1}${cleaned.slice(dot)}` : `${cleaned}-${count + 1}`;
}

function extensionForAsset(asset: ProjectAsset) {
  const fileExtension = asset.fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fileExtension) return fileExtension;
  if (asset.mimeType.includes("jpeg")) return "jpg";
  if (asset.mimeType.includes("png")) return "png";
  if (asset.mimeType.includes("webp")) return "webp";
  return "bin";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createStoredZip(files: Array<{ name: string; bytes: Uint8Array }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((Math.floor(now.getSeconds() / 2)) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, file.bytes);

    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, file.bytes.length, true);
    view.setUint32(24, file.bytes.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    offset += local.length + file.bytes.length;
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatBytes([...chunks, ...central, end]);
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function latestAsset(assets: ProjectAsset[], kind: ProjectAssetKind) {
  return [...assets].reverse().find((asset) => asset.kind === kind);
}

async function resultFile(result: { url: string; fileName?: string; mimeType?: string }, fallbackName: string) {
  const response = await fetch(result.url);
  const blob = await response.blob();
  return new File([blob], result.fileName || fallbackName, { type: result.mimeType || blob.type || "image/png" });
}

async function assetReference(asset: ProjectAsset): Promise<ImageReferenceInput> {
  const preserveAlpha = asset.kind === "typography" || asset.kind === "typography-draft";
  const blob = await resizeReference(asset.blob, preserveAlpha);
  return { assetId: asset.id, mimeType: blob.type, dataUrl: await blobToDataUrl(blob) };
}

async function colorReference(asset: ProjectAsset): Promise<ImageReferenceInput> {
  const blob = await resizeReference(asset.blob, false, "image/png");
  return { assetId: asset.id, mimeType: blob.type, dataUrl: await blobToDataUrl(blob) };
}

async function activeFontReference(fontPresetKey: TypographyPresetKey, assets: ProjectAsset[]): Promise<ImageReferenceInput | undefined> {
  if (fontPresetKey === "custom-reference") {
    const custom = latestAsset(assets, "font-reference");
    return custom ? desaturatedFontReference(custom.blob, custom.id) : undefined;
  }
  const preset = fontPresets.find((item) => item.key === fontPresetKey);
  if (!preset?.image) return undefined;
  const response = await fetch(preset.image);
  if (!response.ok) throw new Error("无法读取默认字体参考图。");
  const blob = await desaturateReference(await response.blob());
  return { mimeType: blob.type, dataUrl: await blobToDataUrl(blob) };
}

async function desaturatedFontReference(blob: Blob, assetId?: string): Promise<ImageReferenceInput> {
  const desaturated = await desaturateReference(blob);
  return { assetId, mimeType: desaturated.type, dataUrl: await blobToDataUrl(desaturated) };
}

async function desaturateReference(source: Blob): Promise<Blob> {
  const url = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取字体参考图片。"));
      element.src = url;
    });
    const maxDimension = 1536;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法处理字体参考图片。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const luminance = Math.round(0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] + 0.0722 * pixels.data[index + 2]);
      pixels.data[index] = luminance;
      pixels.data[index + 1] = luminance;
      pixels.data[index + 2] = luminance;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("字体参考去色失败。")), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function resizeReference(source: Blob, preserveAlpha: boolean, outputMimeType?: "image/jpeg" | "image/png"): Promise<Blob> {
  const url = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取参考图片。"));
      element.src = url;
    });
    const maxDimension = 1536;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理参考图片。");
    if (!preserveAlpha) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mimeType = outputMimeType ?? (preserveAlpha ? "image/png" : "image/jpeg");
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("参考图片压缩失败。")), mimeType, 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("参考图片编码失败。"));
    reader.readAsDataURL(blob);
  });
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

function persistenceCopyEn(state: PersistenceState) {
  if (state === "loading") return "Restoring local project.";
  if (state === "saving") return "Saving in this browser.";
  if (state === "error") return "Local persistence is unavailable; this session remains editable.";
  return "Saved in this browser and ready after refresh.";
}
