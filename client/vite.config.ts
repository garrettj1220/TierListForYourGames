import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rawConfiguredBase = (env.VITE_APP_BASE_PATH || "").trim();
  const fallbackBase = mode === "production" ? "/tools/tierlist/" : "/";
  const configuredBase = rawConfiguredBase || fallbackBase;
  const normalizedBase = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;

  return {
    base: normalizedBase,
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            "pdf-vendor": ["jspdf"]
          }
        }
      }
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true
        },
        "/art": {
          target: "http://localhost:8787",
          changeOrigin: true
        }
      }
    }
  };
});
