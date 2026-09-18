import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend sends no CORS headers, so the browser must see the API as
// same-origin. The dev server proxies /api to the backend so it is.
const proxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
});
