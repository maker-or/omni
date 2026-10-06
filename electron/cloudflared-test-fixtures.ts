import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A stand-in cloudflared for tests: answers --version, and in tunnel mode
 * logs like the real connector (quick URL, then "Registered tunnel
 * connection") and stays up until killed. FAKE_CF_MODE=crash makes it log an
 * error and exit; FAKE_CF_ARGS names a file that receives its argv and
 * whether TUNNEL_TOKEN was set; FAKE_CF_PIDS names a file each launch appends
 * its pid to (exec keeps the pid, so it is the long-running process).
 */
export function writeFakeCloudflared(dir: string, version = "2026.9.3"): string {
  const path = join(dir, "cloudflared");
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "cloudflared version ${version} (fake)"; exit 0; fi
if [ -n "$FAKE_CF_PIDS" ]; then echo $$ >> "$FAKE_CF_PIDS"; fi
if [ -n "$FAKE_CF_ARGS" ]; then echo "$@" > "$FAKE_CF_ARGS"; echo "token=\${TUNNEL_TOKEN:-none}" >> "$FAKE_CF_ARGS"; fi
echo "2026-09-28T00:00:00Z INF |  https://quiet-fox-1234.trycloudflare.com  |" 1>&2
if [ "$FAKE_CF_MODE" = "crash" ]; then echo "2026-09-28T00:00:00Z ERR failed to dial edge" 1>&2; exit 1; fi
echo "2026-09-28T00:00:01Z INF Registered tunnel connection connIndex=0" 1>&2
exec sleep 30
`,
  );
  chmodSync(path, 0o755);
  return path;
}
