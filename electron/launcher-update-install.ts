import { spawn, type ChildProcess } from "node:child_process";
import { shell } from "electron";

type SpawnInstaller = (
  command: string,
  args: string[],
  options: {
    detached: true;
    stdio: "ignore";
    windowsHide: false;
  },
) => ChildProcess;

type OpenInstaller = (path: string) => Promise<string>;

export async function launchLauncherInstaller(
  installerPath: string,
  options: {
    platform?: NodeJS.Platform;
    spawnImpl?: SpawnInstaller;
    openPath?: OpenInstaller;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    await launchWindowsInstaller(installerPath, options.spawnImpl ?? spawn);
    return;
  }

  const openPath = options.openPath ?? shell.openPath.bind(shell);
  const openError = await openPath(installerPath);
  if (openError) throw new Error(openError);
}

function launchWindowsInstaller(installerPath: string, spawnImpl: SpawnInstaller): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(installerPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.once("error", (error) => finish(() => reject(error)));
    child.once("spawn", () =>
      finish(() => {
        child.unref();
        resolve();
      }),
    );
  });
}
