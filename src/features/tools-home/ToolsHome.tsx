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
}> = [
  {
    id: "live-sticker",
    index: "1",
    title: "AI 直播间视觉工作台",
    englishTitle: "AI Live Sticker Studio",
    caption: "参考图、文字图层、上下侧贴与融合画板",
    englishCaption: "References, typography, stickers and composition",
    meta: "LIVE VISUAL",
  },
  {
    id: "task-map",
    index: "2",
    title: "AI 任务甘特图工作台",
    englishTitle: "AI Task Gantt Studio",
    caption: "先拆逻辑关系，再进入时间初排",
    englishCaption: "Structure first, then timeline planning",
    meta: "TASK MAP",
  },
];

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
        <div className="tools-home-lockup" aria-label="MUYANG x NOBOOK">
          <img src={`${import.meta.env.BASE_URL}assets/portfolio-icon.svg`} alt="muyang23333.top" />
          <span>×</span>
          <img src={`${import.meta.env.BASE_URL}assets/fav.svg`} alt="cmuyang23333.top" />
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
            <span>{tool.meta}</span>
            <strong>{tool.index}</strong>
            <b>{isEnglish ? tool.englishTitle : tool.title}</b>
            <small>{isEnglish ? tool.englishCaption : tool.caption}</small>
          </button>
        ))}
      </section>
    </main>
  );
}
