/**
 * Runtime monitor is on by default. Set PIPPER_MONITOR=0 (or false/off/no)
 * to disable sampling, recordings, renderer observers, and ACP/bridge
 * accounting on the session hot path.
 */
export function isMonitorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.PIPPER_MONITOR ?? env.PIPPER_MONITOR_ENABLED;
  if (raw == null || raw.trim() === "") return true;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}
