/// <reference types="vitest/config" />
import { defineConfig, createLogger, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const FORBIDDEN_CHUNK_PREFIXES = ["stores-vendor", "openclaw-vendor", "state-vendor"];

/** 构建期禁止会触发 release TDZ 白屏的 app 级 vendor chunk。 */
function yuntuChunkGuard(): Plugin {
  return {
    name: "yuntu-chunk-guard",
    generateBundle(_outputOptions, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".js")) continue;
        for (const prefix of FORBIDDEN_CHUNK_PREFIXES) {
          if (fileName.includes(prefix)) {
            this.error(
              `[yuntu-chunk-guard] forbidden chunk "${fileName}". ` +
                "Do not split src/stores or src/lib/openclaw in manualChunks — release boot hang.",
            );
          }
        }
      }
    },
  };
}

const viteLogger = createLogger();
const customLogger = {
  ...viteLogger,
  warn(msg, options) {
    if (typeof msg === "string" && msg.includes("Circular chunk")) {
      throw new Error(`[yuntu-chunk-guard] ${msg}`);
    }
    viteLogger.warn(msg, options);
  },
};

// https://vite.dev/config/
export default defineConfig({
  customLogger,
  plugins: [react(), tailwindcss(), yuntuChunkGuard()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/stores/**"],
      thresholds: {
        lines: 35,
        functions: 35,
        branches: 25,
        statements: 33,
      },
    },
  },

  build: {
    target: "es2021",
    sourcemap: false,
    minify: "esbuild",
    cssMinify: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 800,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 勿把 src/stores 或 src/lib/openclaw 单独拆 chunk：与 react/zustand 会形成
          // release 循环依赖（TDZ: Cannot access 'X' before initialization）导致永久卡在启动屏。
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || id.includes("/react/")) return "react-vendor";
          if (id.includes("@tauri-apps/")) return "tauri-vendor";
          if (id.includes("gsap")) return "motion-vendor";
          return undefined;
        },
      },
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
