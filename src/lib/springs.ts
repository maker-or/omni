import type { Transition } from "framer-motion";

export const springs = {
  fast: {
    type: "spring",
    stiffness: 520,
    damping: 36,
    mass: 0.8,
  },
  moderate: {
    type: "spring",
    stiffness: 360,
    damping: 32,
    mass: 0.9,
  },
} satisfies Record<string, Transition>;

export const spring = springs;
