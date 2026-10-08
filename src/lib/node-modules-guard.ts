import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * Detects a `node_modules/node_modules` link that points at another install.
 *
 * Node skips directories named `node_modules` when walking up for a bare
 * import, but rolldown's resolver does not: from any file inside
 * `node_modules/<pkg>/`, it checks `node_modules/node_modules/<dep>` first.
 * If that link targets a different checkout (e.g. a git worktree whose
 * node_modules was copied from the main repo), every dependency-of-a-dependency
 * resolves into the other install, the bundle gets two copies of React, and
 * the app dies with "Invalid hook call".
 *
 * Returns the offending link path and its target, or null when there is no
 * link or it points back at this project's own node_modules (harmless).
 */
export function findForeignNestedNodeModules(
  root: string,
): { link: string; target: string } | null {
  const link = join(root, "node_modules", "node_modules");
  try {
    lstatSync(link);
  } catch {
    return null;
  }
  let target: string;
  try {
    target = realpathSync(link);
  } catch {
    // Dangling link: the resolver finds nothing there and keeps walking.
    return null;
  }
  const own = realpathSync(join(root, "node_modules"));
  return target === own ? null : { link, target };
}

/** Vite plugin that refuses to dev/build/test against a foreign nested install. */
export function nodeModulesGuardPlugin(root: string) {
  return {
    name: "node-modules-guard",
    configResolved() {
      const foreign = findForeignNestedNodeModules(root);
      if (!foreign) return;
      throw new Error(
        `[node-modules-guard] ${foreign.link} links to ${foreign.target}.\n` +
          "Dependencies would resolve into that other install and bundle duplicate " +
          'React copies ("Invalid hook call"). Remove the link (it is not needed):\n' +
          `  rm "${foreign.link}"`,
      );
    },
  };
}
