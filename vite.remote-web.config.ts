import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";

/**
 * Hosted phone app (e.g. https://remote.pipper.dev on Cloudflare Pages).
 * Laptops reached through named tunnels are locked down to API-only at the
 * Cloudflare edge, so the app is served from this trusted static site and
 * calls each laptop's `lt-*.<domain>` host cross-origin.
 * Build: `bun run build:remote-web` → out/remote-web. See docs/remote-access.md.
 */
const laptopDomain = process.env.VITE_REMOTE_LAPTOP_DOMAIN ?? "pipper.dev";
/**
 * pipper.dev's public key for laptop owner statements — the public half of
 * the pair whose private half is PIPPER_LAPTOP_ATTESTATION_KEY on pipper.dev
 * (scripts/generate-attestation-key.mjs). Public by design, so it's the
 * build default here; set VITE_REMOTE_ATTESTATION_PUBLIC_KEY only when
 * rotating the pair (then update this default and pipper.dev together).
 * Without a valid key every laptop shows as "Unverified" on the pairing screen.
 */
const PIPPER_ATTESTATION_PUBLIC_KEY = "wwg9F0_hnCTB4nPa_zy3gFk5Blq2_NeVPruKcOWlAkQ";
const attestationPublicKey =
  process.env.VITE_REMOTE_ATTESTATION_PUBLIC_KEY ?? PIPPER_ATTESTATION_PUBLIC_KEY;
if (!/^[A-Za-z0-9_-]{43}$/.test(attestationPublicKey)) {
  console.warn(
    "\n[remote-web] WARNING: VITE_REMOTE_ATTESTATION_PUBLIC_KEY is missing or malformed; " +
      "laptop owners can't be verified. See docs/remote-access.md.\n",
  );
}
const outDir = resolve(__dirname, "out/remote-web");

// Scripts and styles only from this site; network access only to this site
// and laptop hosts; never framed. Mirrors the laptop-served page's policy
// (electron/remote-security.ts REMOTE_PAGE_CSP) plus the laptop domain.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self' https://*.${laptopDomain}`,
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const HEADERS = `/*
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
/index.html
  Cache-Control: no-cache
/remote-manifest.json
  Cache-Control: no-cache
`;

const MANIFEST = {
  name: "Omni Remote",
  short_name: "Omni",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#171717",
  theme_color: "#171717",
  icons: [
    { src: "/icon.png", sizes: "512x512", type: "image/png" },
    { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
  ],
};

export default mergeConfig(
  base,
  defineConfig({
    define: {
      "import.meta.env.VITE_REMOTE_HOSTED": JSON.stringify("true"),
      "import.meta.env.VITE_REMOTE_LAPTOP_DOMAIN": JSON.stringify(laptopDomain),
      "import.meta.env.VITE_REMOTE_ATTESTATION_PUBLIC_KEY": JSON.stringify(attestationPublicKey),
    },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { remote: resolve(__dirname, "remote.html") } },
    },
    plugins: [
      {
        name: "remote-web-static-files",
        closeBundle() {
          // Pages serves index.html at "/".
          copyFileSync(join(outDir, "remote.html"), join(outDir, "index.html"));
          writeFileSync(join(outDir, "_headers"), HEADERS);
          writeFileSync(join(outDir, "remote-manifest.json"), JSON.stringify(MANIFEST, null, 2));
        },
      },
    ],
  }),
);
