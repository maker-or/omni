import { defineConfig } from "vitest/config";
import { createCustomResolver } from "./src/lib/alias-resolver.ts";

const resolveCache = new Map<string, string | null>();

import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^react$/,
        replacement: resolve(__dirname, "node_modules/react"),
      },
      {
        find: /^react\/(.*)$/,
        replacement: resolve(__dirname, "node_modules/react/$1"),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(__dirname, "node_modules/react-dom"),
      },
      {
        find: /^react-dom\/(.*)$/,
        replacement: resolve(__dirname, "node_modules/react-dom/$1"),
      },
      {
        find: /^@\/(.*)$/,
        replacement: "$1",
        customResolver: createCustomResolver(resolveCache, __dirname),
      },
    ],
  },
  test: {
    server: {
      deps: {
        inline: true,
      },
    },
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 20000,
  },
});
