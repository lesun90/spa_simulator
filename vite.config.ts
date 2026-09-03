import { defineConfig } from "vite";
import { steerlabApiPlugin } from "./server/viteApiPlugin";

export default defineConfig({
  plugins: [steerlabApiPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
      interval: 250
    }
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true
  }
});
