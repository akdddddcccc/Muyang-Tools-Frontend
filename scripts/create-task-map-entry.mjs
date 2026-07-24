import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const liveStickerEntry = join("dist", "live-sticker", "index.html");
const homeEntry = join("dist", "index.html");
const taskMapEntry = join("dist", "task-map", "index.html");

copyFileSync(liveStickerEntry, homeEntry);
mkdirSync(dirname(taskMapEntry), { recursive: true });
copyFileSync(liveStickerEntry, taskMapEntry);
copyFileSync(join("public", "robots.txt"), join("dist", "robots.txt"));
copyFileSync(join("public", "sitemap.xml"), join("dist", "sitemap.xml"));
copyFileSync(join("public", "favicon.svg"), join("dist", "favicon.svg"));
