import { defineConfig } from "vite";
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

// https://vite.dev/config/
export default defineConfig({
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
});
