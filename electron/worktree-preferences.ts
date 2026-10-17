import { getAppSetting, setAppSetting } from "./db.ts";

const AUTO_INSTALL_KEY = "worktrees.auto_install_dependencies";

export function getWorktreeAutoInstall(): boolean {
  return getAppSetting(AUTO_INSTALL_KEY) !== "false";
}

export function setWorktreeAutoInstall(enabled: boolean): boolean {
  if (typeof enabled !== "boolean")
    throw new Error("Automatic install preference must be a boolean");
  setAppSetting(AUTO_INSTALL_KEY, String(enabled));
  return enabled;
}
