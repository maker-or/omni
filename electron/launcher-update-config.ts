export function resolveLauncherUpdateManifestUrl(options: {
  platform: NodeJS.Platform;
  macManifestUrl?: string | null;
  windowsManifestUrl?: string | null;
}): string | null {
  const mac = options.macManifestUrl?.trim() || null;
  const windows = options.windowsManifestUrl?.trim() || null;
  if (options.platform === "win32") return windows;
  if (options.platform === "darwin") return mac;
  return mac ?? windows;
}
