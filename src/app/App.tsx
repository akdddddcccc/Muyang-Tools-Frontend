import { useState } from "react";
import { LiveStickerWorkspace } from "../features/live-sticker/LiveStickerWorkspace";
import { TaskMapWorkspace } from "../features/task-map/TaskMapWorkspace";

type WorkspaceId = "live-sticker" | "task-map";

function workspaceFromLocation(): WorkspaceId {
  return window.location.pathname.includes("/task-map") ? "task-map" : "live-sticker";
}

export function App() {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [workspace, setWorkspace] = useState<WorkspaceId>(workspaceFromLocation);

  const openWorkspace = (nextWorkspace: WorkspaceId) => {
    setWorkspace(nextWorkspace);
    const nextPath = nextWorkspace === "task-map" ? "/task-map/" : "/";
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
  };

  if (workspace === "task-map") {
    return (
      <TaskMapWorkspace
        language={language}
        onLanguageChange={setLanguage}
        onOpenLiveSticker={() => openWorkspace("live-sticker")}
      />
    );
  }

  return (
    <LiveStickerWorkspace
      language={language}
      onLanguageChange={setLanguage}
      onOpenTaskMap={() => openWorkspace("task-map")}
    />
  );
}
