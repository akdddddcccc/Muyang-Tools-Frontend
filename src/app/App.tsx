import { useEffect, useState } from "react";
import { LiveStickerWorkspace } from "../features/live-sticker/LiveStickerWorkspace";
import { TaskMapWorkspace } from "../features/task-map/TaskMapWorkspace";
import { ToolsHome } from "../features/tools-home/ToolsHome";

type WorkspaceId = "home" | "live-sticker" | "task-map";

function workspaceFromLocation(): WorkspaceId {
  if (window.location.pathname.includes("/task-map")) return "task-map";
  if (window.location.pathname.includes("/live-sticker")) return "live-sticker";
  return "home";
}

export function App() {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [workspace, setWorkspace] = useState<WorkspaceId>(workspaceFromLocation);
  const desktopTaskMap = Boolean(window.taskMapDesktop) || import.meta.env.VITE_DESKTOP_TASK_MAP === "true";

  useEffect(() => {
    const syncWorkspace = () => setWorkspace(workspaceFromLocation());
    window.addEventListener("popstate", syncWorkspace);
    return () => window.removeEventListener("popstate", syncWorkspace);
  }, []);

  const openWorkspace = (nextWorkspace: WorkspaceId) => {
    setWorkspace(nextWorkspace);
    const nextPath = nextWorkspace === "task-map" ? "/task-map/" : nextWorkspace === "live-sticker" ? "/live-sticker/" : "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
  };

  if (desktopTaskMap) {
    return (
      <TaskMapWorkspace
        desktopMode
        language={language}
        onLanguageChange={setLanguage}
        onOpenHome={() => undefined}
        onOpenLiveSticker={() => undefined}
      />
    );
  }

  if (workspace === "home") {
    return (
      <ToolsHome
        language={language}
        onLanguageChange={setLanguage}
        onOpenTool={openWorkspace}
      />
    );
  }

  if (workspace === "task-map") {
    return (
      <TaskMapWorkspace
        language={language}
        onLanguageChange={setLanguage}
        onOpenHome={() => openWorkspace("home")}
        onOpenLiveSticker={() => openWorkspace("live-sticker")}
      />
    );
  }

  return (
    <LiveStickerWorkspace
      language={language}
      onLanguageChange={setLanguage}
      onOpenHome={() => openWorkspace("home")}
      onOpenTaskMap={() => openWorkspace("task-map")}
    />
  );
}
