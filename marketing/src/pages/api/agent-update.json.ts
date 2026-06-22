import type { APIRoute } from "astro";
import manifest from "../../data/agent-update.json";

export const prerender = false;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

function isManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(["description", "files_changes", "pr_url", "schema_version", "version"])
  ) {
    return false;
  }
  if (
    record.schema_version !== 1 ||
    typeof record.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      record.version,
    ) ||
    typeof record.description !== "string" ||
    !record.description.trim() ||
    typeof record.pr_url !== "string"
  ) {
    return false;
  }
  try {
    const pr = new URL(record.pr_url);
    if (pr.protocol !== "https:" || !/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(pr.pathname)) {
      return false;
    }
  } catch {
    return false;
  }
  if (!Array.isArray(record.files_changes) || record.files_changes.length === 0) return false;
  const files = record.files_changes;
  if (
    files.some(
      (file) =>
        typeof file !== "string" ||
        !file ||
        file.startsWith("/") ||
        file.includes("\\") ||
        file.includes("\0") ||
        file.split("/").some((segment) => !segment || segment === "." || segment === ".."),
    ) ||
    new Set(files).size !== files.length
  ) {
    return false;
  }
  return true;
}

export const GET: APIRoute = () => {
  if (manifest === null) return new Response(null, { status: 204, headers });
  if (!isManifest(manifest)) {
    return new Response(JSON.stringify({ error: "Agent update manifest is invalid." }), {
      status: 500,
      headers,
    });
  }
  return new Response(JSON.stringify(manifest), { status: 200, headers });
};
