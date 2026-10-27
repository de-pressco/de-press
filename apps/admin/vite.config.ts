import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// API проксируется на Django (daphne :8005). Единый origin: admin.depress.co.
const API_UPSTREAM = process.env.API_UPSTREAM ?? "http://127.0.0.1:8005";

export default defineConfig({
  plugins: [react()],
  // Хостится на /console/ рядом с браузерным SPA и Mini App (см. DEPLOY.md).
  base: "/console/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // 5176, not 5175: the Mini App dev server already binds 5175.
    port: 5176,
    proxy: {
      "/api": { target: API_UPSTREAM, changeOrigin: true },
      "/media": { target: API_UPSTREAM, changeOrigin: true },
    },
  },
});
