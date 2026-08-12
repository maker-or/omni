"use client";

import type { ComponentType } from "react";

// ── Phosphor (Primary Synchronous Bundle) ────────────────────
import {
  CaretRight as PhCaretRight,
  CaretDown as PhCaretDown,
  Eyedropper as PhEyedropper,
  X as PhX,
  Copy as PhCopy,
  List as PhList,
  DotOutline as PhDotOutline,
  Monitor as PhMonitor,
  Sun as PhSun,
  Moon as PhMoon,
  Rectangle as PhRectangle,
  Circle as PhCircle,
  Books as PhBooks,
  Clock as PhClock,
  Star as PhStar,
  Gear as PhGear,
  Plus as PhPlus,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowUp as PhArrowUp,
  MagnifyingGlass as PhMagnifyingGlass,
  Spinner as PhSpinner,
  Users as PhUsers,
  Lock as PhLock,
  Envelope as PhEnvelope,
  Bell as PhBell,
  Shield as PhShield,
  Palette as PhPalette,
  Lightbulb as PhLightbulb,
  Rocket as PhRocket,
  Heart as PhHeart,
  PaintBrush as PhPaintBrush,
  Brain as PhBrain,
  Globe as PhGlobe,
  User as PhUser,
  Image as PhImage,
  Link as PhLink,
  Check as PhCheck,
  ArrowCounterClockwise as PhRotateCcw,
  Play as PhPlay,
  Pause as PhPause,
  House as PhHouse,
  ChatCircle as PhChatCircle,
  Tray as PhTray,
  Pencil as PhPencil,
  SkipForward as PhSkipForward,
  ArrowElbowDownRight as PhArrowElbowDownRight,
} from "@phosphor-icons/react";

// ── Types ───────────────────────────────────────────────────

export interface IconComponentProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconComponentProps>;

export type IconLibrary = "lucide" | "tabler" | "phosphor" | "hugeicons" | "untitledui";

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "x"
  | "copy"
  | "menu"
  | "dot"
  | "monitor"
  | "sun"
  | "moon"
  | "rectangle-horizontal"
  | "circle"
  | "square-library"
  | "clock"
  | "star"
  | "settings"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "search"
  | "loader"
  | "users"
  | "lock"
  | "mail"
  | "bell"
  | "shield"
  | "palette"
  | "lightbulb"
  | "rocket"
  | "heart"
  | "paintbrush"
  | "brain"
  | "globe"
  | "user"
  | "image"
  | "link"
  | "check"
  | "rotate-ccw"
  | "play"
  | "pause"
  | "pipette"
  | "home"
  | "message-circle"
  | "inbox"
  | "pencil"
  | "skip-forward"
  | "corner-down-right";

export const iconLibraryOrder: IconLibrary[] = [
  "phosphor",
  "lucide",
  "tabler",
  "hugeicons",
  "untitledui",
];

// ── Primary Phosphor Map ─────────────────────────────────────

type PhosphorWeight = "thin" | "light" | "regular" | "bold";
function phosphor(
  Icon: ComponentType<{ size?: number; weight?: PhosphorWeight; className?: string }>,
): IconComponent {
  return function PhosphorAdapter({ size, strokeWidth, className }: IconComponentProps) {
    const weight: PhosphorWeight = strokeWidth != null && strokeWidth >= 1.75 ? "regular" : "light";
    return <Icon size={size} weight={weight} className={className} />;
  };
}

export const phosphorMap: Record<IconName, IconComponent> = {
  "chevron-right": phosphor(PhCaretRight),
  "chevron-down": phosphor(PhCaretDown),
  pipette: phosphor(PhEyedropper),
  x: phosphor(PhX),
  copy: phosphor(PhCopy),
  menu: phosphor(PhList),
  dot: phosphor(PhDotOutline),
  monitor: phosphor(PhMonitor),
  sun: phosphor(PhSun),
  moon: phosphor(PhMoon),
  "rectangle-horizontal": phosphor(PhRectangle),
  circle: phosphor(PhCircle),
  "square-library": phosphor(PhBooks),
  clock: phosphor(PhClock),
  star: phosphor(PhStar),
  settings: phosphor(PhGear),
  plus: phosphor(PhPlus),
  "arrow-left": phosphor(PhArrowLeft),
  "arrow-right": phosphor(PhArrowRight),
  "arrow-up": phosphor(PhArrowUp),
  search: phosphor(PhMagnifyingGlass),
  loader: phosphor(PhSpinner),
  users: phosphor(PhUsers),
  lock: phosphor(PhLock),
  mail: phosphor(PhEnvelope),
  bell: phosphor(PhBell),
  shield: phosphor(PhShield),
  palette: phosphor(PhPalette),
  lightbulb: phosphor(PhLightbulb),
  rocket: phosphor(PhRocket),
  heart: phosphor(PhHeart),
  paintbrush: phosphor(PhPaintBrush),
  brain: phosphor(PhBrain),
  globe: phosphor(PhGlobe),
  user: phosphor(PhUser),
  image: phosphor(PhImage),
  link: phosphor(PhLink),
  check: phosphor(PhCheck),
  "rotate-ccw": phosphor(PhRotateCcw),
  play: phosphor(PhPlay),
  pause: phosphor(PhPause),
  home: phosphor(PhHouse),
  "message-circle": phosphor(PhChatCircle),
  inbox: phosphor(PhTray),
  pencil: phosphor(PhPencil),
  "skip-forward": phosphor(PhSkipForward),
  "corner-down-right": phosphor(PhArrowElbowDownRight),
};

// ── Cache & Async Loaders ─────────────────────────────────────

const loadedIconMaps: Partial<Record<IconLibrary, Record<IconName, IconComponent>>> = {
  phosphor: phosphorMap,
};

const pendingPromises: Partial<Record<IconLibrary, Promise<Record<IconName, IconComponent>>>> = {};

const iconSetLoaders: Record<
  Exclude<IconLibrary, "phosphor">,
  () => Promise<{ default: Record<IconName, IconComponent> }>
> = {
  lucide: () => import("./icon-sets/lucide"),
  tabler: () => import("./icon-sets/tabler"),
  hugeicons: () => import("./icon-sets/hugeicons"),
  untitledui: () => import("./icon-sets/untitledui"),
};

export async function loadIconLibrary(lib: IconLibrary): Promise<Record<IconName, IconComponent>> {
  if (loadedIconMaps[lib]) return loadedIconMaps[lib]!;

  if (!pendingPromises[lib]) {
    const loader = iconSetLoaders[lib as keyof typeof iconSetLoaders];
    if (loader) {
      pendingPromises[lib] = loader().then((mod) => {
        loadedIconMaps[lib] = mod.default;
        delete pendingPromises[lib];
        return mod.default;
      });
    } else {
      return phosphorMap;
    }
  }

  return pendingPromises[lib]!;
}

export function getLoadedIconMap(lib: IconLibrary): Record<IconName, IconComponent> {
  return loadedIconMaps[lib] ?? phosphorMap;
}

export const iconMap: Record<IconLibrary, Record<IconName, IconComponent>> = new Proxy(
  {} as Record<IconLibrary, Record<IconName, IconComponent>>,
  {
    get(_target, prop: string) {
      return getLoadedIconMap(prop as IconLibrary);
    },
  },
);
