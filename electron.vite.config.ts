import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { createCustomResolver } from "./src/lib/alias-resolver.ts";

const resolveCache = new Map<string, string | null>();

const cacheInvalidatorPlugin = {
  name: "resolve-cache-invalidator",
  configureServer(server: any) {
    server.watcher.on("all", (event: string) => {
      if (event === "add" || event === "unlink" || event === "change") {
        resolveCache.clear();
      }
    });
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/main.ts") },
        external: ["electron", "better-sqlite3", "node-pty"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "electron/preload.ts") },
        external: ["electron"],
      },
    },
  },
  renderer: {
    root: ".",
    resolve: {
      alias: [
        {
          find: /^@\/(.*)$/,
          replacement: "$1",
          customResolver: createCustomResolver(resolveCache, __dirname),
        },
      ],
    },
    server: {
      fs: {
        allow: [".."],
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      cacheInvalidatorPlugin,
    ],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          launch: resolve(__dirname, "launch.html"),
        },
      },
    },
  },
});
