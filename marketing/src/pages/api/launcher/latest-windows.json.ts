import type { APIRoute } from "astro";
import { PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL } from "../../../../../contracts/launcher-release-urls.ts";
import { isLauncherManifest, launcherManifestHeaders } from "../../../lib/launcher-manifest.ts";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const response = await fetch(PIPPER_LAUNCHER_WINDOWS_MANIFEST_URL, {
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Windows launcher manifest fetch failed with HTTP ${response.status}.`,
        }),
        { status: 502, headers: launcherManifestHeaders },
      );
    }
    const manifest = await response.json();
    if (!isLauncherManifest(manifest, ".exe")) {
      return new Response(JSON.stringify({ error: "Windows launcher manifest is invalid." }), {
        status: 502,
        headers: launcherManifestHeaders,
      });
    }
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: launcherManifestHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Windows launcher manifest fetch failed." }), {
      status: 502,
      headers: launcherManifestHeaders,
    });
  }
};
