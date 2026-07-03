export type LauncherUpdatePlatform = "darwin" | "win32";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function resolveLauncherUpdatePlatform(platform: NodeJS.Platform): LauncherUpdatePlatform {
  if (platform === "darwin" || platform === "win32") return platform;
  throw new Error(`Launcher updates are not supported on ${platform}.`);
}

export function launcherArtifactExtension(platform: LauncherUpdatePlatform): string {
  return platform === "win32" ? ".exe" : ".dmg";
}

export function launcherArtifactLabel(platform: LauncherUpdatePlatform): string {
  return platform === "win32" ? "Windows installer" : "DMG";
}

export function launcherArtifactFileName(
  version: string,
  platform: LauncherUpdatePlatform,
): string {
  if (!SEMVER.test(version)) throw new Error(`Invalid launcher version: ${version}`);
  return platform === "win32" ? `pipper-${version}-win-x64.exe` : `pipper-${version}-arm64.dmg`;
}

export function launcherManagedDownloadPattern(platform: LauncherUpdatePlatform): RegExp {
  return platform === "win32"
    ? /^pipper-[0-9A-Za-z.-]+-win-x64\.exe(?:\.partial)?$/
    : /^pipper-[0-9A-Za-z.-]+-arm64\.dmg(?:\.partial)?$/;
}
