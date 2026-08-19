import { forwardRef, type HTMLAttributes, type ElementType } from "react";
import { cn } from "@/lib/utils";

interface TextShimmerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

const TextShimmer = forwardRef<HTMLElement, TextShimmerProps>(
  ({ className, as: Component = "span", children, ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn("animate-text-shimmer shimmer-text inline-block", className)}
        {...props}
      >
        {children}
      </Component>
    );
  },
);

TextShimmer.displayName = "TextShimmer";

export { TextShimmer };
export type { TextShimmerProps };
