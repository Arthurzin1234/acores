import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { emptyOutDir: true },
  preview: {
    port: 5173, strictPort: true, host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3333', '/ws': { target: 'ws://127.0.0.1:3333', ws: true } },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3333",
      "/ws": {
        target: "ws://127.0.0.1:3333",
        ws: true
      }
    }
  }
});
