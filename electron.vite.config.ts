import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

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
          find: /^\@\/(.*)$/,
          replacement: "$1",
          customResolver(source, importer, options) {
            const srcPath = resolve(__dirname, "src", source);
            const extensions = [".tsx", ".ts", ".jsx", ".js", ".css"];

            for (const ext of ["", ...extensions]) {
              const fullPath = srcPath + ext;
              if (existsSync(fullPath)) {
                return fullPath;
              }
            }

            const atPath = resolve(__dirname, "@", source);
            for (const ext of ["", ...extensions]) {
              const fullPath = atPath + ext;
              if (existsSync(fullPath)) {
                return fullPath;
              }
            }

            return null;
          },
        },
      ],
    },
    plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
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
