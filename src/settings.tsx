import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { ErrorBoundary } from "@/components/error-boundary";
import { ThemeProvider } from "@/lib/theme";
import { SettingsApp } from "@/settings/app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <SettingsApp />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
