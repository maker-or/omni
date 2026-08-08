export type FreezeReportHandler = (report: { blockedMs: number; longTaskMs?: number }) => void;

export function startMonitorFreezeObserver(onReport: FreezeReportHandler): () => void {
  const cleanups: Array<() => void> = [];
  let lastFrame = performance.now();
  let blockedAccumMs = 0;
  let lastReportAt = 0;

  const maybeReport = (blockedMs: number, longTaskMs?: number) => {
    if (blockedMs < 200) return;
    const now = Date.now();
    if (now - lastReportAt < 1000) return;
    lastReportAt = now;
    onReport({ blockedMs, longTaskMs });
  };

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = entry.duration;
          if (duration >= 50) {
            maybeReport(duration, duration);
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      cleanups.push(() => observer.disconnect());
    } catch {
      // longtask unsupported
    }
  }

  let rafId = 0;
  const onFrame = (now: number) => {
    const delta = now - lastFrame;
    if (delta > 200) {
      blockedAccumMs += delta - 16;
      maybeReport(delta);
    }
    lastFrame = now;
    rafId = requestAnimationFrame(onFrame);
  };
  rafId = requestAnimationFrame(onFrame);
  cleanups.push(() => cancelAnimationFrame(rafId));

  const interval = window.setInterval(() => {
    const start = performance.now();
    window.setTimeout(() => {
      const drift = performance.now() - start - 100;
      if (drift > 200) {
        blockedAccumMs += drift;
        maybeReport(drift);
      }
    }, 100);
  }, 250);
  cleanups.push(() => window.clearInterval(interval));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
