export type SleeplessServiceStatus =
  | "unsupported"
  | "not-registered"
  | "requires-approval"
  | "enabled"
  | "not-found"
  | "error";

export type SleeplessPhase =
  | "disabled"
  | "disarmed"
  | "connecting"
  | "armed"
  | "error";

export interface SleeplessPreferences {
  enabled: boolean;
  acOnly: boolean;
  batteryFloor: number;
  maxDurationMinutes: number;
}

export interface SleeplessStatus {
  supported: boolean;
  serviceStatus: SleeplessServiceStatus;
  phase: SleeplessPhase;
  preferences: SleeplessPreferences;
  runningTaskCount: number;
  lidClosed: boolean | null;
  onBattery: boolean | null;
  batteryPercent: number | null;
  armedAt: number | null;
  error: string | null;
}

export const DEFAULT_SLEEPLESS_PREFERENCES: SleeplessPreferences = {
  enabled: false,
  acOnly: true,
  batteryFloor: 20,
  maxDurationMinutes: 240,
};

