import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import clerk from "@clerk/astro";
import vercel from "@astrojs/vercel";

export default defineConfig({
  integrations: [clerk()],
  adapter: vercel(),
  output: "server",
});

// Trigger dev server reload - v2
