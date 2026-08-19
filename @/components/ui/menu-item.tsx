"use client";

import { useRef, useEffect, forwardRef, type HTMLAttributes } from "react";
import type { IconComponent } from "@/lib/icon-context";
import { motion, AnimatePresence } from "framer-motion";
import { useDropdown } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { shapeMap } from "@/lib/shape-context";

// MenuItem is only used inside Dropdown, which opts out of the global pill
// shape — see dropdown.tsx for the rationale.
const shape = shapeMap.rounded;

interface MenuItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: IconComponent;
  label: string;
  description?: string;
  index: number;
  checked?: boolean;
  onSelect?: () => void;
  pipperId?: string;
}

const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(
  (
    { icon: Icon, label, description, index, checked, onSelect, className, pipperId, ...props },
    ref,
  ) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const hasMounted = useRef(false);
    const { registerItem, activeIndex, checkedIndex } = useDropdown();

    useEffect(() => {
      registerItem(index, internalRef.current);
      return () => registerItem(index, null);
    }, [index, registerItem]);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const isChecked = checked ?? (checkedIndex === index);
    const isActive = activeIndex === index;
    const isHighlighted = isActive || isChecked;
    const skipAnimation = !hasMounted.current;

    return (
      <>
        <div
          ref={(node) => {
            (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          data-proximity-index={index}
          data-pipper-id={pipperId}
          tabIndex={index === (checkedIndex ?? 0) ? 0 : -1}
          role="menuitemradio"
          aria-checked={!!isChecked}
          aria-label={label}
          onClick={onSelect}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              onSelect?.();
            }
          }}
          className={cn(
            `relative z-10 flex items-center gap-2 ${shape.item} px-2 py-2 cursor-pointer outline-none`,
            className,
          )}
          {...props}
        >
          {Icon && (
            <span className="inline-grid">
              <span className="col-start-1 row-start-1 invisible">
                <Icon size={16} strokeWidth={2} />
              </span>
              <Icon
                size={16}
                strokeWidth={isHighlighted ? 2 : 1.5}
                className={cn(
                  "col-start-1 row-start-1 transition-[color,stroke-width] duration-80",
                  isHighlighted ? "text-foreground" : "text-muted-foreground",
                )}
              />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col text-[13px]">
            <span className="inline-grid min-w-0">
              <span
                className="col-start-1 row-start-1 invisible truncate"
                style={{ fontVariationSettings: fontWeights.semibold }}
                aria-hidden="true"
              >
                {label}
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-1 truncate transition-[color,font-variation-settings] duration-80",
                  isHighlighted ? "text-foreground" : "text-muted-foreground",
                )}
                style={{
                  fontVariationSettings: isHighlighted ? fontWeights.semibold : fontWeights.normal,
                }}
              >
                {label}
              </span>
            </span>
            {description ? (
              <span
                className={cn(
                  "truncate text-[11px] transition-colors duration-80",
                  isHighlighted ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {description}
              </span>
            ) : null}
          </span>
          <AnimatePresence>
            {checked && (
              <motion.svg
                key="check"
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-foreground shrink-0"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
              >
                <motion.path
                  d="M4 12L9 17L20 6"
                  initial={{ pathLength: skipAnimation ? 1 : 0 }}
                  animate={{
                    pathLength: 1,
                    transition: { duration: 0.08, ease: "easeOut" },
                  }}
                  exit={{
                    pathLength: 0,
                    transition: { duration: 0.04, ease: "easeIn" },
                  }}
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </div>
      </>
    );
  },
);

MenuItem.displayName = "MenuItem";

export { MenuItem };
