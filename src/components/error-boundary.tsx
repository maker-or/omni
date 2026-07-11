"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowsClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Elevated } from "@/lib/elevated";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, an uncaught render error unmounts the whole tree and leaves
 * the raw app background exposed — reads as the window going solid black,
 * since --surface-1 is near-black in dark mode. Catch it and show a
 * recoverable screen instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="flex h-screen w-screen items-center justify-center bg-background p-6"
          data-pipper-id="app-error-boundary"
        >
          <Elevated
            offset={2}
            className="flex max-w-md flex-col items-start gap-3 rounded-2xl border border-border p-6"
          >
            <WarningCircleIcon size={28} weight="fill" className="text-red-500" />
            <div className="text-base font-semibold text-foreground">Something went wrong</div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <Button
              type="button"
              size="sm"
              leadingIcon={ArrowsClockwiseIcon}
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </Elevated>
        </div>
      );
    }
    return this.props.children;
  }
}
