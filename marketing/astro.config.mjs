import { defineConfig } from "astro/config";
import clerk from "@clerk/astro";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://www.pipper.dev",
  integrations: [
    clerk(),
    react(),
    sitemap({
      filter: (page) => {
        const url = new URL(page);
        const path = url.pathname;
        const excluded = ["/sign-in", "/sign-up", "/auth", "/auth/complete", "/api/"];
        return !excluded.some((prefix) => path.startsWith(prefix));
      },
      customPages: [],
    }),
  ],
  adapter: vercel(),
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
  webAnalytics: {
    enabled: true,
  },
});

// Trigger dev server reload - v2
