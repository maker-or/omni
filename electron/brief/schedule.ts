/**
 * Pure trigger rules for the Morning Brief. The brief is never started by the
 * user; it runs on the first launch of the day, at the scheduled time while
 * Pipper is open, and when the machine wakes after a missed schedule.
 */

export const DEFAULT_SCHEDULE_TIME = "08:00";

export interface BriefRunState {
  /** Local date (YYYY-MM-DD) of the newest generated brief. */
  latestDate: string | null;
  /** ISO time the newest brief was generated. */
  latestGeneratedAt: string | null;
  /** Local date the brief was last auto-opened in the app. */
  lastShownDate: string | null;
}

export function parseScheduleTime(value: string | null | undefined): {
  hour: number;
  minute: number;
} {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  return { hour: 8, minute: 0 };
}

export function normalizeScheduleTime(value: string | null | undefined): string {
  const { hour, minute } = parseScheduleTime(value);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function scheduledAtOn(day: Date, time: string): Date {
  const { hour, minute } = parseScheduleTime(time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** The next scheduled run strictly after `now`. */
export function nextScheduledRun(now: Date, time: string): Date {
  const today = scheduledAtOn(now, time);
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return scheduledAtOn(tomorrow, time);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Whether today's brief is missing, or predates today's scheduled time that has now passed. */
export function isBriefStale(state: BriefRunState, now: Date, time: string): boolean {
  if (state.latestDate !== localDateKey(now) || !state.latestGeneratedAt) return true;
  const scheduled = scheduledAtOn(now, time);
  const generated = Date.parse(state.latestGeneratedAt);
  return now.getTime() >= scheduled.getTime() && generated < scheduled.getTime();
}

export interface LaunchDecision {
  generate: boolean;
  /** Auto-open in the embedded browser (first launch of the day only). */
  open: boolean;
}

export function decideOnLaunch(
  state: BriefRunState,
  now: Date,
  settings: { enabled: boolean; openOnLaunch: boolean; scheduleTime: string },
): LaunchDecision {
  if (!settings.enabled) return { generate: false, open: false };
  return {
    generate: isBriefStale(state, now, settings.scheduleTime),
    open: settings.openOnLaunch && state.lastShownDate !== localDateKey(now),
  };
}

/** On timer fire or wake: run only if the scheduled time passed without a fresh brief. */
export function shouldRunScheduled(
  state: BriefRunState,
  now: Date,
  settings: { enabled: boolean; scheduleTime: string },
): boolean {
  if (!settings.enabled) return false;
  if (now.getTime() < scheduledAtOn(now, settings.scheduleTime).getTime()) return false;
  return isBriefStale(state, now, settings.scheduleTime);
}
