import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Resolve the workspace source on a clean checkout, before dist is built.
  resolve: {
    alias: {
      "@openstudy/import-core": fileURLToPath(new URL("../../packages/import-core/src/index.ts", import.meta.url)),
      "@openstudy/mapping": fileURLToPath(new URL("../../packages/structured-mapping/src/index.ts", import.meta.url)),
      "@openstudy/schema": fileURLToPath(new URL("../../packages/schema/src/index.ts", import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss()],
});
