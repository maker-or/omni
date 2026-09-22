import type { Transition } from "framer-motion";

/**
 * Spring presets for both arrival and dismissal.
 *
 * Each preset carries an `exit` variant that is slightly stiffer and more
 * damped than its enter so dismissals settle a touch faster than they arrive.
 * The design-system components (`@/components/ui/*`) read `preset.exit` for
 * their exit transitions, so a preset WITHOUT `exit` silently falls back to
 * framer-motion's default spring (stiffness 100 / damping 10) — a slow,
 * overshooting close.
 */
type SpringPreset = Transition & { exit: Transition };

const fast: SpringPreset = {
  type: "spring",
  stiffness: 520,
  damping: 36,
  mass: 0.8,
  exit: { type: "spring", stiffness: 640, damping: 42, mass: 0.7 },
};

const moderate: SpringPreset = {
  type: "spring",
  stiffness: 360,
  damping: 32,
  mass: 0.9,
  exit: { type: "spring", stiffness: 520, damping: 42, mass: 0.85 },
};

const slow: SpringPreset = {
  type: "spring",
  stiffness: 220,
  damping: 30,
  mass: 1,
  exit: { type: "spring", stiffness: 320, damping: 36, mass: 1 },
};

export const springs = { fast, moderate, slow };

export const spring = springs;
