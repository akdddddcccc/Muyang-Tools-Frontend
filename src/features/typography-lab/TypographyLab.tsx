import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createTypographyJob,
  cutoutTypography,
  fetchCoreHealth,
  materializeTypography,
  type ImageReferenceInput,
  type TypographyGenerationJob,
  type TypographyPlacement,
} from "../../lib/core-api";
import "./typography-lab.css";

type LabStatus = "checking" | "ready" | "generating" | "adapting" | "error";
type PlacementInteraction = {
  type: "drag" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  placement: TypographyPlacement;
};

const initialPlacement: TypographyPlacement = { x: 0.12, y: 0.38, width: 0.76, height: 0.2 };

export function TypographyLab() {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState("");
  const [posterAspect, setPosterAspect] = useState(9 / 16);
  const [text, setText] = useState("新品首发\n限时开启");
  const [status, setStatus] = useState<LabStatus>("checking");
  const [message, setMessage] = useState("正在检查实验 Core…");
  const [sourceDraftUrl, setSourceDraftUrl] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [transparentUrl, setTransparentUrl] = useState("");
  const [placement, setPlacement] = useState<TypographyPlacement>(initialPlacement);
  const [isPasteTarget, setIsPasteTarget] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Pick<TypographyGenerationJob, "renderStrategy" | "appliedPalette" | "analysisSummary">>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const compositeRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<PlacementInteraction | null>(null);

  useEffect(() => {
    fetchCoreHealth()
      .then(() => { setStatus("ready"); setMessage("实验 Core 已连接"); })
      .catch((error) => { setStatus("error"); setMessage(error instanceof Error ? error.message : "实验 Core 不可用"); });
  }, []);

  useEffect(() => () => {
    if (referencePreview) URL.revokeObjectURL(referencePreview);
  }, [referencePreview]);

  const isBusy = status === "checking" || status === "generating" || status === "adapting";
  const canGenerate = !isBusy && Boolean(referenceFile && text.trim());
  const canAdapt = !isBusy && Boolean(referenceFile && sourceDraftUrl && transparentUrl);
  const profile = diagnostics.analysisSummary;
  const profileText = useMemo(() => {
    if (!profile) return [];
    const items: string[] = [];
    if (profile.brightness != null) items.push(`亮度 ${Math.round(profile.brightness * 100)}%`);
    if (profile.saturation != null) items.push(`饱和度 ${Math.round(profile.saturation * 100)}%`);
    if (profile.contrast != null) items.push(`对比度 ${Math.round(profile.contrast * 100)}%`);
    if (profile.averageLuminanceDistance != null) items.push(`平均局部明度差 ${Math.round(profile.averageLuminanceDistance * 100)}%`);
    if (profile.minimumLuminanceDistance != null) items.push(`最低局部明度差 ${Math.round(profile.minimumLuminanceDistance * 100)}%`);
    if (profile.sampledRegions != null) items.push(`局部采样 ${profile.sampledRegions} 区`);
    return items;
  }, [profile]);

  const chooseReference = (file?: File) => {
    if (!file?.type.startsWith("image/")) return;
    const preview = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setPosterAspect(image.naturalWidth / image.naturalHeight);
    image.src = preview;
    setReferenceFile(file);
    setReferencePreview(preview);
    setSourceDraftUrl("");
    setDraftUrl("");
    setTransparentUrl("");
    setPlacement(initialPlacement);
    setDiagnostics({});
    setMessage("参考图已就绪，可以生成无色字形母版");
    setStatus("ready");
  };

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      if (!isPasteTarget) return;
      const image = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"))?.getAsFile();
      if (!image) return;
      event.preventDefault();
      chooseReference(image);
    };
    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, [isPasteTarget]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseReference(event.target.files?.[0]);
    event.target.value = "";
  };

  const generate = async () => {
    if (!referenceFile || !text.trim()) return;
    setStatus("generating");
    setMessage("正在学习字形并生成无色母版…");
    setSourceDraftUrl("");
    setDraftUrl("");
    setTransparentUrl("");
    setPlacement(initialPlacement);
    try {
      const reference = await imageReference(referenceFile);
      const job = await createTypographyJob({
        text,
        fontPresetKey: "custom-reference",
        mode: "create",
        matte: "white",
        studyPoster: true,
        deferMaterial: true,
        references: { color: reference },
      });
      if (job.status === "failed") throw new Error(job.error?.message || "文字实验生成失败。");
      if (!job.result?.url) throw new Error("实验 Core 没有返回文字图层。");
      setSourceDraftUrl(job.result.url);
      setDraftUrl(job.result.url);
      setDiagnostics({ renderStrategy: job.renderStrategy, appliedPalette: job.appliedPalette, analysisSummary: job.analysisSummary });
      setMessage("正在抠除母版实底…");
      const cutout = await cutoutTypography({ mimeType: "image/png", dataUrl: job.result.url });
      setTransparentUrl(cutout.result.url);
      setStatus("ready");
      setMessage("请拖动文字并用右下角调整大小，确定位置后再适配颜色");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "文字实验生成失败。");
    }
  };

  const adaptAtPlacement = async () => {
    if (!referenceFile || !sourceDraftUrl) return;
    setStatus("adapting");
    setMessage("正在读取文字实际覆盖区域并逐区适配颜色…");
    try {
      const background = await imageReference(referenceFile);
      const job = await materializeTypography({
        image: { mimeType: "image/png", dataUrl: sourceDraftUrl },
        background,
        matte: "white",
        placement,
      });
      if (!job.result?.url) throw new Error("实验 Core 没有返回局部上色结果。");
      setDraftUrl(job.result.url);
      setDiagnostics({ renderStrategy: job.renderStrategy, appliedPalette: job.appliedPalette, analysisSummary: job.analysisSummary });
      const cutout = await cutoutTypography({ mimeType: "image/png", dataUrl: job.result.url });
      setTransparentUrl(cutout.result.url);
      setStatus("ready");
      setMessage("已按当前位置逐区上色；移动后可再次适配，不会重新调用生图模型");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "局部颜色适配失败。");
    }
  };

  const beginPlacement = (event: ReactPointerEvent<HTMLElement>, type: PlacementInteraction["type"]) => {
    if (!transparentUrl) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = { type, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, placement };
    const overlay = event.currentTarget.closest(".poster-type") as HTMLElement | null;
    overlay?.setPointerCapture(event.pointerId);
  };

  const movePlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    const stage = compositeRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = (event.clientX - interaction.startX) / rect.width;
    const dy = (event.clientY - interaction.startY) / rect.height;
    if (interaction.type === "drag") {
      setPlacement({
        ...interaction.placement,
        x: clamp(interaction.placement.x + dx, 0, 1 - interaction.placement.width),
        y: clamp(interaction.placement.y + dy, 0, 1 - interaction.placement.height),
      });
      return;
    }
    setPlacement({
      ...interaction.placement,
      width: clamp(interaction.placement.width + dx, 0.08, 1 - interaction.placement.x),
      height: clamp(interaction.placement.height + dy, 0.05, 1 - interaction.placement.y),
    });
  };

  const endPlacement = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
  };

  return (
    <main className="typography-lab">
      <header className="typography-lab-header">
        <div><p>FUNCTION TEST / TYPOGRAPHY</p><h1>文字图层一致性实验室</h1></div>
        <a href={`${import.meta.env.BASE_URL}`}>返回完整测试平台</a>
      </header>

      <section className="typography-lab-grid">
        <div className="typography-lab-inputs">
          <button
            className={`poster-upload${referencePreview ? " ready" : ""}${isPasteTarget ? " paste-ready" : ""}`}
            type="button"
            title="悬停后按 Ctrl / Cmd + V 粘贴图片"
            onPointerEnter={() => setIsPasteTarget(true)}
            onPointerLeave={() => setIsPasteTarget(false)}
            onClick={() => inputRef.current?.click()}
          >
            {referencePreview ? <img src={referencePreview} alt="成品海报参考" /> : <span>上传成品海报或直播背景参考</span>}
            <small>{isPasteTarget ? "按 Ctrl / Cmd + V 粘贴图片" : referenceFile?.name || "点击选择一张图片"}</small>
          </button>
          <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileChange} />

          <label className="lab-text-input"><span>目标文字</span><textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} /></label>

          <button className="lab-generate" type="button" disabled={!canGenerate} onClick={() => void generate()}>
            {status === "generating" ? "生成母版中…" : "生成无色文字母版"}
          </button>
          <button className="lab-adapt" type="button" disabled={!canAdapt} onClick={() => void adaptAtPlacement()}>
            {status === "adapting" ? "适配中…" : "按当前位置适配颜色"}
          </button>
          <p className={`lab-message ${status}`}>{message}</p>

          {diagnostics.appliedPalette || profileText.length ? (
            <div className="lab-diagnostics">
              <p>本轮算法摘要</p>
              {diagnostics.appliedPalette ? <div className="palette-row">
                <span style={{ background: diagnostics.appliedPalette.primary }} /><code>{diagnostics.appliedPalette.primary}</code>
                <span style={{ background: diagnostics.appliedPalette.accent }} /><code>{diagnostics.appliedPalette.accent}</code>
              </div> : null}
              <div className="profile-row">{profileText.map((item) => <span key={item}>{item}</span>)}</div>
              <small>{diagnostics.renderStrategy || "等待渲染策略"}</small>
            </div>
          ) : null}
        </div>

        <div className="typography-lab-results">
          <section>
            <p>定位与融合预览</p>
            <div ref={compositeRef} className="poster-composite" style={{ aspectRatio: posterAspect }}>
              {referencePreview ? <img className="poster-base" src={referencePreview} alt="原始海报" /> : <span>上传参考图后显示</span>}
              {transparentUrl ? <div
                className="poster-type"
                style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, height: `${placement.height * 100}%` }}
                onPointerDown={(event) => beginPlacement(event, "drag")}
                onPointerMove={movePlacement}
                onPointerUp={endPlacement}
                onPointerCancel={endPlacement}
              >
                <img src={transparentUrl} alt="透明文字图层" draggable={false} />
                <button className="poster-type-resize" type="button" title="拖动调整文字大小" onPointerDown={(event) => beginPlacement(event, "resize")} />
              </div> : null}
            </div>
          </section>
          <section>
            <p>算法实底稿</p>
            <div className="draft-preview">{draftUrl ? <img src={draftUrl} alt="文字实底稿" /> : <span>先生成无色母版，再按位置上色</span>}</div>
          </section>
        </div>
      </section>
    </main>
  );
}

async function imageReference(file: File): Promise<ImageReferenceInput> {
  const blob = await resizeAsPng(file);
  return { mimeType: "image/png", dataUrl: await blobToDataUrl(blob) };
}

async function resizeAsPng(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("无法读取参考图片。"));
      element.src = url;
    });
    const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理参考图片。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("参考图片转换失败。")), "image/png"));
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
