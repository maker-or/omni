import { defineConfig } from "astro/config";
import clerk from "@clerk/astro";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [clerk()],
  adapter: vercel(),
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
});

// Trigger dev server reload - v2
