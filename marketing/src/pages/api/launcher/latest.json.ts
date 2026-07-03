import type { APIRoute } from "astro";
import { PIPPER_LAUNCHER_MAC_MANIFEST_URL } from "../../../../../contracts/launcher-release-urls.ts";
import { isLauncherManifest, launcherManifestHeaders } from "../../../lib/launcher-manifest.ts";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const response = await fetch(PIPPER_LAUNCHER_MAC_MANIFEST_URL, {
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Launcher manifest fetch failed with HTTP ${response.status}.` }),
        { status: 502, headers: launcherManifestHeaders },
      );
    }
    const manifest = await response.json();
    if (!isLauncherManifest(manifest, ".dmg")) {
      return new Response(JSON.stringify({ error: "Launcher manifest is invalid." }), {
        status: 502,
        headers: launcherManifestHeaders,
      });
    }
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: launcherManifestHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: "Launcher manifest fetch failed." }), {
      status: 502,
      headers: launcherManifestHeaders,
    });
  }
};
