const rendererStartedAt = performance.now();

export function reportStartupMilestone(
  label: string,
  elapsedMs = performance.now() - rendererStartedAt,
): void {
  window.omni.startup.reportRendererMilestone(label, elapsedMs);
}
