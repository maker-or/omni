import type { ComponentType } from "react";
import type { IconComponent, IconName, IconComponentProps } from "../icon-map";
import {
  ChevronRight as UuiChevronRight,
  ChevronDown as UuiChevronDown,
  Dropper as UuiDropper,
  XClose as UuiX,
  Copy01 as UuiCopy,
  Menu01 as UuiMenu,
  Monitor01 as UuiMonitor,
  Sun as UuiSun,
  Moon01 as UuiMoon,
  Square as UuiSquare,
  Circle as UuiCircle,
  BookClosed as UuiBook,
  Clock as UuiClock,
  Star01 as UuiStar,
  Settings01 as UuiSettings,
  Plus as UuiPlus,
  ArrowLeft as UuiArrowLeft,
  ArrowRight as UuiArrowRight,
  ArrowUp as UuiArrowUp,
  SearchMd as UuiSearch,
  Loading01 as UuiLoader,
  Users01 as UuiUsers,
  Lock01 as UuiLock,
  Mail01 as UuiMail,
  Bell01 as UuiBell,
  Shield01 as UuiShield,
  Palette as UuiPalette,
  Lightbulb01 as UuiLightbulb,
  Rocket01 as UuiRocket,
  Heart as UuiHeart,
  Brush01 as UuiBrush,
  CpuChip01 as UuiCpuChip,
  Globe01 as UuiGlobe,
  User01 as UuiUser,
  Image01 as UuiImage,
  Link01 as UuiLink,
  Check as UuiCheck,
  RefreshCcw01 as UuiRotateCcw,
  Home01 as UuiHome,
  MessageCircle01 as UuiMessage,
  Inbox01 as UuiInbox,
  Pencil01 as UuiPencil,
  SkipForward as UuiSkipForward,
  CornerDownRight as UuiCornerDownRight,
} from "@untitledui/icons";
import { Play, Pause } from "lucide-react";

function untitledui(
  Icon: ComponentType<{
    width?: number;
    height?: number;
    strokeWidth?: number;
    className?: string;
  }>,
): IconComponent {
  return function UntitledUiAdapter({ size, strokeWidth, className }: IconComponentProps) {
    return <Icon width={size} height={size} strokeWidth={strokeWidth} className={className} />;
  };
}

export const untitleduiMap: Record<IconName, IconComponent> = {
  "chevron-right": untitledui(UuiChevronRight),
  "chevron-down": untitledui(UuiChevronDown),
  pipette: untitledui(UuiDropper),
  x: untitledui(UuiX),
  copy: untitledui(UuiCopy),
  menu: untitledui(UuiMenu),
  dot: untitledui(UuiCircle),
  monitor: untitledui(UuiMonitor),
  sun: untitledui(UuiSun),
  moon: untitledui(UuiMoon),
  "rectangle-horizontal": untitledui(UuiSquare),
  circle: untitledui(UuiCircle),
  "square-library": untitledui(UuiBook),
  clock: untitledui(UuiClock),
  star: untitledui(UuiStar),
  settings: untitledui(UuiSettings),
  plus: untitledui(UuiPlus),
  "arrow-left": untitledui(UuiArrowLeft),
  "arrow-right": untitledui(UuiArrowRight),
  "arrow-up": untitledui(UuiArrowUp),
  search: untitledui(UuiSearch),
  loader: untitledui(UuiLoader),
  users: untitledui(UuiUsers),
  lock: untitledui(UuiLock),
  mail: untitledui(UuiMail),
  bell: untitledui(UuiBell),
  shield: untitledui(UuiShield),
  palette: untitledui(UuiPalette),
  lightbulb: untitledui(UuiLightbulb),
  rocket: untitledui(UuiRocket),
  heart: untitledui(UuiHeart),
  paintbrush: untitledui(UuiBrush),
  brain: untitledui(UuiCpuChip),
  globe: untitledui(UuiGlobe),
  user: untitledui(UuiUser),
  image: untitledui(UuiImage),
  link: untitledui(UuiLink),
  check: untitledui(UuiCheck),
  "rotate-ccw": untitledui(UuiRotateCcw),
  play: Play,
  pause: Pause,
  home: untitledui(UuiHome),
  "message-circle": untitledui(UuiMessage),
  inbox: untitledui(UuiInbox),
  pencil: untitledui(UuiPencil),
  "skip-forward": untitledui(UuiSkipForward),
  "corner-down-right": untitledui(UuiCornerDownRight),
};

export default untitleduiMap;
