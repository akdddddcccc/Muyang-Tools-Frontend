import "./tools-home.css";

type Language = "zh" | "en";
type ToolId = "live-sticker" | "task-map";

const toolCards: Array<{
  id: ToolId;
  index: string;
  title: string;
  englishTitle: string;
  caption: string;
  englishCaption: string;
  meta: string;
  icon: string;
}> = [
  {
    id: "live-sticker",
    index: "01",
    title: "AI 直播间视觉工作台",
    englishTitle: "AI Live Sticker Studio",
    caption: "参考图、文字图层、上下侧贴与融合画板",
    englishCaption: "References, typography, stickers and composition",
    meta: "LIVE VISUAL",
    icon: `${import.meta.env.BASE_URL}assets/tool-icons/live-sticker.svg`,
  },
  {
    id: "task-map",
    index: "02",
    title: "AI 任务甘特图工作台",
    englishTitle: "AI Task Gantt Studio",
    caption: "先拆逻辑关系，再进入时间初排",
    englishCaption: "Structure first, then timeline planning",
    meta: "TASK MAP",
    icon: `${import.meta.env.BASE_URL}assets/tool-icons/task-map.svg`,
  },
];

function ToolCardVisual({ toolId }: { toolId: ToolId }) {
  if (toolId === "live-sticker") {
    return (
      <svg className="tools-home-card-visual" viewBox="0 0 520 210" aria-hidden="true">
        <defs>
          <linearGradient id="live-frame-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7bf89c" stopOpacity=".42" />
            <stop offset=".5" stopColor="#7fcfff" stopOpacity=".1" />
            <stop offset="1" stopColor="#7bf89c" stopOpacity=".03" />
          </linearGradient>
          <linearGradient id="live-sticker-fill" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#7fcfff" stopOpacity=".7" />
            <stop offset="1" stopColor="#7bf89c" stopOpacity=".28" />
          </linearGradient>
        </defs>
        <g className="visual-flow-lines" fill="none" stroke="#7bf89c" strokeWidth="1.5">
          <path d="M70 48 C142 48 150 56 216 72" />
          <path d="M70 104 C142 104 156 104 216 104" />
          <path d="M70 160 C142 160 150 150 216 136" />
        </g>
        <g className="visual-source-nodes">
          <rect x="24" y="31" width="48" height="34" rx="8" />
          <rect x="24" y="87" width="48" height="34" rx="8" />
          <rect x="24" y="143" width="48" height="34" rx="8" />
          <path d="M34 54l9-9 7 6 8-11 5 14H34z" />
          <path d="M35 104h26M39 97h18M42 111h12" />
          <path d="M35 166c7-13 15-13 25 0" />
        </g>
        <g className="visual-live-frame">
          <rect x="214" y="16" width="112" height="178" rx="14" fill="url(#live-frame-fill)" />
          <rect x="224" y="27" width="92" height="156" rx="9" />
          <path d="M224 27h92v43c-24-14-61-13-92 4V27z" fill="url(#live-sticker-fill)" />
          <path d="M224 142c29-12 64-8 92 8v33h-92v-41z" fill="url(#live-sticker-fill)" opacity=".72" />
          <rect x="286" y="80" width="23" height="64" rx="8" fill="#7bf89c" fillOpacity=".18" stroke="#7bf89c" strokeOpacity=".58" />
          <circle cx="270" cy="104" r="21" />
          <path d="M250 151h38" />
          <path d="M235 40h30" />
        </g>
        <g className="visual-output-mark">
          <circle cx="402" cy="103" r="34" />
          <path d="M388 103h28M405 91l12 12-12 12" />
          <text x="402" y="157" textAnchor="middle">1080 × 1920</text>
        </g>
      </svg>
    );
  }

  return (
    <svg className="tools-home-card-visual" viewBox="0 0 520 210" aria-hidden="true">
      <defs>
        <linearGradient id="task-bar-fill" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#7fcfff" stopOpacity=".52" />
          <stop offset="1" stopColor="#7bf89c" stopOpacity=".72" />
        </linearGradient>
      </defs>
      <g className="visual-task-links" fill="none" stroke="#7bf89c" strokeWidth="1.5">
        <path d="M55 104 C94 104 94 53 137 53" />
        <path d="M55 104 C94 104 94 104 137 104" />
        <path d="M55 104 C94 104 94 155 137 155" />
        <path d="M187 53 C224 53 224 80 258 80" />
        <path d="M187 104 C224 104 224 104 258 104" />
        <path d="M187 155 C224 155 224 130 258 130" />
      </g>
      <g className="visual-task-nodes">
        <rect x="24" y="82" width="34" height="44" rx="9" />
        <rect x="136" y="36" width="52" height="34" rx="8" />
        <rect x="136" y="87" width="52" height="34" rx="8" />
        <rect x="136" y="138" width="52" height="34" rx="8" />
        <circle cx="41" cy="104" r="5" />
        <circle cx="162" cy="53" r="4" />
        <circle cx="162" cy="104" r="4" />
        <circle cx="162" cy="155" r="4" />
      </g>
      <g className="visual-gantt-panel">
        <rect x="256" y="24" width="226" height="162" rx="13" />
        <path d="M278 51h180M278 85h180M278 119h180M278 153h180" />
        <path d="M316 38v132M362 38v132M408 38v132" opacity=".38" />
        <rect x="278" y="61" width="78" height="10" rx="5" fill="url(#task-bar-fill)" />
        <rect x="328" y="95" width="104" height="10" rx="5" fill="url(#task-bar-fill)" />
        <rect x="380" y="129" width="78" height="10" rx="5" fill="url(#task-bar-fill)" />
        <circle cx="361" cy="66" r="3" />
        <circle cx="437" cy="100" r="3" />
      </g>
    </svg>
  );
}

export function ToolsHome({
  language,
  onLanguageChange,
  onOpenTool,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
  onOpenTool: (tool: ToolId) => void;
}) {
  const isEnglish = language === "en";

  return (
    <main className="tools-home-shell">
      <header className="tools-home-topbar">
        <div className="tools-home-lockup" aria-label="MUYANG">
          <img src={`${import.meta.env.BASE_URL}assets/portfolio-icon.svg`} alt="muyang23333.top" />
        </div>
        <div className="tools-home-language" aria-label="Language">
          <button className={language === "zh" ? "selected" : ""} type="button" onClick={() => onLanguageChange("zh")}>中</button>
          <button className={language === "en" ? "selected" : ""} type="button" onClick={() => onLanguageChange("en")}>EN</button>
        </div>
      </header>

      <section className="tools-home-hero">
        <p>{isEnglish ? "MUYANG TOOLKIT" : "MUYANG 工具集"}</p>
        <h1>{isEnglish ? "Small, focused AI workbenches." : "把高频创意工作，拆成可操作的小工具。"}</h1>
        <span>{isEnglish ? "Choose a workbench below. Each tool can run independently and share the same Core service." : "选择下方工作台。每个工具都可以独立使用，也可以共用同一套 Core 服务。"}</span>
      </section>

      <section className="tools-home-grid" aria-label={isEnglish ? "Tools" : "工具入口"}>
        {toolCards.map((tool) => (
          <button className={`tools-home-card ${tool.id}`} type="button" key={tool.id} onClick={() => onOpenTool(tool.id)}>
            <div className="tools-home-card-topline">
              <span><i />{tool.meta}</span>
              <em>{tool.index}</em>
            </div>
            <ToolCardVisual toolId={tool.id} />
            <div className="tools-home-card-copy">
              <div>
                <div className="tools-home-card-title">
                  <span className="tools-home-card-icon" style={{ WebkitMaskImage: `url("${tool.icon}")`, maskImage: `url("${tool.icon}")` }} aria-hidden="true" />
                  <b>{isEnglish ? tool.englishTitle : tool.title}</b>
                </div>
                <small>{isEnglish ? tool.englishCaption : tool.caption}</small>
              </div>
              <span className="tools-home-card-cta">{isEnglish ? "Open studio" : "进入工作台"}<i>↗</i></span>
            </div>
          </button>
        ))}
      </section>
    </main>
  );
}
