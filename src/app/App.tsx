import { useState } from "react";
import { LiveStickerWorkspace } from "../features/live-sticker/LiveStickerWorkspace";
import { TypographyLab } from "../features/typography-lab/TypographyLab";

export function App() {
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const isTypographyLab = window.location.pathname.includes("/function-test/typography");

  if (isTypographyLab) return <TypographyLab />;

  return (
    <LiveStickerWorkspace
      language={language}
      onLanguageChange={setLanguage}
    />
  );
}
