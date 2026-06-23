import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const deploymentBase = process.env.VITE_DEPLOY_BASE ?? "/";

export default defineConfig({
  plugins: [react()],
  // Keep local development at `/`; production can opt into a domain subpath.
  base: deploymentBase,
});
