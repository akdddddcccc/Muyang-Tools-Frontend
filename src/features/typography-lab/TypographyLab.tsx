import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createTypographyJob, cutoutTypography, fetchCoreHealth, type ImageReferenceInput, type TypographyGenerationJob } from "../../lib/core-api";
import "./typography-lab.css";

type LabStatus = "checking" | "ready" | "generating" | "error";

export function TypographyLab() {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState("");
  const [text, setText] = useState("新品首发\n限时开启");
  const [status, setStatus] = useState<LabStatus>("checking");
  const [message, setMessage] = useState("正在检查实验 Core…");
  const [draftUrl, setDraftUrl] = useState("");
  const [transparentUrl, setTransparentUrl] = useState("");
  const [diagnostics, setDiagnostics] = useState<Pick<TypographyGenerationJob, "renderStrategy" | "appliedPalette" | "analysisSummary">>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCoreHealth()
      .then(() => { setStatus("ready"); setMessage("实验 Core 已连接"); })
      .catch((error) => { setStatus("error"); setMessage(error instanceof Error ? error.message : "实验 Core 不可用"); });
  }, []);

  useEffect(() => () => {
    if (referencePreview) URL.revokeObjectURL(referencePreview);
  }, [referencePreview]);

  const canGenerate = status !== "checking" && status !== "generating" && Boolean(referenceFile && text.trim());
  const profile = diagnostics.analysisSummary;
  const profileText = useMemo(() => profile ? [
    `亮度 ${Math.round(profile.brightness * 100)}%`,
    `饱和度 ${Math.round(profile.saturation * 100)}%`,
    `对比度 ${Math.round(profile.contrast * 100)}%`,
  ] : [], [profile]);

  const chooseReference = (file?: File) => {
    if (!file?.type.startsWith("image/")) return;
    setReferenceFile(file);
    setReferencePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setDraftUrl("");
    setTransparentUrl("");
    setDiagnostics({});
    setMessage("参考图已就绪，可以生成");
    setStatus("ready");
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseReference(event.target.files?.[0]);
    event.target.value = "";
  };

  const generate = async () => {
    if (!referenceFile || !text.trim()) return;
    setStatus("generating");
    setMessage("正在学习海报并生成灰度字形母版…");
    setDraftUrl("");
    setTransparentUrl("");
    try {
      const reference = await imageReference(referenceFile);
      const job = await createTypographyJob({
        text,
        fontPresetKey: "custom-reference",
        mode: "create",
        matte: "white",
        studyPoster: true,
        references: { color: reference },
      });
      if (job.status === "failed") throw new Error(job.error?.message || "文字实验生成失败。");
      if (!job.result?.url) throw new Error("实验 Core 没有返回文字图层。");
      setDraftUrl(job.result.url);
      setDiagnostics({ renderStrategy: job.renderStrategy, appliedPalette: job.appliedPalette, analysisSummary: job.analysisSummary });
      setMessage("正在抠除实底并叠加到原图预览…");
      const cutout = await cutoutTypography({ mimeType: "image/png", dataUrl: job.result.url });
      setTransparentUrl(cutout.result.url);
      setStatus("ready");
      setMessage("生成完成：请比较融合预览与实底稿");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "文字实验生成失败。");
    }
  };

  return (
    <main className="typography-lab">
      <header className="typography-lab-header">
        <div>
          <p>FUNCTION TEST / TYPOGRAPHY</p>
          <h1>文字图层一致性实验室</h1>
        </div>
        <a href={`${import.meta.env.BASE_URL}`}>返回完整测试平台</a>
      </header>

      <section className="typography-lab-grid">
        <div className="typography-lab-inputs">
          <button className={`poster-upload${referencePreview ? " ready" : ""}`} type="button" onClick={() => inputRef.current?.click()}>
            {referencePreview ? <img src={referencePreview} alt="成品海报参考" /> : <span>上传成品海报或直播背景参考</span>}
            <small>{referenceFile?.name || "点击选择一张图片"}</small>
          </button>
          <input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={onFileChange} />

          <label className="lab-text-input">
            <span>目标文字</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} />
          </label>

          <button className="lab-generate" type="button" disabled={!canGenerate} onClick={() => void generate()}>
            {status === "generating" ? "生成中…" : "学习参考并生成文字"}
          </button>
          <p className={`lab-message ${status}`}>{message}</p>

          {diagnostics.appliedPalette ? (
            <div className="lab-diagnostics">
              <p>本轮算法摘要</p>
              <div className="palette-row">
                <span style={{ background: diagnostics.appliedPalette.primary }} />
                <code>{diagnostics.appliedPalette.primary}</code>
                <span style={{ background: diagnostics.appliedPalette.accent }} />
                <code>{diagnostics.appliedPalette.accent}</code>
              </div>
              <div className="profile-row">{profileText.map((item) => <span key={item}>{item}</span>)}</div>
              <small>{diagnostics.renderStrategy || "等待渲染策略"}</small>
            </div>
          ) : null}
        </div>

        <div className="typography-lab-results">
          <section>
            <p>融合预览</p>
            <div className="poster-composite">
              {referencePreview ? <img className="poster-base" src={referencePreview} alt="原始海报" /> : <span>上传参考图后显示</span>}
              {transparentUrl ? <img className="poster-type" src={transparentUrl} alt="透明文字图层" /> : null}
            </div>
          </section>
          <section>
            <p>算法实底稿</p>
            <div className="draft-preview">{draftUrl ? <img src={draftUrl} alt="文字实底稿" /> : <span>生成后显示灰度母版上色结果</span>}</div>
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
