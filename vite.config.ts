import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const deploymentBase = process.env.VITE_DEPLOY_BASE ?? "/";
const outputDirectory = process.env.VITE_BUILD_OUT_DIR;

export default defineConfig({
  plugins: [react()],
  // Keep local development at `/`; production can opt into a domain subpath.
  base: deploymentBase,
  build: outputDirectory
    ? {
        outDir: outputDirectory,
        emptyOutDir: true,
      }
    : undefined,
});
