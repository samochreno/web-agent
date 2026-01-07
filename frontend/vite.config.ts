import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, loadEnv, Plugin } from "vite";

// Auto-generate a build id so we don't rely on any env vars; forces a fresh
// service worker URL every build.
const buildId = Date.now().toString(36);

// Plugin to inject build timestamp into service worker for cache invalidation
function serviceWorkerVersionPlugin(): Plugin {
  const buildTimestamp = Date.now().toString();
  return {
    name: "service-worker-version",
    writeBundle() {
      const swPath = path.resolve(__dirname, "dist/service-worker.js");
      if (fs.existsSync(swPath)) {
        let content = fs.readFileSync(swPath, "utf-8");
        content = content.replace(
          /const CACHE_VERSION = ".*?";/,
          `const CACHE_VERSION = "${buildTimestamp}";`
        );
        fs.writeFileSync(swPath, content);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  const apiTarget = env.API_URL ?? "http://127.0.0.1:8000";

  return {
    // Allow env files to live one level above the frontend directory
    envDir: path.resolve(__dirname, ".."),
    plugins: [react(), serviceWorkerVersionPlugin()],
    // Use relative base path for Capacitor native builds to load assets correctly
    base: "./",
    define: {
      __BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      outDir: "dist",
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
