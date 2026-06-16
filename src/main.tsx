import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "@/lib/theme";
import { IconProvider } from "@/lib/icon-context";
import { AppQueryProvider } from "@/lib/query-client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppQueryProvider>
      <ThemeProvider>
        <IconProvider defaultLibrary="lucide">
          <App />
        </IconProvider>
      </ThemeProvider>
    </AppQueryProvider>
  </StrictMode>,
);
