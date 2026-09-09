export function trackOnboarding(step: string, status: string, success?: boolean): void {
  try {
    void window.omni?.analytics?.trackOnboarding?.(step, status, success);
  } catch {
    // analytics must never break onboarding
  }
}
