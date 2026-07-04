import type { APIRoute } from "astro";
import {
  fetchWindowsLauncherManifest,
  launcherManifestHeaders,
} from "../../../lib/launcher-manifest.ts";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const manifest = await fetchWindowsLauncherManifest();
    if (!manifest) {
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
