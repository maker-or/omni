import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "@/lib/theme";
import { IconProvider } from "@/lib/icon-context";
import { AppQueryProvider } from "@/lib/query-client";
import { ErrorBoundary } from "@/components/error-boundary";
import { reportStartupMilestone } from "@/lib/startup-timing";

function StartupMilestones() {
  useEffect(() => {
    reportStartupMilestone("react-committed");

    if (!("PerformanceObserver" in window)) return;
    const observer = new PerformanceObserver((list) => {
      const firstContentfulPaint = list
        .getEntries()
        .find((entry) => entry.name === "first-contentful-paint");
      if (!firstContentfulPaint) return;
      reportStartupMilestone("first-contentful-paint", firstContentfulPaint.startTime);
      observer.disconnect();
    });
    observer.observe({ type: "paint", buffered: true });

    return () => observer.disconnect();
  }, []);

  return null;
}

reportStartupMilestone("entry");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppQueryProvider>
        <ThemeProvider>
          <IconProvider defaultLibrary="phosphor">
            <StartupMilestones />
            <App />
          </IconProvider>
        </ThemeProvider>
      </AppQueryProvider>
    </ErrorBoundary>
  </StrictMode>,
);
