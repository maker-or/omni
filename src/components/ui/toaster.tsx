"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/lib/theme";
import { surfaceClasses } from "@/lib/surface-classes";

export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme}
      toastOptions={{
        classNames: {
          toast: `${surfaceClasses(3)} border border-border`,
          title: "!text-foreground !text-[14px]",
          description: "!text-muted-foreground !text-[13px]",
        },
      }}
    />
  );
}
