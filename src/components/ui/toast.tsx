"use client";

import { toast as sonnerToast } from "sonner";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { surfaceClasses } from "@/lib/surface-classes";

interface ToastOptions {
  icon: ReactNode;
  title: string;
  description?: string;
  duration?: number;
}

function ToastContent({ icon, title, description }: ToastOptions) {
  return (
    <div className={cn("flex items-start gap-3 p-3 ", surfaceClasses(3))}>
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-[14px] text-foreground font-medium leading-tight">{title}</p>
        {description && (
          <p className="text-[13px] text-muted-foreground leading-snug">{description}</p>
        )}
      </div>
    </div>
  );
}

export function toast({ icon, title, description, duration }: ToastOptions) {
  return sonnerToast.custom(
    () => <ToastContent icon={icon} title={title} description={description} />,
    { duration },
  );
}
