import type { APIRoute } from "astro";

export const prerender = false;

const DEFAULT_MANIFEST_URL =
  "https://github.com/maker-or/omni/releases/latest/download/latest.json";
const MANIFEST_URL =
  import.meta.env.PIPPER_LAUNCHER_UPDATE_MANIFEST_URL ??
  import.meta.env.PUBLIC_PIPPER_LAUNCHER_UPDATE_MANIFEST_URL ??
  DEFAULT_MANIFEST_URL;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isManifest(value: unknown): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(["schema_version", "sha256", "url", "version"])
  ) {
    return false;
  }
  if (
    record.schema_version !== 1 ||
    typeof record.version !== "string" ||
    !semver.test(record.version) ||
    typeof record.url !== "string" ||
    typeof record.sha256 !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(record.sha256)
  ) {
    return false;
  }
  try {
    const url = new URL(record.url);
    return url.protocol === "https:" && url.pathname.toLowerCase().endsWith(".dmg");
  } catch {
    return false;
  }
}

export const GET: APIRoute = async () => {
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store", redirect: "follow" });
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Launcher manifest fetch failed with HTTP ${response.status}.` }),
        { status: 502, headers },
      );
    }
    const manifest = await response.json();
    if (!isManifest(manifest)) {
      return new Response(JSON.stringify({ error: "Launcher manifest is invalid." }), {
        status: 502,
        headers,
      });
    }
    return new Response(JSON.stringify(manifest), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Launcher manifest fetch failed." }), {
      status: 502,
      headers,
    });
  }
};
