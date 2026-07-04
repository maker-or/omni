import { defineConfig } from "vitest/config";
import { createCustomResolver } from "./src/lib/alias-resolver.ts";

const resolveCache = new Map<string, string | null>();

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
  test: {
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "electron/**/*.test.{ts,tsx}",
      "marketing/src/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 20000,
  },
});
