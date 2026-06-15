import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { LaunchApp } from "@/launch/app";
import { ShapeProvider } from "@/lib/shape-context";
import { SurfaceProvider } from "@/lib/surface-context";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/toaster";
import { IconProvider } from "@/lib/icon-context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <SurfaceProvider value={1}>
        <ShapeProvider defaultShape="rounded">
          <IconProvider defaultLibrary="lucide">
            <LaunchApp />
            <Toaster />
          </IconProvider>
        </ShapeProvider>
      </SurfaceProvider>
    </ThemeProvider>
  </StrictMode>,
);
