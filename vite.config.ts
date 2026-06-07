import { defineConfig } from "vite";
import { resolve } from "node:path";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
});
