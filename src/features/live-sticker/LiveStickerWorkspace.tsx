import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { createBackgroundJob, createTypographyJob, cutoutTypography, fetchBackgroundJob, fetchCoreHealth, fetchTypographyJob, getCoreBaseUrl, type BackgroundGenerationJob, type BackgroundKind, type CoreHealth, type ImageReferenceInput, type TypographyGenerationJob } from "../../lib/core-api";
import {
  assetKindLabels,
  COMPOSITION_OUTPUT,
  type CompositionDocument,
  type CompositionLayer,
  type PersistenceState,
  type ProjectAsset,
  type ProjectAssetKind,
  type SideStickerSettings,
  type TypographyPresetKey,
  type TypographySettings,
  useProjectWorkspace,
} from "./project-state";
import "./live-sticker.css";

type ToolId = "background" | "typography" | "side-editor" | "composition" | "exports";
type HealthState = "checking" | "online" | "offline";
type CompositionInputKind = "base-image" | "top" | "bottom" | "side" | "typography";
const PROJECT_ASSET_DRAG_TYPE = "application/x-muyang-project-asset";
type FlowAssetNodeData = {
  kind: CompositionInputKind;
  label: string;
  language?: "zh" | "en";
  assets?: ProjectAsset[];
  asset?: ProjectAsset;
  disabled?: boolean;
  onAddAsset?: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onReuseAsset?: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onSelectAsset?: (assetId: string) => void;
};

const tools: Array<{ id: ToolId; step: string; label: string; caption: string; englishLabel: string; englishCaption: string }> = [
  { id: "background", step: "01", label: "背景生成", caption: "上贴 / 下贴", englishLabel: "Background", englishCaption: "Top / Bottom" },
  { id: "typography", step: "02", label: "文字图层", caption: "透明文字素材", englishLabel: "Typography", englishCaption: "Transparent text" },
  { id: "side-editor", step: "03", label: "侧贴编辑", caption: "平铺 / 达人空降", englishLabel: "Side sticker", englishCaption: "Flat / Talent" },
  { id: "composition", step: "04", label: "效果融合", caption: "画板与遮罩", englishLabel: "Composition", englishCaption: "Canvas & mask" },
  { id: "exports", step: "05", label: "导出资产", caption: "选择与打包", englishLabel: "Exports", englishCaption: "Select & package" },
];

const publicAssetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

const sleep = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

async function waitForJob<T extends TypographyGenerationJob | BackgroundGenerationJob>(
  initialJob: T,
  fetchJob: (id: string) => Promise<T>,
  onUpdate?: (job: T, attempt: number) => void,
) {
  let job = initialJob;
  let transientFailures = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    onUpdate?.(job, attempt);
    if (job.status === "completed" || job.status === "failed") return job;
    await sleep(attempt < 8 ? 1200 : 1800);
    try {
      job = await fetchJob(job.id);
      transientFailures = 0;
    } catch (error) {
      transientFailures += 1;
      if (transientFailures >= 6) throw error;
    }
  }
  throw new Error("生成任务仍在处理中，请稍后刷新项目资产。");
}

const fontPresets: Array<{ key: TypographyPresetKey; label: string; detail: string; englishLabel: string; englishDetail: string; image?: string }> = [
  { key: "elegant-songti", label: "优雅宋体", detail: "明宋结构、细粗对比、克制的印刷感", englishLabel: "Elegant Songti", englishDetail: "Ming-style structure, measured contrast and print restraint", image: publicAssetUrl("font-presets/elegant-songti.png") },
  { key: "expressive-calligraphy", label: "表现书法", detail: "笔势、压感变化与有方向的笔画", englishLabel: "Expressive calligraphy", englishDetail: "Directional strokes with pressure variation", image: publicAssetUrl("font-presets/expressive-calligraphy.png") },
  { key: "rounded-cute", label: "圆润可爱", detail: "饱满圆角、轻松易读的贴纸字形", englishLabel: "Rounded playful", englishDetail: "Full rounded corners and easy sticker lettering", image: publicAssetUrl("font-presets/rounded-cute.png") },
  { key: "custom-reference", label: "自定义字体字形", detail: "上传去色字体图，只学习字形、笔画与局部纹理", englishLabel: "Custom glyph reference", englishDetail: "Upload a desaturated reference for glyphs and strokes" },
];

export function LiveStickerWorkspace({
  language,
  onLanguageChange,
  onOpenHome,
}: {
  language: "zh" | "en";
  onLanguageChange: (language: "zh" | "en") => void;
  onOpenHome?: () => void;
}) {
  const [activeTool, setActiveTool] = useState<ToolId>("background");
  const {
    assets,
    composition,
    typography,
    sideSticker,
    persistenceState,
    projectReady,
    canUndo,
    canRedo,
    addAsset,
    removeAsset,
    reuseAsset,
    clearAssets,
    selectLayer,
    updateLayer,
    updateLayerMask,
    beginCompositionInteraction,
    endCompositionInteraction,
    undoComposition,
    redoComposition,
    setTypography,
    updateSideSticker,
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
          {onOpenHome ? (
            <button className="health-refresh" type="button" onClick={onOpenHome}>
              {isEnglish ? "Toolkit" : "工具主页"}
            </button>
          ) : null}
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
          <AssetRail language={language} assets={assets} onRemove={removeAsset} onClear={clearAssets} persistenceState={persistenceState} />
          <ToolPanel
            activeTool={activeTool}
            assets={assets}
            composition={composition}
            typography={typography}
            projectReady={projectReady}
            canUndo={canUndo}
            canRedo={canRedo}
            onAddAsset={addAsset}
            onReuseAsset={reuseAsset}
            onSelectLayer={selectLayer}
            onUpdateLayer={updateLayer}
            onUpdateLayerMask={updateLayerMask}
            onBeginCompositionInteraction={beginCompositionInteraction}
            onEndCompositionInteraction={endCompositionInteraction}
            onUndo={undoComposition}
            onRedo={redoComposition}
            onTypographyChange={(patch) => setTypography((current) => ({ ...current, ...patch }))}
            sideSticker={sideSticker}
            onSideStickerChange={updateSideSticker}
            onOpenComposition={() => setActiveTool("composition")}
            health={health}
            language={language}
          />
        </section>
      </div>
    </main>
  );
}

function AssetRail({ language, assets, onRemove, onClear, persistenceState }: { language: "zh" | "en"; assets: ProjectAsset[]; onRemove: (assetId: string) => void; onClear: () => void; persistenceState: PersistenceState }) {
  const isEnglish = language === "en";
  const [expandedGroups, setExpandedGroups] = useState<Partial<Record<AssetCategory, boolean>>>({});
  const totalSize = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);
  const groups = assetCategoryOrder
    .map((category) => ({ category, assets: assets.filter((asset) => assetCategoryFor(asset.kind) === category).slice().reverse() }))
    .filter((group) => group.assets.length > 0);
  const clearAll = () => {
    if (!window.confirm(isEnglish ? `Clear all ${assets.length} cached assets? This cannot be undone.` : `确定清空全部 ${assets.length} 个缓存素材吗？此操作不可撤销。`)) return;
    onClear();
  };
  return (
    <section className="asset-rail" aria-label={isEnglish ? "Current project assets" : "当前项目资产"}>
      <div>
        <p>{isEnglish ? "CURRENT PROJECT ASSETS" : "当前项目资产"}</p>
        <small>{isEnglish ? persistenceCopyEn(persistenceState) : persistenceCopy(persistenceState)}{assets.length ? ` · ${formatBytes(totalSize)}` : ""}</small>
        {assets.length ? <button className="asset-clear-all" type="button" onClick={clearAll}>{isEnglish ? "Clear cache" : "清空缓存"}</button> : null}
      </div>
      {assets.length === 0 ? (
        <span className="asset-empty">{isEnglish ? "No assets uploaded yet" : "还没有上传素材"}</span>
      ) : (
        <div className="asset-groups">
          {groups.map((group) => {
            const expanded = Boolean(expandedGroups[group.category]);
            const visibleAssets = expanded ? group.assets : group.assets.slice(0, 3);
            const hiddenCount = group.assets.length - 3;
            return <section className="asset-group" key={group.category}>
              <div className="asset-group-heading">
                <strong>{assetCategoryLabel(group.category, language)}</strong>
                <span>{group.assets.length}</span>
              </div>
              <div className="asset-chips">
                {visibleAssets.map((asset) => (
                  <div
                    className="asset-chip"
                    key={asset.id}
                    draggable
                    title={`${assetLabel(asset.kind, language)} · ${asset.fileName} · ${isEnglish ? "Drag to any image input" : "可拖到任意图片输入框"}`}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(PROJECT_ASSET_DRAG_TYPE, asset.id);
                      event.dataTransfer.setData("text/plain", asset.id);
                    }}
                  >
                    <img alt="" src={asset.previewUrl} />
                    <span>{assetLabel(asset.kind, language)} · {asset.fileName}</span>
                    {asset.trimmed ? <em>{isEnglish ? "trimmed" : "已预剪裁"}</em> : null}
                    <button draggable={false} aria-label={isEnglish ? `Remove ${asset.fileName}` : `移除 ${asset.fileName}`} onClick={() => onRemove(asset.id)}>×</button>
                  </div>
                ))}
                {hiddenCount > 0 ? <button className="asset-group-more" type="button" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => ({ ...current, [group.category]: !expanded }))}>{expanded ? (isEnglish ? "Collapse" : "收起") : (isEnglish ? `… ${hiddenCount} more` : `… 还有 ${hiddenCount} 个`)}</button> : null}
              </div>
            </section>;
          })}
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
  sideSticker,
  projectReady,
  canUndo,
  canRedo,
  onAddAsset,
  onReuseAsset,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginCompositionInteraction,
  onEndCompositionInteraction,
  onUndo,
  onRedo,
  onTypographyChange,
  onSideStickerChange,
  onOpenComposition,
  health,
  language,
}: {
  activeTool: ToolId;
  assets: ProjectAsset[];
  composition: CompositionDocument;
  typography: TypographySettings;
  sideSticker: SideStickerSettings;
  projectReady: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, patch: Partial<Pick<CompositionLayer, "x" | "y" | "width" | "height" | "opacity" | "visible" | "mask">>) => void;
  onUpdateLayerMask: (layerId: string, update: (mask: CompositionLayer["mask"]) => CompositionLayer["mask"]) => void;
  onBeginCompositionInteraction: () => void;
  onEndCompositionInteraction: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onTypographyChange: (settings: Partial<TypographySettings>) => void;
  onSideStickerChange: (settings: Partial<SideStickerSettings>) => void;
  onOpenComposition: () => void;
  health: CoreHealth | null;
  language: "zh" | "en";
}) {
  if (activeTool === "background") {
    return <BackgroundTool language={language} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} health={health} projectReady={projectReady} />;
  }
  if (activeTool === "typography") {
    return <TypographyTool language={language} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} projectReady={projectReady} typography={typography} onTypographyChange={onTypographyChange} />;
  }
  if (activeTool === "side-editor") {
    return <SideStickerTool language={language} assets={assets} settings={sideSticker} onSettingsChange={onSideStickerChange} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} onComplete={onOpenComposition} projectReady={projectReady} />;
  }
  if (activeTool === "composition") {
    return <CompositionTool language={language} assets={assets} composition={composition} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginCompositionInteraction={onBeginCompositionInteraction} onEndCompositionInteraction={onEndCompositionInteraction} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} projectReady={projectReady} />;
  }
  return <ExportTool language={language} assets={assets} composition={composition} />;
}

function BackgroundTool({ language, assets, onAddAsset, onReuseAsset, health, projectReady }: ToolProps & { language: "zh" | "en"; health: CoreHealth | null; projectReady: boolean }) {
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
    const initialJob = await createBackgroundJob({ kind, prompt: prompt || undefined, reference: reference ? await assetReference(reference) : undefined });
    const job = await waitForJob(initialJob, fetchBackgroundJob, (_job, attempt) => {
      if (attempt > 0 && attempt % 8 === 0) safeSetMessage(isEnglish ? "Still generating, keeping the connection light..." : "仍在生成中，已切换为轻量轮询等待…");
    });
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
        safeSetMessage(isEnglish ? "Generating top sticker first..." : "正在优先生成上贴…");
        await generateOne("top");
        safeSetMessage(isEnglish ? "Top sticker is ready. The bottom sticker continues in the background." : "上贴已完成；下贴继续在后台生成。");
        void (async () => {
          try {
            safeSetMessage(isEnglish ? "Generating the bottom sticker in the background..." : "后台继续生成下贴…");
            await generateOne("bottom");
          } catch (error) {
            console.warn("Background bottom generation failed", error);
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
    <ToolFrame eyebrow="01 / BACKGROUND ASSETS" title={isEnglish ? "Background assets" : "背景生成"} detail={isEnglish ? "Generate top and bottom stickers independently or run them in sequence. The latest reference supplies palette, material and texture; side backgrounds are generated in Step 3." : "上贴与下贴既可独立生成，也可按固定顺序依次生成；最新参考图提供色彩、材质与纹理，侧贴背景统一在第 3 步生成。"}>
      <div className="tool-grid two">
        <AssetUpload language={language} kind="reference" label={isEnglish ? "Room / colour reference" : "添加直播间 / 色彩参考图"} help={isEnglish ? "Reuse it in later background and typography work." : "上传后可在后续背景生成与文字图层中复用。"} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} disabled={!projectReady} />
        <StatusCard title={isEnglish ? "Core service" : "Core 服务"} value={health?.providers.imageGeneration === "ready" ? (isEnglish ? "OFOX ready" : "OFOX 已就绪") : (isEnglish ? "Waiting for Core" : "等待 Core")} detail={health?.providers.imageGeneration === "ready" ? (isEnglish ? "Top and bottom sticker generation is available." : "上贴、下贴生成均可用。") : (isEnglish ? "Check the server OFOX configuration." : "请检查服务器 OFOX 配置。")} />
      </div>
      <TypographyInstructionInput language={language} value={prompt} onChange={setPrompt} disabled={!projectReady || Boolean(runningKind)} />
      <div className="generation-action-row background-generation-actions">
        <button type="button" onClick={() => void runGeneration("all")} disabled={!projectReady || !reference || Boolean(runningKind)}>{runningKind === "all" ? (isEnglish ? "Generating..." : "依次生成中…") : (isEnglish ? "Generate both" : "依次生成上 / 下")}</button>
        {(["top", "bottom"] as BackgroundKind[]).map((kind) => <button type="button" key={kind} onClick={() => void runGeneration(kind)} disabled={!projectReady || !reference || Boolean(runningKind)}>{runningKind === kind ? (isEnglish ? "Generating..." : "生成中…") : isEnglish ? `Generate ${kind}` : `生成${kind === "top" ? "上贴" : "下贴"}`}</button>)}
        <p>{message || (!reference ? (isEnglish ? "Add a room or colour reference to enable OFOX generation." : "添加直播间或色彩参考图后即可启用 OFOX 生图。") : (isEnglish ? "Individual generation replaces that asset in the composition with the latest result." : "单项生成会把最新结果写入项目，并替换融合画板中的同类素材。"))}</p>
      </div>
      <BackgroundOutputPreview language={language} assets={assets} runningKind={runningKind} onRegenerate={runGeneration} />
    </ToolFrame>
  );
}

function TypographyTool({ language, assets, onAddAsset, onReuseAsset, projectReady, typography, onTypographyChange }: ToolProps & { language: "zh" | "en"; projectReady: boolean; typography: TypographySettings; onTypographyChange: (settings: Partial<TypographySettings>) => void }) {
  const topAsset = latestAsset(assets, "top");
  const isRefineMode = typography.mode === "refine";
  const customColorReference = latestAsset(assets, "color-reference");
  const activeColorReference = customColorReference ?? topAsset;
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
      const initialJob = await createTypographyJob({
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
      const job = await waitForJob(initialJob, fetchTypographyJob, (_job, attempt) => {
        if (attempt === 1) setGenerationMessage(isEnglish ? "Generation job accepted. Waiting for OFOX..." : "生成任务已创建，正在等待 OFOX 返回…");
        if (attempt > 0 && attempt % 8 === 0) setGenerationMessage(isEnglish ? "Still generating, polling the Core job..." : "仍在生成中，正在轮询 Core 任务状态…");
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
    <ToolFrame eyebrow="02 / TYPOGRAPHY LAYER" title={isEnglish ? "Typography" : "文字图层"} detail={isRefineMode ? (isEnglish ? "Reuse an existing layer for lettering only. Colour and material still follow the latest top sticker or another non-text reference." : "已有文字图层只提供字形；颜色与质感仍继承最新上贴，或改用其他非文字参考。") : (isEnglish ? "Use independently. The latest top sticker supplies colour, material and ornaments unless a custom non-text reference is selected." : "该工具可独立使用。默认继承项目上贴的色彩、材质与装饰，也可改用其他非文字参考。")}>
      <div className="typography-mode-switch" role="tablist" aria-label={isEnglish ? "Typography mode" : "文字图层模式"}>
        <button type="button" role="tab" aria-selected={!isRefineMode} className={!isRefineMode ? "selected" : ""} onClick={() => onTypographyChange({ mode: "create" })}>{isEnglish ? "Create new" : "新建文字图层"}</button>
        <button type="button" role="tab" aria-selected={isRefineMode} className={isRefineMode ? "selected" : ""} onClick={() => onTypographyChange({ mode: "refine" })}>{isEnglish ? "Refine existing" : "微调已有文字层"}</button>
      </div>
      {isRefineMode ? (
        <>
          <div className="tool-grid typography-refine-grid">
            <TypographyContentInput language={language} value={typography.text} onTextChange={(text) => onTypographyChange({ text })} disabled={!projectReady} />
            <AssetUpload language={language} kind="typography" label={isEnglish ? "Existing text layer" : "已有文字图层"} help={isEnglish ? "Upload transparent or solid text art for glyph shape and lettering only; it will not define colour or material." : "上传透明或实底文字图，只学习字形与笔画，不继承其颜色和质感。"} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} disabled={!projectReady} />
            <AssetUpload language={language} kind="color-reference" label={isEnglish ? "Colour/material reference" : "颜色与质感参考"} help={isEnglish ? "The latest top sticker is used by default. Otherwise choose a non-text image asset or upload a custom reference." : "默认继承最新上贴；没有上贴时，可选择非文字图片资产或上传自定义参考。"} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} reuseAssetFilter={isColorMaterialReferenceAsset} reuseLabel={isEnglish ? "Reuse non-text image" : "复用非文字图片"} selectedAsset={activeColorReference} disabled={!projectReady} />
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
            <TypographyContentInput language={language} value={typography.text} onTextChange={(text) => onTypographyChange({ text })} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} disabled={!projectReady} allowLayoutReference />
            <AssetUpload language={language} kind="color-reference" label={isEnglish ? "Text colour/material reference" : "文字颜色与质感参考"} help={isEnglish ? "The latest top sticker is used by default. Otherwise choose a non-text image asset or upload a custom reference." : "默认继承最新上贴；没有上贴时，可选择非文字图片资产或上传自定义参考。"} assets={assets} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} reuseAssetFilter={isColorMaterialReferenceAsset} reuseLabel={isEnglish ? "Reuse non-text image" : "复用非文字图片"} selectedAsset={activeColorReference} disabled={!projectReady} />
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
                  assets={assets}
                  onReuseAsset={onReuseAsset}
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
        detail={activeColorReference ? (isEnglish ? "This non-text reference sets colour, material and ornaments. Glyph references only guide lettering." : "当前非文字参考决定颜色、质感与小装饰；字体参考只约束字形。") : (isEnglish ? "Generate or select a top sticker, choose another non-text asset, or upload a custom reference." : "请先生成或选择上贴，也可改用其他非文字图片资产或上传自定义参考。")}
      />
      <div className="generation-action-row">
        <button type="button" onClick={() => void generateTypography()} disabled={!projectReady || isGenerating || !activeColorReference || (!typography.text.trim() && !latestAsset(assets, "layout-reference")) || (isRefineMode && !latestAsset(assets, "typography"))}>
          {isGenerating ? (isEnglish ? "Generating..." : "正在生成…") : isRefineMode ? (isEnglish ? "Refine with OFOX" : "使用 OFOX 微调文字图层") : (isEnglish ? "Generate with OFOX" : "使用 OFOX 生成文字图层")}
        </button>
        <p>{generationMessage || (isRefineMode ? (isEnglish ? "Upload an existing typography layer, enter replacement text, then refine it." : "上传已有文字层并填写替换文本后即可微调。") : (isEnglish ? "The editable text above is generated as a solid-matte draft first." : "上方文本可直接复制或修改；生成后先得到实底文字稿。"))}</p>
      </div>
      <TypographyOutputPreview language={language} assets={assets} isCuttingOut={isCuttingOut} message={cutoutMessage} onCutout={runCutout} />
    </ToolFrame>
  );
}

function SideStickerTool({
  language,
  assets,
  settings,
  onSettingsChange,
  onAddAsset,
  onReuseAsset,
  onComplete,
  projectReady,
}: ToolProps & {
  language: "zh" | "en";
  settings: SideStickerSettings;
  onSettingsChange: (settings: Partial<SideStickerSettings>) => void;
  onComplete: () => void;
  projectReady: boolean;
}) {
  const isEnglish = language === "en";
  const [message, setMessage] = useState("");
  const [isRendering, setIsRendering] = useState(false);
  const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);
  const talentInput = useRef<HTMLInputElement>(null);
  const giftOneInput = useRef<HTMLInputElement>(null);
  const giftTwoInput = useRef<HTMLInputElement>(null);
  const talentAsset = assets.find((asset) => asset.id === settings.talentAssetId);
  const giftOneAsset = assets.find((asset) => asset.id === settings.giftOneAssetId);
  const giftTwoAsset = assets.find((asset) => asset.id === settings.giftTwoAssetId);
  const backgroundAsset = assets.find((asset) => asset.id === settings.backgroundAssetId);
  const generationReference = latestAsset(assets, "reference");
  const talentSrc = talentAsset?.previewUrl ?? publicAssetUrl("live-sticker/side-editor/talent.png");
  const giftOneSrc = giftOneAsset?.previewUrl ?? publicAssetUrl("live-sticker/side-editor/gift-book.png");
  const giftTwoSrc = giftTwoAsset?.previewUrl ?? publicAssetUrl("live-sticker/side-editor/gift-egg.png");
  const backgroundSrc = backgroundAsset?.previewUrl;

  const uploadSlot = async (event: ChangeEvent<HTMLInputElement>, kind: "side-gift" | "side-talent", key: "talentAssetId" | "giftOneAssetId" | "giftTwoAssetId") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const asset = await onAddAsset(file, kind);
      onSettingsChange({ [key]: asset.id });
      setMessage(isEnglish ? "Image replaced." : "图片已替换。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEnglish ? "Unable to replace image." : "图片替换失败。"));
    }
  };

  const inheritPalette = async () => {
    const top = latestAsset(assets, "top");
    const bottom = latestAsset(assets, "bottom");
    if (!top && !bottom) {
      setMessage(isEnglish ? "Generate or upload a top / bottom sticker first." : "请先生成或上传上贴、下贴。 ");
      return;
    }
    try {
      const primaryColor = await sampleAssetColor((top ?? bottom)!.blob);
      const secondaryColor = bottom ? await sampleAssetColor(bottom.blob) : mixHex(primaryColor, "#ffffff", .62);
      onSettingsChange({ primaryColor, secondaryColor });
      setMessage(isEnglish ? "Palette inherited from the latest stickers." : "已继承最新上贴、下贴的主色。 ");
    } catch {
      setMessage(isEnglish ? "Unable to read the sticker palette." : "暂时无法读取贴片配色。 ");
    }
  };

  const generateBackground = async () => {
    if (!generationReference) {
      setMessage(isEnglish ? "Add or drag a side-background reference here first." : "请先在当前区域上传或拖入侧贴背景参考图。 ");
      return;
    }
    setIsGeneratingBackground(true);
    setMessage(isEnglish ? "Generating a detailed side background..." : "正在根据参考生成侧贴背景…");
    try {
      const prompt = isEnglish
        ? "Create only a vertical livestream side-sticker background. No text, people, products or cards. Inherit the reference palette and material. Add richer abstract colour, light, gloss and texture detail near the top, then gradually become paler and more transparent toward the bottom. Keep the centre calm for editable gift cards."
        : "只生成竖版直播间侧贴背景底板，不要文字、人物、商品或卡片。继承参考图的主色、材质与氛围，在顶部增加更丰富的抽象色彩、光泽与质感细节，向下逐渐变淡、透明，中央保持克制以便放置可编辑赠品卡片。";
      const initialJob = await createBackgroundJob({ kind: "side", prompt, reference: await assetReference(generationReference) });
      const job = await waitForJob(initialJob, fetchBackgroundJob, (_job, attempt) => {
        if (attempt > 0 && attempt % 8 === 0) setMessage(isEnglish ? "Still generating the side background..." : "侧贴背景仍在生成中…");
      });
      if (job.status === "failed") throw new Error(job.error?.message || (isEnglish ? "Background generation failed." : "侧贴背景生成失败。"));
      if (!job.result?.url) throw new Error(isEnglish ? "The task returned no image." : "任务没有返回图片。 ");
      const asset = await onAddAsset(await resultFile(job.result, `side-background-${job.id}.jpg`), "side-background");
      onSettingsChange({ backgroundAssetId: asset.id });
      setMessage(isEnglish ? "Generated background applied. Copy and images remain editable." : "生成背景已应用，文字和赠品图仍可直接编辑。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEnglish ? "Unable to generate the side background." : "侧贴背景生成失败。"));
    } finally {
      setIsGeneratingBackground(false);
    }
  };

  const createSideSticker = async () => {
    setIsRendering(true);
    setMessage(isEnglish ? "Rendering side sticker..." : "正在生成侧贴图层…");
    try {
      const blob = await renderSideStickerPng(settings, { talentSrc, giftOneSrc, giftTwoSrc, backgroundSrc });
      const asset = await onAddAsset(new File([blob], `side-sticker-${settings.mode}-${Date.now()}.png`, { type: "image/png" }), "side");
      setMessage(isEnglish ? `Added ${asset.fileName} to composition.` : "侧贴已生成，并自动写入效果融合。 ");
      onComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEnglish ? "Unable to render side sticker." : "侧贴生成失败。"));
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <ToolFrame eyebrow="03 / SIDE STICKER EDITOR" title={isEnglish ? "Side sticker editor" : "侧贴编辑"} detail={isEnglish ? "Edit the fixed Figma-derived layout directly. Replace copy and images, inherit the latest sticker palette, then send a transparent PNG to composition." : "基于 Figma 原型的固定模板，可直接修改文字、替换图片并继承最新贴片配色；生成后会以透明 PNG 自动进入效果融合。"}>
      <div className="side-editor-layout">
        <section className="side-preview-stage" aria-label={isEnglish ? "Editable side sticker preview" : "可编辑侧贴预览"}>
          <div className="side-preview-heading"><span>FIGMA 508:3</span><small>{isEnglish ? "Click copy or an image to edit" : "点击文字或图片即可编辑"}</small></div>
          <SideStickerPreview
            language={language}
            settings={settings}
            talentSrc={talentSrc}
            giftOneSrc={giftOneSrc}
            giftTwoSrc={giftTwoSrc}
            backgroundSrc={backgroundSrc}
            onChange={onSettingsChange}
            onReplaceTalent={() => talentInput.current?.click()}
            onReplaceGiftOne={() => giftOneInput.current?.click()}
            onReplaceGiftTwo={() => giftTwoInput.current?.click()}
          />
          <input ref={talentInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadSlot(event, "side-talent", "talentAssetId")} />
          <input ref={giftOneInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadSlot(event, "side-gift", "giftOneAssetId")} />
          <input ref={giftTwoInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadSlot(event, "side-gift", "giftTwoAssetId")} />
        </section>

        <aside className="side-editor-controls">
          <section>
            <p>{isEnglish ? "TEMPLATE" : "模板"}</p>
            <div className="side-template-switch">
              <button className={settings.mode === "flat" ? "selected" : ""} type="button" onClick={() => onSettingsChange({ mode: "flat" })}>{isEnglish ? "Flat" : "平铺侧贴"}</button>
              <button className={settings.mode === "talent" ? "selected" : ""} type="button" onClick={() => onSettingsChange({ mode: "talent" })}>{isEnglish ? "Talent" : "达人空降"}</button>
            </div>
          </section>
          <section>
            <div className="side-control-heading"><p>{isEnglish ? "PALETTE" : "配色"}</p><button type="button" onClick={() => void inheritPalette()}>{isEnglish ? "Inherit stickers" : "继承上贴 / 下贴"}</button></div>
            <div className="side-color-row">
              <label><span>{isEnglish ? "Primary" : "主色"}</span><input type="color" value={settings.primaryColor} onChange={(event) => onSettingsChange({ primaryColor: event.target.value })} /></label>
              <label><span>{isEnglish ? "Fade" : "渐隐色"}</span><input type="color" value={settings.secondaryColor} onChange={(event) => onSettingsChange({ secondaryColor: event.target.value })} /></label>
            </div>
            <div className="side-background-generation">
              <AssetUpload
                language={language}
                kind="reference"
                label={isEnglish ? "Side-background reference" : "侧贴背景参考图"}
                help={isEnglish ? "Automatically inherits the latest background reference from Step 1. Upload, paste or drag another project image here to override it." : "自动继承第 1 步最新的背景参考图；也可在这里上传、粘贴或拖入其他项目图片覆盖。"}
                assets={assets}
                onAddAsset={onAddAsset}
                onReuseAsset={onReuseAsset}
                selectedAsset={generationReference}
                compact
                disabled={!projectReady || isGeneratingBackground}
              />
              <button type="button" disabled={!projectReady || !generationReference || isGeneratingBackground} onClick={() => void generateBackground()}>{isGeneratingBackground ? (isEnglish ? "Generating..." : "正在生成…") : (isEnglish ? "Generate side background from reference" : "根据参考生成侧贴背景")}</button>
            </div>
          </section>
          <section className="side-finalize-block">
            <p>{isEnglish ? "FINALIZE" : "侧贴定稿"}</p>
            <button className="side-render-action" type="button" disabled={!projectReady || isRendering} onClick={() => void createSideSticker()}>{isRendering ? (isEnglish ? "Finalizing..." : "正在定稿…") : (isEnglish ? "Approve and continue →" : "审核完成，进入效果融合 →")}</button>
            <small>{isEnglish ? "Creates the final transparent PNG, adds it to project assets and opens Composition." : "自动生成透明侧贴资产、写入项目资产，并跳转到效果融合。"}</small>
          </section>
          <small className="side-editor-message">{message || (isEnglish ? "Output uses a transparent background." : "输出为透明背景 PNG，并保留当前模板设置。")}</small>
        </aside>
      </div>
    </ToolFrame>
  );
}

function SideStickerPreview({ language, settings, talentSrc, giftOneSrc, giftTwoSrc, backgroundSrc, onChange, onReplaceTalent, onReplaceGiftOne, onReplaceGiftTwo }: {
  language: "zh" | "en";
  settings: SideStickerSettings;
  talentSrc: string;
  giftOneSrc: string;
  giftTwoSrc: string;
  backgroundSrc?: string;
  onChange: (settings: Partial<SideStickerSettings>) => void;
  onReplaceTalent: () => void;
  onReplaceGiftOne: () => void;
  onReplaceGiftTwo: () => void;
}) {
  const commitText = (key: "eyebrow" | "title" | "footer" | "giftOneLabel" | "giftTwoLabel") => (event: React.FocusEvent<HTMLElement>) => onChange({ [key]: event.currentTarget.textContent?.trim() ?? "" });
  const gradient = `linear-gradient(180deg, ${settings.primaryColor} 0%, ${hexToRgba(settings.primaryColor, .7)} 24%, ${hexToRgba(settings.secondaryColor, .4)} 82%, ${hexToRgba(settings.secondaryColor, .16)} 100%)`;
  const generatedOverlay = `linear-gradient(180deg, ${hexToRgba(settings.primaryColor, .18)} 0%, ${hexToRgba(settings.primaryColor, .08)} 34%, ${hexToRgba(settings.secondaryColor, .44)} 100%)`;
  const footerBackground = createVividAccent(settings.primaryColor);
  const backgroundStyle = backgroundSrc
    ? { backgroundColor: settings.secondaryColor, backgroundImage: `${generatedOverlay}, url("${backgroundSrc}")`, backgroundPosition: "center", backgroundSize: "cover" }
    : { background: gradient };
  const boardStyle = {
    "--side-heading-color": adaptiveTextColor(settings.primaryColor, settings.primaryColor),
    "--side-card-text-color": adaptiveTextColor("#f7f8f5", settings.primaryColor),
    "--side-footer-background": footerBackground,
    "--side-footer-color": adaptiveTextColor(footerBackground, settings.primaryColor),
  } as CSSProperties & Record<"--side-heading-color" | "--side-card-text-color" | "--side-footer-background" | "--side-footer-color", string>;
  return (
    <div className={`side-preview-viewport ${settings.mode}`}>
      <div className={`side-sticker-art ${settings.mode}`}>
        {settings.mode === "talent" ? <button className="side-talent-image" type="button" onClick={onReplaceTalent} title={language === "en" ? "Replace talent image" : "替换达人图"}><img src={talentSrc} alt="" /><span>{language === "en" ? "Replace" : "替换"}</span></button> : null}
        <div className="side-sticker-board" style={boardStyle}>
          <div className="side-sticker-background" style={backgroundStyle} aria-hidden="true" />
          <div className="side-sticker-copy">
            <strong contentEditable suppressContentEditableWarning onBlur={commitText("eyebrow")}>{settings.eyebrow}</strong>
            <b contentEditable suppressContentEditableWarning onBlur={commitText("title")}>{settings.title}</b>
          </div>
          <article className="side-gift-card first">
            <button type="button" onClick={onReplaceGiftOne} title={language === "en" ? "Replace first gift image" : "替换第一张赠品图"}><img src={giftOneSrc} alt="" /><span>{language === "en" ? "Replace" : "替换"}</span></button>
            <p contentEditable suppressContentEditableWarning onBlur={commitText("giftOneLabel")}>{settings.giftOneLabel}</p>
          </article>
          <article className="side-gift-card second">
            <button type="button" onClick={onReplaceGiftTwo} title={language === "en" ? "Replace second gift image" : "替换第二张赠品图"}><img src={giftTwoSrc} alt="" /><span>{language === "en" ? "Replace" : "替换"}</span></button>
            <p contentEditable suppressContentEditableWarning onBlur={commitText("giftTwoLabel")}>{settings.giftTwoLabel}</p>
          </article>
          <p className="side-footer-copy" contentEditable suppressContentEditableWarning onBlur={commitText("footer")}>{settings.footer}</p>
        </div>
      </div>
    </div>
  );
}

function CompositionTool({
  language,
  assets,
  composition,
  onAddAsset,
  onReuseAsset,
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
  const [fadeActive, setFadeActive] = useState(false);
  const [bottomTypographyBusy, setBottomTypographyBusy] = useState(false);
  const [bottomTypographyMessage, setBottomTypographyMessage] = useState("");
  const canvasLayers = composition.layers
    .map((layer) => ({ layer, asset: assets.find((asset) => asset.id === layer.assetId) }))
    .filter((item): item is { layer: CompositionLayer; asset: ProjectAsset } => Boolean(item.asset));
  const visibleCanvasLayers = canvasLayers.filter((item) => item.layer.visible);
  const selectedLayer = canvasLayers.find((item) => item.layer.id === composition.selectedLayerId)?.layer ?? visibleCanvasLayers.at(-1)?.layer ?? canvasLayers.at(-1)?.layer;
  const typographyLayer = canvasLayers.find((item) => item.layer.kind === "typography")?.layer;
  const sideLayer = canvasLayers.find((item) => item.layer.kind === "side")?.layer;
  const bottomTypographyLayer = canvasLayers.find((item) => item.layer.kind === "bottom-typography")?.layer;

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        const redo = event.shiftKey;
        if (redo ? !canRedo : !canUndo) return;
        event.preventDefault();
        if (redo) onRedo(); else onUndo();
      } else if (key === "y" && canRedo) {
        event.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [canRedo, canUndo, onRedo, onUndo]);

  const isEnglish = language === "en";
  const toggleBottomTypography = async () => {
    if (bottomTypographyLayer) {
      const visible = !bottomTypographyLayer.visible;
      onBeginCompositionInteraction();
      onUpdateLayer(bottomTypographyLayer.id, { visible });
      onEndCompositionInteraction();
      if (visible) onSelectLayer(bottomTypographyLayer.id);
      return;
    }
    setBottomTypographyBusy(true);
    setBottomTypographyMessage(isEnglish ? "Preparing the bottom typography layer…" : "正在生成下贴文字图层…");
    try {
      await onAddAsset(await renderBottomTypographyAsset(assets), "bottom-typography");
      setBottomTypographyMessage(isEnglish ? "Bottom typography added at its fixed export position." : "下贴文字图层已按固定位置置入，并加入导出资产。");
    } catch (error) {
      setBottomTypographyMessage(error instanceof Error ? error.message : (isEnglish ? "Could not create the bottom typography layer." : "下贴文字图层生成失败。"));
    } finally {
      setBottomTypographyBusy(false);
    }
  };
  return (
    <ToolFrame eyebrow="04 / COMPOSITION BOARD" title={isEnglish ? "Composition" : "效果融合"} detail={isEnglish ? "The fixed input flow inherits the latest upstream assets. Replace any input locally, then use the canvas below for precise placement, scale and boundary fading." : "固定输入流程会自动继承前面工具的最新结果，也可在节点内选择本地图片覆盖；下方画板继续用于精细位置、尺寸与遮罩调整。"}>
      <CompositionFlow language={language} assets={assets} composition={composition} onAddAsset={onAddAsset} onReuseAsset={onReuseAsset} onSelectLayer={onSelectLayer} projectReady={projectReady} />
      <div className="composition-workbench">
        <div className="composition-stage-wrap">
          <div className="composition-toolbar">
            <div className="canvas-mode-switch" aria-label={isEnglish ? "Canvas mode" : "画板模式"}>
              <button className={fadeActive ? "selected" : ""} onClick={() => setFadeActive((active) => !active)}>{isEnglish ? "Fade draw" : "手绘渐隐"}</button>
              <button className={typographyLayer?.visible ? "selected" : ""} disabled={!typographyLayer} onClick={() => {
                if (!typographyLayer) return;
                const visible = !typographyLayer.visible;
                onBeginCompositionInteraction();
                onUpdateLayer(typographyLayer.id, { visible });
                onEndCompositionInteraction();
                if (visible) onSelectLayer(typographyLayer.id);
              }}>{isEnglish ? "Place text" : "置入文字框"}</button>
              <button className={sideLayer?.visible ? "selected" : ""} disabled={!sideLayer} onClick={() => {
                if (!sideLayer) return;
                const visible = !sideLayer.visible;
                onBeginCompositionInteraction();
                onUpdateLayer(sideLayer.id, { visible });
                onEndCompositionInteraction();
                if (visible) onSelectLayer(sideLayer.id);
              }}>{isEnglish ? "Place side" : "置入侧贴"}</button>
              <button className={bottomTypographyLayer?.visible ? "selected" : ""} disabled={!projectReady || bottomTypographyBusy} onClick={() => void toggleBottomTypography()}>{bottomTypographyBusy ? (isEnglish ? "Preparing…" : "生成中…") : (isEnglish ? "Bottom text" : "置入底部文字")}</button>
            </div>
          </div>
          <CompositionCanvas language={language} layers={canvasLayers} selectedLayer={selectedLayer} fadeActive={fadeActive} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} />
          <p className="stage-note">{bottomTypographyMessage || (fadeActive ? (isEnglish ? "Hover or draw inside the top or bottom sticker to reveal the content underneath. The top keeps above the line and the bottom keeps below it." : "移动到上贴或下贴区域时会临时显露下方内容；拖动画线后，上贴保留线以上、下贴保留线以下。") : (isEnglish ? "Each placement is an independent switch. Bottom text keeps its fixed size and export position." : "四项功能均为独立开关；底部文字保持固定尺寸与导出位置，不参与移动和缩放。"))}</p>
        </div>
        <CompositionInspector language={language} layer={selectedLayer} asset={selectedLayer ? assets.find((asset) => asset.id === selectedLayer.assetId) : undefined} onSelectLayer={onSelectLayer} onUpdateLayer={onUpdateLayer} onUpdateLayerMask={onUpdateLayerMask} onBeginInteraction={onBeginCompositionInteraction} onEndInteraction={onEndCompositionInteraction} layers={canvasLayers} />
      </div>
    </ToolFrame>
  );
}

function CompositionFlow({ language, assets, composition, onAddAsset, onReuseAsset, onSelectLayer, projectReady }: { language: "zh" | "en"; assets: ProjectAsset[]; composition: CompositionDocument; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; onSelectLayer: (layerId: string) => void; projectReady: boolean }) {
  const selectAsset = useCallback((assetId: string) => {
    const layer = composition.layers.find((item) => item.assetId === assetId);
    if (layer) onSelectLayer(layer.id);
  }, [composition.layers, onSelectLayer]);
  const kinds: CompositionInputKind[] = ["base-image", "top", "side", "bottom", "typography"];

  return (
    <div className="composition-flow-shell" aria-label={language === "en" ? "Fixed composition input flow" : "固定效果融合输入流程"}>
      <FlowConnections />
      <div className="composition-flow-inputs">
        {kinds.map((kind) => {
          const asset = [...assets].reverse().find((item) => item.kind === kind);
          return <FlowAssetNode key={kind} data={{ kind, language, label: flowNodeLabel(kind, language), assets, asset, disabled: !projectReady, onAddAsset, onReuseAsset, onSelectAsset: selectAsset }} />;
        })}
      </div>
      <FlowOutputNode language={language} />
    </div>
  );
}

function FlowConnections() {
  const desktopPaths = [
    "M100 163 C100 210 405 210 500 244",
    "M300 163 C300 207 442 218 500 244",
    "M500 163 C500 198 500 220 500 244",
    "M700 163 C700 207 558 218 500 244",
    "M900 163 C900 210 595 210 500 244",
  ];
  const mobilePaths = [
    "M167 112 C167 246 420 252 500 330",
    "M500 112 C500 198 500 250 500 330",
    "M833 112 C833 246 580 252 500 330",
    "M333 244 C333 284 438 291 500 330",
    "M667 244 C667 284 562 291 500 330",
  ];
  const renderPaths = (paths: string[], className: string) => (
    <g className={className}>
      {paths.map((path, index) => (
        <g key={path}>
          <path className="flow-line-base" d={path} />
          <path className="flow-line-stream" d={path} style={{ animationDelay: `${index * -.17}s` }} />
          <circle className="flow-line-pulse" r="3.2">
            <animateMotion dur={`${1.8 + index * .12}s`} begin={`${index * .22}s`} repeatCount="indefinite" path={path} />
          </circle>
        </g>
      ))}
    </g>
  );
  return (
    <svg className="composition-flow-lines" viewBox="0 0 1000 402" preserveAspectRatio="none" aria-hidden="true">
      {renderPaths(desktopPaths, "flow-lines-desktop")}
      {renderPaths(mobilePaths, "flow-lines-mobile")}
    </svg>
  );
}

function FlowAssetNode({ data: node }: { data: FlowAssetNodeData }) {
  const isEnglish = node.language === "en";
  const fileInput = useRef<HTMLInputElement>(null);
  const unavailableUpload = useCallback(async () => { throw new Error(isEnglish ? "This node cannot accept an upload." : "当前节点不可上传。"); }, [isEnglish]);
  const upload = useImagePasteUpload({ kind: node.kind, onAddAsset: node.onAddAsset ?? unavailableUpload, disabled: Boolean(node.disabled || !node.onAddAsset) });
  const drop = useProjectAssetDrop({ language: node.language ?? "zh", assets: node.assets ?? [], kind: node.kind, onReuseAsset: node.onReuseAsset, disabled: Boolean(node.disabled || !node.onReuseAsset) });

  return (
    <div
      className={`flow-asset-node${upload.isPasteTarget ? " paste-ready" : ""}${drop.isDragTarget ? " drop-ready" : ""}`}
      title={isEnglish ? "Paste an image, or drag any project image here" : "可粘贴图片，也可拖入任意项目图片"}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={(event) => void drop.onDrop(event)}
      onClick={() => node.asset && node.onSelectAsset?.(node.asset.id)}
    >
      <span>{node.label}</span>
      {node.asset ? <img src={node.asset.previewUrl} alt="" /> : <small>{isEnglish ? "Inherit prior output" : "继承前序结果"}</small>}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={node.disabled} />
      <button type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }} disabled={node.disabled}>{upload.message || drop.message || (isEnglish ? "Choose image" : "选择图片")}</button>
      <span className="flow-node-port" aria-hidden="true" />
    </div>
  );
}

function FlowOutputNode({ language }: { language: "zh" | "en" }) {
  return (
    <div className="flow-output-node">
      <span className="flow-node-port target" aria-hidden="true" />
      <span>{language === "en" ? "Merged output" : "融合输出"}</span>
      <small>{language === "en" ? "Continue on the canvas below" : "进入下方画板继续微调"}</small>
    </div>
  );
}

function flowNodeLabel(kind: CompositionInputKind, language: "zh" | "en") {
  if (language === "zh") return assetKindLabels[kind];
  return { "base-image": "Room background", top: "Top sticker", bottom: "Bottom sticker", side: "Side sticker", typography: "Typography" }[kind];
}

function CompositionCanvas({
  language,
  layers,
  selectedLayer,
  fadeActive,
  onSelectLayer,
  onUpdateLayer,
  onUpdateLayerMask,
  onBeginInteraction,
  onEndInteraction,
}: {
  language: "zh" | "en";
  layers: Array<{ layer: CompositionLayer; asset: ProjectAsset }>;
  selectedLayer?: CompositionLayer;
  fadeActive: boolean;
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
    aspectRatio?: number;
    centerX?: number;
    centerY?: number;
  } | null>(null);
  const fadeDrawing = useRef<{ pointerId: number; layer: CompositionLayer; lockedY: number | null } | null>(null);
  const [previewPath, setPreviewPath] = useState<Array<{ x: number; y: number }>>([]);
  const [peekLayerId, setPeekLayerId] = useState<string>();

  const percentPoint = (event: ReactPointerEvent<HTMLElement>, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)), y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, layer: CompositionLayer) => {
    if (fadeActive) return;
    const movable = layer.kind === "side" && layer.visible;
    const selectableText = layer.kind === "typography" && layer.visible;
    if (!movable && !selectableText) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    onSelectLayer(layer.id);
    if (!movable) return;
    onBeginInteraction();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { type: "drag", pointerId: event.pointerId, layer, startX: event.clientX, startY: event.clientY };
  };

  const onResizeDown = (event: ReactPointerEvent<HTMLSpanElement>, layer: CompositionLayer) => {
    if (fadeActive || layer.kind !== "typography" || !layer.visible || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectLayer(layer.id);
    onBeginInteraction();
    const parent = event.currentTarget.parentElement;
    parent?.setPointerCapture(event.pointerId);
    interaction.current = {
      type: "resize",
      pointerId: event.pointerId,
      layer,
      startX: event.clientX,
      startY: event.clientY,
      aspectRatio: layer.width / Math.max(layer.height, 1),
      centerX: layer.x + layer.width / 2,
      centerY: layer.y + layer.height / 2,
    };
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
      const width = Math.max(8, active.layer.width + deltaX * 2);
      const height = width / Math.max(active.aspectRatio ?? 1, 0.08);
      onUpdateLayer(active.layer.id, {
        width,
        height,
        x: (active.centerX ?? active.layer.x + active.layer.width / 2) - width / 2,
        y: (active.centerY ?? active.layer.y + active.layer.height / 2) - height / 2,
      });
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interaction.current || interaction.current.pointerId !== event.pointerId) return;
    interaction.current = null;
    onEndInteraction();
  };

  const onLayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, layer: CompositionLayer) => {
    if (fadeActive || layer.kind !== "typography" || !layer.visible) return;
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
    if (!fadeActive || event.button !== 0) return;
    const rawPoint = percentPoint(event, event.currentTarget);
    const layer = fadeTargetAt(rawPoint);
    if (!layer) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = constrainFadePoint(rawPoint, layer);
    setPeekLayerId(layer.id);
    fadeDrawing.current = { pointerId: event.pointerId, layer, lockedY: event.shiftKey ? point.y : null };
    setPreviewPath([point]);
    onSelectLayer(layer.id);
    onBeginInteraction();
    onUpdateLayerMask(layer.id, (mask) => ({ ...mask, mode: "manual", fadePath: [point] }));
  };

  const onFadeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = fadeDrawing.current;
    if (!active) {
      setPeekLayerId(fadeTargetAt(percentPoint(event, event.currentTarget))?.id);
      return;
    }
    if (active.pointerId !== event.pointerId) return;
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
    setPeekLayerId(undefined);
    onEndInteraction();
  };

  return (
    <div className="composition-stage" ref={stageRef} aria-label={language === "en" ? "Composition canvas" : "融合画板"}>
      <span className="composition-output-size">{COMPOSITION_OUTPUT.width} × {COMPOSITION_OUTPUT.height}</span>
      <div className="composition-safe-lines" aria-hidden="true"><span /><span /></div>
      {layers.length === 0 ? <p>{language === "en" ? "Import a room background or sticker asset to place it here." : "导入底图或贴片素材后，图层会出现在这里。"}</p> : layers.map(({ layer, asset }) => (
        <div
          className={`${layer.id === selectedLayer?.id ? "canvas-layer selected" : "canvas-layer"}${!fadeActive && layer.kind === "side" && layer.visible ? " draggable-side" : " locked-layer"}${!fadeActive && layer.kind === "typography" && layer.visible ? " keyboard-positioned" : ""}${layer.kind === "base-image" ? " base-image-layer" : ""}${layer.id === peekLayerId ? " mask-peek" : ""}`}
          key={layer.id}
          onPointerDown={(event) => onPointerDown(event, layer)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={(event) => onLayerKeyDown(event, layer)}
          style={{
            left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, height: `${layer.height}%`, opacity: (layer.opacity / 100) * (layer.id === peekLayerId ? 0.55 : 1),
            zIndex: layer.zIndex, visibility: layer.visible ? "visible" : "hidden", ...maskStyle(layer),
          }}
          title={`${assetLabel(layer.kind, language)} · ${asset.fileName} · ${layer.kind === "base-image" ? (language === "en" ? "fixed 1920px height, centred without stretching" : "固定 1920 高度，等比例居中且不拉伸") : layer.kind === "bottom-typography" ? (language === "en" ? "auto-cropped within 724 × 150px and fixed at export position" : "在 724 × 150 px 范围内自动裁边，并锁定导出位置") : language === "en" ? (layer.kind === "side" ? "drag or use arrow keys" : "use arrow keys to position") : (layer.kind === "side" ? "可拖动或使用方向键定位" : "使用方向键定位")}`}
          role="button"
          tabIndex={0}
          aria-label={`${assetLabel(layer.kind, language)} ${language === "en" ? "layer" : "图层"}`}
        >
          <img src={asset.previewUrl} alt={assetLabel(layer.kind, language)} draggable={false} />
          <span>{assetLabel(layer.kind, language)}</span>
          {layer.id === selectedLayer?.id && !fadeActive && layer.kind === "typography" && layer.visible ? <i className="resize-handle" onPointerDown={(event) => onResizeDown(event, layer)} title={language === "en" ? "Drag to resize" : "拖动缩放"} /> : null}
        </div>
      ))}
      {fadeActive ? <div className="fade-drawing-overlay" title={language === "en" ? "Draw on a top or bottom sticker. Hold Shift for a horizontal line." : "在上贴或下贴区域画渐隐线，按住 Shift 可画水平直线"} onPointerDown={onFadeStart} onPointerMove={onFadeMove} onPointerUp={onFadeEnd} onPointerCancel={onFadeEnd} onPointerLeave={() => { if (!fadeDrawing.current) setPeekLayerId(undefined); }}>{previewPath.length > 1 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={pointsToSvgPath(previewPath)} /></svg> : null}</div> : null}
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
          <div className={`${item.layer.id === layer?.id ? "layer-row selected" : "layer-row"}${item.layer.visible ? "" : " hidden-layer"}`} key={item.layer.id}>
            <button
              className="layer-eye"
              type="button"
              aria-label={item.layer.visible ? (isEnglish ? `Hide ${assetLabel(item.layer.kind, language)}` : `隐藏${assetLabel(item.layer.kind, language)}`) : (isEnglish ? `Show ${assetLabel(item.layer.kind, language)}` : `显示${assetLabel(item.layer.kind, language)}`)}
              aria-pressed={item.layer.visible}
              title={item.layer.visible ? (isEnglish ? "Hide layer" : "隐藏图层") : (isEnglish ? "Show layer" : "显示图层")}
              onClick={() => {
                const visible = !item.layer.visible;
                onBeginInteraction();
                onUpdateLayer(item.layer.id, { visible });
                onEndInteraction();
                onSelectLayer(item.layer.id);
              }}
            >
              <LayerEyeIcon visible={item.layer.visible} />
            </button>
            <button className="layer-row-main" type="button" onClick={() => onSelectLayer(item.layer.id)}>
              <span>{assetLabel(item.layer.kind, language)}</span>
              <small>{item.asset.fileName}</small>
            </button>
          </div>
        ))}
      </div>
      {layer && asset ? (
        <div className="layer-controls">
          <h3>{assetLabel(layer.kind, language)}</h3>
          <p className="keyboard-tip">{layer.kind === "typography" ? (isEnglish ? "Use arrow keys to position text; drag its canvas handle to scale proportionally." : "文字层用方向键定位，并通过画板右下角手柄等比例缩放。") : layer.kind === "side" ? (isEnglish ? "Switch to Place side, then drag it directly on the canvas." : "切换到“置入侧贴”后，可在画板中直接拖动。") : (isEnglish ? "This layer stays locked to preserve the composite layout." : "该图层保持锁定，以维持贴片合成结构。")}</p>
          {layer.kind === "typography" || layer.kind === "side" ? <LayerPositionReadout language={language} x={layer.x} y={layer.y} /> : null}
          {layer.kind === "typography" ? <>
            <LayerRange label={isEnglish ? "Width" : "宽度"} value={layer.width} min={8} onChange={(width) => {
              const height = width / Math.max(layer.width / Math.max(layer.height, 1), 0.08);
              onUpdateLayer(layer.id, { width, height });
            }} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          </> : null}
          <LayerRange label={isEnglish ? "Opacity" : "透明度"} value={layer.opacity} min={0} onChange={(opacity) => onUpdateLayer(layer.id, { opacity })} onBegin={onBeginInteraction} onEnd={onEndInteraction} />
          {layer.kind === "top" || layer.kind === "bottom" ? <LayerRange label={isEnglish ? "Default feather" : "默认羽化"} value={layer.mask.feather} max={48} onChange={(feather) => onUpdateLayerMask(layer.id, (mask) => ({ ...mask, feather }))} onBegin={onBeginInteraction} onEnd={onEndInteraction} /> : null}
          <label className="layer-visibility"><input type="checkbox" checked={layer.visible} onChange={(event) => { onBeginInteraction(); onUpdateLayer(layer.id, { visible: event.target.checked }); onEndInteraction(); }} /> {isEnglish ? "Show layer" : "显示图层"}</label>
          {layer.kind === "top" || layer.kind === "bottom" ? <button className="mask-reset" onClick={() => { onBeginInteraction(); onUpdateLayer(layer.id, { mask: { mode: "default", feather: layer.mask.feather, fadePath: [], edgeTexture: "none" } }); onEndInteraction(); }}>{isEnglish ? "Reset hand-drawn fade" : "重置手绘渐隐"}</button> : null}
        </div>
      ) : <p className="empty-copy">{isEnglish ? "Select a layer to edit its local properties." : "选择一个图层后可调整它的本地状态。"}</p>}
    </aside>
  );
}

function LayerEyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.8" />
      {!visible ? <path className="eye-slash" d="m4 4 16 16" /> : null}
    </svg>
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

function ExportTool({ language, assets, composition }: { language: "zh" | "en"; assets: ProjectAsset[]; composition: CompositionDocument }) {
  const defaultAssetIds = useMemo(() => composition.layers
    .filter((layer) => layer.visible && layer.kind !== "base-image" && assets.some((asset) => asset.id === layer.assetId))
    .map((layer) => layer.assetId), [assets, composition.layers]);
  const defaultSelectionKey = defaultAssetIds.join("|");
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set(defaultAssetIds));
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const selectedAssets = useMemo(() => assets.filter((asset) => selectedAssetIds.has(asset.id)), [assets, selectedAssetIds]);
  const exportGroups = useMemo(() => assetCategoryOrder
    .map((category) => ({
      category,
      assets: assets
        .filter((asset) => assetCategoryFor(asset.kind) === category)
        .slice()
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt)),
    }))
    .filter((group) => group.assets.length > 0), [assets]);
  const selectedCount = selectedAssets.length;
  const isEnglish = language === "en";

  useEffect(() => {
    setSelectedAssetIds(new Set(defaultAssetIds));
  }, [defaultSelectionKey]);

  const exportSelected = async () => {
    if (!selectedAssets.length && !composition.layers.some((layer) => layer.visible)) return;
    setIsExporting(true);
    setExportMessage(isEnglish ? "Rendering the composition preview and packing visible sticker layers..." : "正在生成效果融合预览图，并打包可见贴片图层…");
    try {
      const zip = await makeProjectZip(selectedAssets, language, composition, assets);
      downloadBlob(zip, `muyang-live-sticker-composition-${new Date().toISOString().slice(0, 10)}.zip`);
      setExportMessage(isEnglish ? "Composition package exported with a 1080 × 1920 preview." : "效果融合资产包已导出，内含 1080 × 1920 预览效果图。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : (isEnglish ? "Export failed." : "导出失败。"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ToolFrame eyebrow="05 / EXPORT ASSETS" title={isEnglish ? "One-click composition export" : "一键导出资产"} detail={isEnglish ? "Visible sticker layers from the composition preview are selected by default. The ZIP also includes a flattened 1080 × 1920 preview image." : "默认勾选效果融合预览窗口中当前显示的贴片图层；导出的 ZIP 会额外包含一张 1080 × 1920 预览效果图。"}>
      <div className="export-primary-card">
        <div>
          <span>{isEnglish ? "COMPOSITION PACKAGE" : "效果融合默认包"}</span>
          <strong>{isEnglish ? `${selectedCount} selected layers + preview` : `${selectedCount} 个已选贴片图层 + 预览效果图`}</strong>
          <small>{isEnglish ? "Exports visible PNG layers with composition opacity and masks baked in, plus the current 1080 × 1920 preview." : "导出已写入透明度与渐隐蒙版的可见 PNG 图层，以及当前 1080 × 1920 效果融合预览图。"}</small>
        </div>
        <button type="button" disabled={(!selectedCount && !composition.layers.some((layer) => layer.visible)) || isExporting} onClick={() => void exportSelected()}>{isExporting ? (isEnglish ? "Exporting..." : "正在导出…") : (isEnglish ? "Export composition package" : "一键导出效果融合资产包")}</button>
        <p>{exportMessage || (isEnglish ? "Ready to export the default composition package." : "默认资产包已就绪，可直接导出。")}</p>
      </div>
      <div className="export-list">
        {assets.length === 0 ? <p className="empty-copy">{isEnglish ? "There are no project assets to export." : "还没有可导出的项目资产。"}</p> : exportGroups.map((group) => (
          <section className="export-asset-group" key={group.category}>
            <div className="export-group-heading">
              <strong>{assetCategoryLabel(group.category, language)}</strong>
              <span>{group.assets.length}</span>
              <small>{isEnglish ? "Newest first" : "新生成在前"}</small>
            </div>
            {group.assets.map((asset) => {
              const selected = selectedAssetIds.has(asset.id);
              const isCompositionDefault = defaultAssetIds.includes(asset.id);
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
                  <img src={asset.previewUrl} alt="" />
                  <span>{assetLabel(asset.kind, language)}{isCompositionDefault ? <em>{isEnglish ? "Preview" : "预览默认"}</em> : null}</span>
                  <strong>{asset.fileName}</strong>
                  <small>{formatBytes(asset.sizeBytes)}</small>
                </label>
              );
            })}
          </section>
        ))}
      </div>
      <div className="export-footer">
        <span>{isEnglish ? `${selectedCount} layers selected + 1 preview` : `已选择 ${selectedCount} 个贴片图层 + 1 张预览效果图`}</span>
        <button type="button" disabled={isExporting} onClick={() => setSelectedAssetIds(new Set(defaultAssetIds))}>{isEnglish ? "Use visible layers" : "恢复预览默认项"}</button>
        <button type="button" disabled={!assets.length || isExporting} onClick={() => setSelectedAssetIds(new Set(assets.map((asset) => asset.id)))}>{isEnglish ? "Select all" : "全选"}</button>
        <button type="button" disabled={!selectedCount || isExporting} onClick={() => setSelectedAssetIds(new Set())}>{isEnglish ? "Clear" : "清空"}</button>
        <label className="advanced-option"><input type="checkbox" disabled /> {isEnglish ? "Project configuration JSON (advanced later)" : "项目配置 JSON（后期高级功能）"}</label>
        <small className="export-message">{isEnglish ? "Hidden composition layers are excluded from the default package." : "小眼睛关闭的图层不会进入默认包；直播间底图只参与预览合成。"}</small>
      </div>
    </ToolFrame>
  );
}

type ToolProps = {
  assets: ProjectAsset[];
  onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>;
  onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>;
};

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

function defaultReuseAssetFilter(asset: ProjectAsset, kind: ProjectAssetKind) {
  return kind === "side-gift" || kind === "side-talent"
    ? asset.kind === kind
    : assetCategoryFor(asset.kind) === assetCategoryFor(kind);
}

function useProjectAssetDrop({ language, assets, kind, onReuseAsset, disabled, onActivate, onSelected }: { language: "zh" | "en"; assets: ProjectAsset[]; kind: ProjectAssetKind; onReuseAsset?: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; disabled: boolean; onActivate?: () => void; onSelected?: (asset: ProjectAsset) => void }) {
  const [isDragTarget, setIsDragTarget] = useState(false);
  const [message, setMessage] = useState("");
  const hasProjectAsset = (event: ReactDragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(PROJECT_ASSET_DRAG_TYPE);
  const onDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !onReuseAsset || !hasProjectAsset(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragTarget(true);
  };
  const onDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragTarget(false);
  };
  const onDrop = async (event: ReactDragEvent<HTMLElement>) => {
    if (disabled || !onReuseAsset) return;
    const assetId = event.dataTransfer.getData(PROJECT_ASSET_DRAG_TYPE);
    if (!assetId) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDragTarget(false);
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) {
      setMessage(language === "en" ? "This project asset is no longer available." : "这个项目素材已经不存在了。");
      return;
    }
    onActivate?.();
    try {
      const reused = await onReuseAsset(asset.id, kind);
      setMessage(language === "en" ? `Selected ${reused.fileName}` : `已选用：${reused.fileName}`);
      onSelected?.(reused);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (language === "en" ? "Unable to use this asset." : "无法使用该素材。"));
    }
  };
  return { isDragTarget, message, onDragOver, onDragLeave, onDrop };
}

function AssetReusePicker({ language, assets, kind, onReuseAsset, disabled = false, onActivate, onSelected, assetFilter, label }: { language: "zh" | "en"; assets: ProjectAsset[]; kind: ProjectAssetKind; onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; disabled?: boolean; onActivate?: () => void; onSelected?: (asset: ProjectAsset) => void; assetFilter?: (asset: ProjectAsset) => boolean; label?: string }) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const reusableAssets = assets.filter(assetFilter ?? ((asset) => defaultReuseAssetFilter(asset, kind)));
  if (!reusableAssets.length) return null;
  const orderedAssets = [...reusableAssets].reverse();
  const reuse = async (assetId: string) => {
    if (!assetId || disabled) return;
    onActivate?.();
    try {
      const asset = await onReuseAsset(assetId, kind);
      setMessage(language === "en" ? `Reused ${asset.fileName}` : `已复用：${asset.fileName}`);
      setExpanded(false);
      onSelected?.(asset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (language === "en" ? "Unable to reuse this asset." : "无法复用该素材。"));
    }
  };
  return (
    <div className="asset-reuse" onClick={(event) => event.stopPropagation()}>
      <span className="asset-reuse-label">{label ?? (language === "en" ? `Reuse ${assetCategoryLabel(assetCategoryFor(kind), language).toLowerCase()}` : `复用已有${assetCategoryLabel(assetCategoryFor(kind), language)}`)}</span>
      <div className="asset-reuse-quick">
        {orderedAssets.slice(0, 4).map((asset) => (
          <button type="button" className="asset-reuse-thumb" key={asset.id} disabled={disabled} onClick={() => void reuse(asset.id)} title={`${assetLabel(asset.kind, language)} · ${asset.fileName}`}>
            <img src={asset.previewUrl} alt={asset.fileName} />
          </button>
        ))}
        {orderedAssets.length > 4 ? <button type="button" className="asset-reuse-more" disabled={disabled} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? (language === "en" ? "Close" : "收起") : (language === "en" ? `All ${orderedAssets.length}` : `全部 ${orderedAssets.length}`)}</button> : null}
      </div>
      {expanded ? <div className="asset-reuse-grid">
        {orderedAssets.map((asset) => (
          <button type="button" className="asset-reuse-card" key={asset.id} disabled={disabled} onClick={() => void reuse(asset.id)} title={`${assetLabel(asset.kind, language)} · ${asset.fileName}`}>
            <img src={asset.previewUrl} alt="" />
            <span>{assetLabel(asset.kind, language)}</span>
            <small>{asset.fileName}</small>
          </button>
        ))}
      </div> : null}
      {message ? <small>{message}</small> : null}
    </div>
  );
}

function sameAssetImage(left: ProjectAsset, right: ProjectAsset) {
  return left.id === right.id || (left.fileName === right.fileName && left.sizeBytes === right.sizeBytes && left.mimeType === right.mimeType);
}

function AssetUpload({ language, kind, label, help, assets, onAddAsset, onReuseAsset, compact = false, disabled = false, reuseAssetFilter, reuseLabel, selectedAsset }: { language: "zh" | "en"; kind: ProjectAssetKind; label: string; help: string; assets: ProjectAsset[]; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; compact?: boolean; disabled?: boolean; reuseAssetFilter?: (asset: ProjectAsset) => boolean; reuseLabel?: string; selectedAsset?: ProjectAsset }) {
  const upload = useImagePasteUpload({ kind, onAddAsset, disabled });
  const inputRef = useRef<HTMLInputElement>(null);
  const activeAsset = selectedAsset ?? latestAsset(assets, kind);
  const [isChoosing, setIsChoosing] = useState(!activeAsset);
  const drop = useProjectAssetDrop({ language, assets, kind, onReuseAsset, disabled, onSelected: () => setIsChoosing(false) });
  const pickerFilter = (asset: ProjectAsset) => {
    if (activeAsset && sameAssetImage(asset, activeAsset)) return false;
    return reuseAssetFilter ? reuseAssetFilter(asset) : defaultReuseAssetFilter(asset, kind);
  };

  useEffect(() => {
    if (activeAsset) setIsChoosing(false);
  }, [activeAsset?.id]);

  return (
    <div
      className={`${compact ? "asset-upload compact" : "asset-upload"}${disabled ? " disabled" : ""}${upload.isPasteTarget ? " paste-ready" : ""}${drop.isDragTarget ? " drop-ready" : ""}${activeAsset && !isChoosing ? " has-selection" : ""}`}
      title={language === "en" ? "Paste an image, or drag one here from project assets" : "可粘贴图片，也可从项目资产拖入"}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={(event) => void drop.onDrop(event)}
    >
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={disabled} />
      {activeAsset && !isChoosing ? (
        <div className="asset-upload-selection">
          <img src={activeAsset.previewUrl} alt="" />
          <div>
            <span>{language === "en" ? "Selected image" : "当前选用图片"}</span>
            <strong>{activeAsset.fileName}</strong>
            <small>{assetLabel(activeAsset.kind, language)}</small>
          </div>
          <button type="button" disabled={disabled} onClick={() => setIsChoosing(true)}>{language === "en" ? "Change" : "更换图片"}</button>
        </div>
      ) : (
        <>
          <span>{label}</span>
          <small>{help}</small>
          <div className="asset-upload-actions">
            <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>{upload.message || (disabled ? (language === "en" ? "Restoring project" : "正在恢复项目") : (language === "en" ? "Choose image" : "选择图片"))}</button>
            {activeAsset ? <button className="subtle" type="button" onClick={() => setIsChoosing(false)}>{language === "en" ? "Cancel" : "取消更换"}</button> : null}
          </div>
          <AssetReusePicker language={language} assets={assets} kind={kind} onReuseAsset={onReuseAsset} disabled={disabled} assetFilter={pickerFilter} label={reuseLabel} onSelected={() => setIsChoosing(false)} />
        </>
      )}
      {drop.message && !activeAsset ? <small className="asset-drop-message">{drop.message}</small> : null}
    </div>
  );
}

function TypographyContentInput({ language, value, onTextChange, assets = [], onAddAsset, onReuseAsset, disabled, allowLayoutReference = false }: { language: "zh" | "en"; value: string; onTextChange: (text: string) => void; assets?: ProjectAsset[]; onAddAsset?: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onReuseAsset?: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; disabled: boolean; allowLayoutReference?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const unavailableUpload = useCallback(async () => { throw new Error("当前输入框不接收图片。 "); }, []);
  const upload = useImagePasteUpload({ kind: "layout-reference", onAddAsset: onAddAsset ?? unavailableUpload, disabled: disabled || !allowLayoutReference });
  const drop = useProjectAssetDrop({ language, assets, kind: "layout-reference", onReuseAsset, disabled: disabled || !allowLayoutReference });

  return (
    <section
      className={`typography-content-input${disabled ? " disabled" : ""}${allowLayoutReference && upload.isPasteTarget ? " paste-ready" : ""}${drop.isDragTarget ? " drop-ready" : ""}`}
      title={allowLayoutReference ? (language === "en" ? "Hover and press Ctrl / Cmd + V to paste a layout reference" : "悬停后可按 Ctrl / Cmd + V 粘贴带布局的文本图片") : (language === "en" ? "Enter or paste multiline text" : "可直接输入或粘贴多行文本")}
      onPointerEnter={allowLayoutReference ? upload.onPointerEnter : undefined}
      onPointerLeave={allowLayoutReference ? upload.onPointerLeave : undefined}
      onDragOver={allowLayoutReference ? drop.onDragOver : undefined}
      onDragLeave={allowLayoutReference ? drop.onDragLeave : undefined}
      onDrop={allowLayoutReference ? (event) => void drop.onDrop(event) : undefined}
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
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>{upload.message || drop.message || (language === "en" ? "Choose layout text image" : "选择带布局文本图片")}</button>
        {onReuseAsset ? <AssetReusePicker language={language} assets={assets} kind="layout-reference" onReuseAsset={onReuseAsset} disabled={disabled} /> : null}
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

function CustomFontReferenceCard({ language, selected, disabled, assets, onAddAsset, onReuseAsset, onActivate }: { language: "zh" | "en"; selected: boolean; disabled: boolean; assets: ProjectAsset[]; onAddAsset: (file: File, kind: ProjectAssetKind) => Promise<ProjectAsset>; onReuseAsset: (assetId: string, kind: ProjectAssetKind) => Promise<ProjectAsset>; onActivate: () => void }) {
  const upload = useImagePasteUpload({ kind: "font-reference", onAddAsset, disabled, onActivate });
  const drop = useProjectAssetDrop({ language, assets, kind: "font-reference", onReuseAsset, disabled, onActivate });

  return (
    <label
      className={`font-preset-card custom-font-preset${selected ? " selected" : ""}${disabled ? " disabled" : ""}${upload.isPasteTarget ? " paste-ready" : ""}${drop.isDragTarget ? " drop-ready" : ""}`}
      title={language === "en" ? "Select a glyph reference or hover and press Ctrl / Cmd + V" : "点击选择字体参考，或悬停后按 Ctrl / Cmd + V 粘贴图片"}
      onClick={onActivate}
      onPointerEnter={upload.onPointerEnter}
      onPointerLeave={upload.onPointerLeave}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={(event) => void drop.onDrop(event)}
    >
      <span className="custom-font-mark">Aa</span>
      <strong>{language === "en" ? "Custom glyph reference" : "自定义字体字形"}</strong>
      <small>{upload.message || drop.message || (language === "en" ? "Use a desaturated font image to learn glyphs and strokes." : "建议上传去色字体图，只学习字形与笔画")}</small>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload.onChange} disabled={disabled} />
      <AssetReusePicker language={language} assets={assets} kind="font-reference" onReuseAsset={onReuseAsset} disabled={disabled} onActivate={onActivate} />
    </label>
  );
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="status-card"><span>{title}</span><h3>{value}</h3><p>{detail}</p></article>;
}

function BackgroundOutputPreview({ language, assets, runningKind, onRegenerate }: { language: "zh" | "en"; assets: ProjectAsset[]; runningKind: BackgroundKind | "all" | ""; onRegenerate: (kind: BackgroundKind | "all") => Promise<void> }) {
  const isEnglish = language === "en";
  return (
    <section className="tool-output-preview background-output-preview" aria-label={isEnglish ? "Background output preview" : "背景产出预览"}>
      <div className="output-preview-heading"><div><p>OUTPUT</p><h3>{isEnglish ? "Sticker output · 1080 × 1920" : "贴片输出 · 1080 × 1920"}</h3></div></div>
      <div className="background-output-stage">
        <span className="background-output-size">1080 × 1920</span>
        {(["top", "bottom"] as BackgroundKind[]).map((kind) => {
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

async function renderSideStickerPng(settings: SideStickerSettings, images: { talentSrc: string; giftOneSrc: string; giftTwoSrc: string; backgroundSrc?: string }) {
  await Promise.all([
    document.fonts.load('700 16px "Douyin Sans"'),
    document.fonts.load('400 20px "Alibaba PuHuiTi 3.0"'),
    document.fonts.load('600 13px "MiSans"'),
  ]);
  const scale = 4;
  const width = 154;
  const height = settings.mode === "talent" ? 471 : 298;
  const boardTop = settings.mode === "talent" ? 173 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建侧贴画布。");
  context.scale(scale, scale);

  const [talent, giftOne, giftTwo, generatedBackground] = await Promise.all([
    loadCanvasImage(images.talentSrc),
    loadCanvasImage(images.giftOneSrc),
    loadCanvasImage(images.giftTwoSrc),
    images.backgroundSrc ? loadCanvasImage(images.backgroundSrc) : Promise.resolve(undefined),
  ]);
  if (settings.mode === "talent") drawContainedImage(context, talent, 0, 0, 140, 175, "cover");

  const backgroundCanvas = document.createElement("canvas");
  backgroundCanvas.width = 147 * scale;
  backgroundCanvas.height = 298 * scale;
  const backgroundContext = backgroundCanvas.getContext("2d");
  if (!backgroundContext) throw new Error("无法创建侧贴背景画布。");
  backgroundContext.scale(scale, scale);
  if (generatedBackground) {
    drawContainedImage(backgroundContext, generatedBackground, 0, 0, 147, 298, "cover");
    const overlay = backgroundContext.createLinearGradient(0, 0, 0, 298);
    overlay.addColorStop(0, hexToRgba(settings.primaryColor, .18));
    overlay.addColorStop(.42, hexToRgba(settings.primaryColor, .08));
    overlay.addColorStop(1, hexToRgba(settings.secondaryColor, .44));
    backgroundContext.fillStyle = overlay;
    backgroundContext.fillRect(0, 0, 147, 298);
  } else {
    const gradient = backgroundContext.createLinearGradient(0, 0, 0, 298);
    gradient.addColorStop(0, settings.primaryColor);
    gradient.addColorStop(.24, hexToRgba(settings.primaryColor, .7));
    gradient.addColorStop(.82, hexToRgba(settings.secondaryColor, .4));
    gradient.addColorStop(1, hexToRgba(settings.secondaryColor, .16));
    backgroundContext.fillStyle = gradient;
    backgroundContext.fillRect(0, 0, 147, 298);
  }
  backgroundContext.globalCompositeOperation = "destination-in";
  const alphaFade = backgroundContext.createLinearGradient(0, 0, 0, 298);
  alphaFade.addColorStop(0, "rgba(0,0,0,1)");
  alphaFade.addColorStop(.38, "rgba(0,0,0,.92)");
  alphaFade.addColorStop(.72, "rgba(0,0,0,.56)");
  alphaFade.addColorStop(1, "rgba(0,0,0,.08)");
  backgroundContext.fillStyle = alphaFade;
  backgroundContext.fillRect(0, 0, 147, 298);

  context.save();
  roundedRectPath(context, 7, boardTop, 147, 298, 17.4);
  context.clip();
  context.drawImage(backgroundCanvas, 7, boardTop, 147, 298);
  context.restore();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = adaptiveTextColor(settings.primaryColor, settings.primaryColor);
  context.font = '700 16px "Douyin Sans", "PingFang SC", sans-serif';
  context.fillText(settings.eyebrow, 80.5, boardTop + 13, 136);
  context.font = '400 20px "Alibaba PuHuiTi 3.0", "PingFang SC", sans-serif';
  context.fillText(settings.title, 80.5, boardTop + 36, 130);

  const cardTextColor = adaptiveTextColor("#f7f8f5", settings.primaryColor);
  drawGiftCard(context, { x: 23, y: boardTop + 53, width: 117, height: 88, image: giftOne, imageBox: { x: 40, y: boardTop + 53, width: 79, height: 64 }, label: settings.giftOneLabel, labelY: boardTop + 128, labelColor: cardTextColor });
  drawGiftCard(context, { x: 23, y: boardTop + 147, width: 117, height: 125, image: giftTwo, imageBox: { x: 33, y: boardTop + 159, width: 97, height: 103 }, label: settings.giftTwoLabel, labelY: boardTop + 259, labelColor: cardTextColor });

  const footerBackground = createVividAccent(settings.primaryColor);
  context.fillStyle = footerBackground;
  roundedRectPath(context, 23, boardTop + 279, 117, 18, 9);
  context.fill();
  context.fillStyle = adaptiveTextColor(footerBackground, settings.primaryColor);
  context.font = '600 12.8px "MiSans", "PingFang SC", sans-serif';
  context.fillText(settings.footer, 81.5, boardTop + 288, 108);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法导出侧贴 PNG。")), "image/png"));
}

function drawGiftCard(context: CanvasRenderingContext2D, options: { x: number; y: number; width: number; height: number; image: HTMLImageElement; imageBox: { x: number; y: number; width: number; height: number }; label: string; labelY: number; labelColor: string }) {
  context.fillStyle = "rgba(255,255,255,.9)";
  roundedRectPath(context, options.x, options.y, options.width, options.height, 9.3);
  context.fill();
  drawContainedImage(context, options.image, options.imageBox.x, options.imageBox.y, options.imageBox.width, options.imageBox.height, "contain");
  context.fillStyle = options.labelColor;
  context.font = '600 12.8px "MiSans", "PingFang SC", sans-serif';
  context.fillText(options.label, options.x + options.width / 2, options.labelY, options.width - 10);
}

function roundedRectPath(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

async function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("侧贴图片加载失败。"));
    image.src = src;
  });
}

function drawContainedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, mode: "contain" | "cover") {
  const imageAspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
  const boxAspect = width / Math.max(height, 1);
  const drawWidth = mode === "cover" ? (imageAspect > boxAspect ? width * (imageAspect / boxAspect) : width) : (imageAspect > boxAspect ? width : height * imageAspect);
  const drawHeight = mode === "cover" ? (imageAspect > boxAspect ? height : height * (boxAspect / imageAspect)) : (imageAspect > boxAspect ? width / imageAspect : height);
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

async function sampleAssetColor(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取颜色。");
  context.drawImage(bitmap, 0, 0, 24, 24);
  bitmap.close();
  const data = context.getImageData(0, 0, 24, 24).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha < .08) continue;
    const saturation = Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]);
    const pixelWeight = alpha * (.35 + saturation / 255);
    red += data[index] * pixelWeight;
    green += data[index + 1] * pixelWeight;
    blue += data[index + 2] * pixelWeight;
    weight += pixelWeight;
  }
  if (!weight) return "#47cde1";
  return rgbToHex(Math.round(red / weight), Math.round(green / weight), Math.round(blue / weight));
}

const BOTTOM_TYPOGRAPHY_TEXT = "让每个孩子拥有实验室";
const BOTTOM_TYPOGRAPHY_FONT = '"MF BoHeHaiYan"';

async function renderBottomTypographyAsset(assets: ProjectAsset[]) {
  await document.fonts.load(`400 120px ${BOTTOM_TYPOGRAPHY_FONT}`, BOTTOM_TYPOGRAPHY_TEXT);
  const latest = (kinds: ProjectAssetKind[]) => [...assets].reverse().find((asset) => kinds.includes(asset.kind));
  const surfaceAsset = latest(["bottom", "base-image"]);
  const themeAsset = latest(["top", "bottom", "reference", "side-background", "base-image"]);
  const surfaceColor = surfaceAsset ? await sampleAssetColor(surfaceAsset.blob) : "#f2d8de";
  const themeColor = themeAsset ? await sampleAssetColor(themeAsset.blob) : "#d44732";
  const vividColor = mixHex(createVividAccent(themeColor), "#071013", .14);
  const darkColor = mixHex(themeColor, "#071013", .82);
  const whiteColor = "#ffffff";
  const textColor = contrastRatio(surfaceColor, vividColor) >= 3
    ? vividColor
    : contrastRatio(surfaceColor, darkColor) >= contrastRatio(surfaceColor, whiteColor) ? darkColor : whiteColor;

  const scratch = document.createElement("canvas");
  scratch.width = 1200;
  scratch.height = 260;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法生成下贴文字图层。");

  const maximumWidth = 712;
  const maximumHeight = 138;
  let fontSize = 150;
  for (; fontSize >= 24; fontSize -= 1) {
    context.font = `400 ${fontSize}px ${BOTTOM_TYPOGRAPHY_FONT}`;
    const metrics = context.measureText(BOTTOM_TYPOGRAPHY_TEXT);
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (width <= maximumWidth && height <= maximumHeight) break;
  }

  context.clearRect(0, 0, scratch.width, scratch.height);
  context.font = `400 ${fontSize}px ${BOTTOM_TYPOGRAPHY_FONT}`;
  context.fillStyle = textColor;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(BOTTOM_TYPOGRAPHY_TEXT, scratch.width / 2, scratch.height / 2);
  const pixels = context.getImageData(0, 0, scratch.width, scratch.height);
  let minX = scratch.width;
  let minY = scratch.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < scratch.height; y += 1) {
    for (let x = 0; x < scratch.width; x += 1) {
      if (pixels.data[(y * scratch.width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("字体加载完成，但没有生成可见文字。");

  const padding = 6;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(scratch.width - cropX, maxX - cropX + 1 + padding);
  const cropHeight = Math.min(scratch.height - cropY, maxY - cropY + 1 + padding);
  const output = document.createElement("canvas");
  output.width = cropWidth;
  output.height = cropHeight;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("无法裁剪下贴文字图层。");
  outputContext.drawImage(scratch, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("无法导出下贴文字图层 PNG。")), "image/png"));
  return new File([blob], "下贴文字图层.png", { type: "image/png" });
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(first: string, second: string, amount: number) {
  const read = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const a = read(first);
  const b = read(second);
  return rgbToHex(...a.map((value, index) => Math.round(value + (b[index] - value) * amount)) as [number, number, number]);
}

function createVividAccent(hex: string) {
  const [red, green, blue] = readHex(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
    else if (max === green) hue = ((blue - red) / delta + 2) / 6;
    else hue = ((red - green) / delta + 4) / 6;
  }
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return hslToHex(hue, Math.max(.82, Math.min(1, saturation + .18)), Math.max(.48, Math.min(.58, lightness)));
}

function adaptiveTextColor(background: string, tone: string) {
  const light = mixHex(tone, "#ffffff", .9);
  const dark = mixHex(tone, "#071013", .86);
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + .05) / (Math.min(firstLuminance, secondLuminance) + .05);
}

function relativeLuminance(hex: string) {
  const channels = readHex(hex).map((value) => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function readHex(hex: string) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const channel = (offset: number) => {
    const value = (offset + hue * 12) % 12;
    const chroma = saturation * Math.min(lightness, 1 - lightness);
    return lightness - chroma * Math.max(-1, Math.min(value - 3, 9 - value, 1));
  };
  return rgbToHex(Math.round(channel(0) * 255), Math.round(channel(8) * 255), Math.round(channel(4) * 255));
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function assetLabel(kind: ProjectAssetKind, language: "zh" | "en") {
  if (language === "zh") return assetKindLabels[kind];
  return {
    reference: "Colour/material reference",
    "color-reference": "Typography colour/material reference",
    "font-reference": "Glyph reference",
    "layout-reference": "Layout text reference",
    "side-background": "Side sticker background",
    "side-gift": "Side sticker gift",
    "side-talent": "Side sticker talent",
    top: "Top sticker",
    bottom: "Bottom sticker",
    side: "Side sticker",
    "typography-draft": "Typography draft",
    typography: "Typography",
    "bottom-typography": "Bottom typography layer",
    "base-image": "Room background",
  }[kind];
}

const assetCategoryOrder = ["base-image", "top", "bottom", "side", "bottom-typography", "generation-reference", "typography-glyph-reference", "typography-color-reference", "typography-layout-reference", "side-content", "generated-typography"] as const;
type AssetCategory = typeof assetCategoryOrder[number];

function isColorMaterialReferenceAsset(asset: ProjectAsset) {
  return asset.kind !== "font-reference"
    && asset.kind !== "layout-reference"
    && asset.kind !== "typography-draft"
    && asset.kind !== "typography"
    && asset.kind !== "bottom-typography";
}

function assetCategoryFor(kind: ProjectAssetKind): AssetCategory {
  if (kind === "reference") return "generation-reference";
  if (kind === "font-reference") return "typography-glyph-reference";
  if (kind === "color-reference") return "typography-color-reference";
  if (kind === "layout-reference") return "typography-layout-reference";
  if (kind === "side-background" || kind === "side-gift" || kind === "side-talent") return "side-content";
  if (kind === "typography" || kind === "typography-draft") return "generated-typography";
  return kind;
}

function assetCategoryLabel(category: AssetCategory, language: "zh" | "en") {
  const labels: Record<AssetCategory, { zh: string; en: string }> = {
    "base-image": { zh: "直播间底图", en: "Room backgrounds" },
    top: { zh: "上贴", en: "Top stickers" },
    bottom: { zh: "下贴", en: "Bottom stickers" },
    side: { zh: "侧贴", en: "Side stickers" },
    "bottom-typography": { zh: "下贴文字图层", en: "Bottom typography layers" },
    "generation-reference": { zh: "生图参考", en: "Generation references" },
    "typography-glyph-reference": { zh: "文字字形参考", en: "Typography glyph references" },
    "typography-color-reference": { zh: "文字颜色质感参考", en: "Typography colour / material references" },
    "typography-layout-reference": { zh: "文字排版参考", en: "Typography layout references" },
    "side-content": { zh: "侧贴内容素材", en: "Side sticker content" },
    "generated-typography": { zh: "生成的文字图层", en: "Generated typography" },
  };
  return labels[category][language];
}

async function renderCompositionPreview(composition: CompositionDocument, assets: ProjectAsset[]) {
  const canvas = document.createElement("canvas");
  canvas.width = COMPOSITION_OUTPUT.width;
  canvas.height = COMPOSITION_OUTPUT.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建效果融合预览图。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const visibleLayers = composition.layers
    .filter((layer) => layer.visible)
    .slice()
    .sort((first, second) => first.zIndex - second.zIndex);

  for (const layer of visibleLayers) {
    const asset = assets.find((item) => item.id === layer.assetId);
    if (!asset) continue;
    const bitmap = await createImageBitmap(asset.blob);
    const layerCanvas = document.createElement("canvas");
    layerCanvas.width = COMPOSITION_OUTPUT.width;
    layerCanvas.height = COMPOSITION_OUTPUT.height;
    const layerContext = layerCanvas.getContext("2d");
    if (!layerContext) {
      bitmap.close();
      throw new Error("无法渲染效果融合图层。");
    }
    layerContext.imageSmoothingEnabled = true;
    layerContext.imageSmoothingQuality = "high";

    if (layer.kind === "base-image") {
      const drawHeight = COMPOSITION_OUTPUT.height;
      const drawWidth = drawHeight * (bitmap.width / Math.max(bitmap.height, 1));
      layerContext.drawImage(bitmap, (COMPOSITION_OUTPUT.width - drawWidth) / 2, 0, drawWidth, drawHeight);
    } else {
      const box = {
        x: (layer.x / 100) * COMPOSITION_OUTPUT.width,
        y: (layer.y / 100) * COMPOSITION_OUTPUT.height,
        width: (layer.width / 100) * COMPOSITION_OUTPUT.width,
        height: (layer.height / 100) * COMPOSITION_OUTPUT.height,
      };
      drawContainedSource(layerContext, bitmap, box.x, box.y, box.width, box.height);
      if (layer.kind === "top" || layer.kind === "bottom") applyLayerMask(layerContext, layer, box);
    }
    bitmap.close();
    context.save();
    context.globalAlpha = layer.opacity / 100;
    context.drawImage(layerCanvas, 0, 0);
    context.restore();
  }

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法导出效果融合预览图。")), "image/png"));
}

function drawContainedSource(context: CanvasRenderingContext2D, source: ImageBitmap, x: number, y: number, width: number, height: number) {
  const imageAspect = source.width / Math.max(source.height, 1);
  const boxAspect = width / Math.max(height, 1);
  const drawWidth = imageAspect > boxAspect ? width : height * imageAspect;
  const drawHeight = imageAspect > boxAspect ? width / imageAspect : height;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  context.restore();
}

function applyLayerMask(context: CanvasRenderingContext2D, layer: CompositionLayer, box: { x: number; y: number; width: number; height: number }) {
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return;
  const fallbackY = layer.kind === "top" ? layer.y + layer.height * .72 : layer.y + layer.height * .28;
  const source = layer.mask.fadePath.length > 1 ? layer.mask.fadePath : defaultFadeLine(fallbackY, layer.x, layer.x + layer.width);
  const points = normalizeFadePath(source, layer)
    .map((point) => ({ x: ((point.x - layer.x) / layer.width) * width, y: ((point.y - layer.y) / layer.height) * height }))
    .sort((first, second) => first.x - second.x);
  const feather = Math.max(1, (height * layer.mask.feather) / 520);
  const alpha = maskContext.createImageData(width, height);
  for (let x = 0; x < width; x += 1) {
    const boundary = boundaryYAt(points, x);
    for (let y = 0; y < height; y += 1) {
      const distance = layer.kind === "top" ? boundary - y : y - boundary;
      const index = (y * width + x) * 4;
      alpha.data[index] = 255;
      alpha.data[index + 1] = 255;
      alpha.data[index + 2] = 255;
      alpha.data[index + 3] = smoothMaskAlpha(distance, feather);
    }
  }
  maskContext.putImageData(alpha, 0, 0);
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.drawImage(maskCanvas, box.x, box.y, box.width, box.height);
  context.restore();
}

async function makeProjectZip(assets: ProjectAsset[], language: "zh" | "en", composition: CompositionDocument, projectAssets: ProjectAsset[]) {
  const usedNames = new Map<string, number>();
  const files = await Promise.all(assets.map(async (asset, index) => {
    const compositionLayer = composition.layers.find((layer) => layer.visible && layer.kind !== "base-image" && layer.assetId === asset.id);
    const exportAsPng = Boolean(compositionLayer) || isStickerLayerAsset(asset.kind);
    const blob = compositionLayer ? await renderCompositionLayerPng(compositionLayer, asset) : exportAsPng ? await convertAssetToPng(asset.blob) : asset.blob;
    const extension = exportAsPng ? "png" : extensionForAsset(asset);
    const compositionFileName = compositionLayer ? `${assetLabel(compositionLayer.kind, language)}.png` : undefined;
    return {
      name: uniqueZipName(asset.kind === "bottom-typography" ? "下贴文字图层.png" : compositionFileName ?? `${String(index + 1).padStart(2, "0")}-${assetLabel(asset.kind, language)}-${stripFileExtension(asset.fileName || asset.kind)}.${extension}`, usedNames),
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  }));
  const preview = await renderCompositionPreview(composition, projectAssets);
  files.push({ name: "效果融合预览图.png", bytes: new Uint8Array(await preview.arrayBuffer()) });
  const manifest = {
    exportedAt: new Date().toISOString(),
    outputSize: COMPOSITION_OUTPUT,
    previewFileName: "效果融合预览图.png",
    visibleCompositionLayers: composition.layers.filter((layer) => layer.visible).map((layer) => ({ kind: layer.kind, assetId: layer.assetId, opacity: layer.opacity, zIndex: layer.zIndex })),
    assets: assets.map((asset) => {
      const compositionLayer = composition.layers.find((layer) => layer.visible && layer.kind !== "base-image" && layer.assetId === asset.id);
      return {
        id: asset.id,
        kind: asset.kind,
        label: assetLabel(asset.kind, language),
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        trimmed: asset.trimmed,
        alphaBakedFromComposition: Boolean(compositionLayer),
        createdAt: asset.createdAt,
      };
    }),
  };
  files.push({ name: "project-manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return new Blob([createStoredZip(files)], { type: "application/zip" });
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "");
}

async function convertAssetToPng(blob: Blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("无法转换贴片 PNG 图层。");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法转换贴片 PNG 图层。")), "image/png"));
}

function isStickerLayerAsset(kind: ProjectAssetKind) {
  return kind === "top" || kind === "bottom" || kind === "side" || kind === "typography" || kind === "bottom-typography";
}

async function renderCompositionLayerPng(layer: CompositionLayer, asset: ProjectAsset) {
  const width = Math.max(1, Math.round((layer.width / 100) * COMPOSITION_OUTPUT.width));
  const height = Math.max(1, Math.round((layer.height / 100) * COMPOSITION_OUTPUT.height));
  const bitmap = await createImageBitmap(asset.blob);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    bitmap.close();
    throw new Error("无法生成带透明度的贴片 PNG 图层。");
  }
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.imageSmoothingQuality = "high";
  drawContainedSource(sourceContext, bitmap, 0, 0, width, height);
  bitmap.close();
  if (layer.kind === "top" || layer.kind === "bottom") applyLayerMask(sourceContext, layer, { x: 0, y: 0, width, height });

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("无法生成带透明度的贴片 PNG 图层。");
  outputContext.globalAlpha = layer.opacity / 100;
  outputContext.drawImage(sourceCanvas, 0, 0);
  return new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("无法导出带透明度的贴片 PNG 图层。")), "image/png"));
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
  const blob = result.url.startsWith("data:")
    ? dataUrlToBlob(result.url, result.mimeType)
    : await fetchResultBlob(result.url);
  return new File([blob], result.fileName || fallbackName, { type: result.mimeType || blob.type || "image/png" });
}

async function fetchResultBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Core image returned ${response.status}.`);
  return response.blob();
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType = "image/png") {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/s);
  if (!match) throw new Error("Core returned an invalid image data URL.");
  const mimeType = match[1] || fallbackMimeType;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function assetReference(asset: ProjectAsset): Promise<ImageReferenceInput> {
  const preserveAlpha = asset.kind === "typography" || asset.kind === "typography-draft";
  const blob = await resizeReference(asset.blob, preserveAlpha);
  return { assetId: asset.id, mimeType: blob.type, dataUrl: await blobToDataUrl(blob) };
}

async function colorReference(asset: ProjectAsset): Promise<ImageReferenceInput> {
  const blob = await resizeReference(asset.blob, false, "image/jpeg");
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
    const maxDimension = 1024;
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
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("字体参考去色失败。")), "image/jpeg", 0.78));
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
    const maxDimension = preserveAlpha ? 1536 : 1024;
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
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("参考图片压缩失败。")), mimeType, mimeType === "image/jpeg" ? 0.78 : 0.86));
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
