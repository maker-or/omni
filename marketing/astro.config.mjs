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
  webAnalytics: {
    enabled: true, // set to false when using @vercel/analytics@1.4.0
  },
});

// Trigger dev server reload - v2
