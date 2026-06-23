import { useState } from "react";
import { LiveStickerWorkspace } from "../features/live-sticker/LiveStickerWorkspace";

export function App() {
  const [language, setLanguage] = useState<"zh" | "en">("zh");

  return (
    <LiveStickerWorkspace
      language={language}
      onLanguageChange={setLanguage}
    />
  );
}
