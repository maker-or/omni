# Phone remote access

How a phone reaches a laptop running Pipper, and how to set up the hosted
pieces. Code: `electron/remote-*.ts`, `electron/cloudflared-*.ts`,
`electron/tunnel-provisioner.ts`, `src/remote/`, and on pipper.dev
`marketing/src/lib/{desktop-auth,cloudflare-tunnels}.ts` +
`marketing/src/pages/api/remote/tunnel.json.ts`.

## Transports

| Transport             | Phone opens                                 | Laptop serves                                  | Notes                                                                                          |
| --------------------- | ------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tailscale` (default) | `http://<tailnet-ip>:4173/remote`           | app + API                                      | Both devices need Tailscale.                                                                   |
| `cloudflare`          | `https://remote.pipper.dev` (hosted app)    | **API only** at `https://lt-<hash>.pipper.dev` | Named tunnel per laptop, provisioned by pipper.dev after sign-in.                              |
| `cloudflare-quick`    | `https://<random>.trycloudflare.com/remote` | app + API                                      | Development only (`PIPPER_REMOTE_TRANSPORT=cloudflare-quick`); the address changes on restart. |

Every transport uses the same pairing: one-time codes from Settings → Remote,
a separate token per phone (stored hashed), read/run scopes, revocation.

## Why laptop hostnames are locked down

Laptop hostnames live in the pipper.dev zone, and whoever runs a laptop
controls what its hostname returns. Without limits, anyone who signs in
could serve a fake pipper.dev sign-in page from `lt-….pipper.dev`, or set
cookies for `.pipper.dev` (cookie tossing) to interfere with sign-in on
www.pipper.dev. So:

1. Laptop hostnames always start with the reserved prefix `lt-`. Never use
   `lt-` for any other record in the zone.
2. Zone rules (below) make `lt-*` hosts API-only, cookie-free, and inert:
   whatever a laptop sends, browsers treat it as JSON text.
3. The phone app is served from one trusted static site
   (`remote.pipper.dev`) and calls laptops cross-origin. Laptops only allow
   that origin (CORS), and auth is a bearer token, never cookies.

## Cloudflare zone rules (pipper.dev)

All three fit the Free plan. Create them in the Cloudflare dashboard for the
pipper.dev zone. "Edit expression" lets you paste these directly.

**1. Security → WAF → Custom rules → Create rule**

- Name: `Laptop hosts: API only`
- Expression:
  ```
  (http.host wildcard "lt-*.pipper.dev" and not starts_with(http.request.uri.path, "/api/remote/"))
  ```
- Action: **Block**

**2. Rules → Transform Rules → Modify Request Header → Create rule**

- Name: `Laptop hosts: no cookies in`
- Expression: `(http.host wildcard "lt-*.pipper.dev")`
- Operation: **Remove** header `cookie`

**3. Rules → Transform Rules → Modify Response Header → Create rule**

- Name: `Laptop hosts: inert responses`
- Expression: `(http.host wildcard "lt-*.pipper.dev")`
- Operations:
  - **Remove** `set-cookie`
  - **Set static** `content-type` = `application/json; charset=utf-8`
  - **Set static** `x-content-type-options` = `nosniff`
  - **Set static** `content-security-policy` = `sandbox; default-src 'none'; frame-ancestors 'none'`

To verify (replace the host with a live laptop or the dev test host):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lt-devtest.pipper.dev/remote
```

Expect `403` (blocked). API paths should still answer (`401` without a token).

## Hosted phone app (remote.pipper.dev)

Built from the same source as the laptop-served app:

```bash
bun run build:remote-web
```

Output: `out/remote-web/` (static files, plus `_headers` with the CSP and
`remote-manifest.json`). Deploy it to Cloudflare Pages, for example:

```bash
bunx wrangler pages deploy out/remote-web --project-name pipper-remote
```

Then add the custom domain `remote.pipper.dev` to the Pages project (Pages →
project → Custom domains). It must not be an `lt-` host.

Build environment for the hosted app:

| Variable                             | Value                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_REMOTE_ATTESTATION_PUBLIC_KEY` | Optional: the default in `vite.remote-web.config.ts` is pipper.dev's current public key. Set it only when rotating the pair (`node scripts/generate-attestation-key.mjs`), and update the default and pipper.dev's `PIPPER_LAPTOP_ATTESTATION_KEY` together. |
| `VITE_REMOTE_LAPTOP_DOMAIN`          | Default `pipper.dev`: which `lt-*` hosts the app may pair with; the CSP's `connect-src` follows it.                                                                                                                                                          |

## Pairing confirmation and laptop owners

A pairing link can come from anyone, and pairing makes that laptop the
destination for the phone's prompts. So the phone never redeems a link or a
scanned QR by itself:

1. It asks the laptop to describe itself (`POST /api/remote/pair/preview`),
   which checks the code without using it up (wrong guesses count toward the
   same limits as pairing).
2. With a named tunnel, that description includes pipper.dev's signed owner
   statement (`pa1.…`, Ed25519) for the laptop's exact hostname. The hosted
   app verifies it with the built-in public key and shows "Belongs to
   <email> — verified by Pipper"; anything else shows as **Unverified**.
3. If the phone's other laptops belong to a different account, it warns that
   prompts would go to someone else.
4. Only after the user confirms does it pair. The chat header always shows
   which laptop (and verified owner) prompts go to.

Typing a code shown on your own laptop's screen skips the confirmation step.

## pipper.dev environment (Vercel)

| Variable                          | Value                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`            | API token with **Account → Cloudflare Tunnel: Edit** and **Zone → DNS: Edit** (pipper.dev only) |
| `CLOUDFLARE_ACCOUNT_ID`           | Cloudflare account id                                                                           |
| `CLOUDFLARE_ZONE_ID`              | pipper.dev zone id                                                                              |
| `REMOTE_TUNNEL_DOMAIN`            | `pipper.dev`                                                                                    |
| `PIPPER_LAPTOP_CREDENTIAL_SECRET` | 32+ random characters (`openssl rand -base64 48`)                                               |
| `PIPPER_LAPTOP_ATTESTATION_KEY`   | Private half from `node scripts/generate-attestation-key.mjs` (signs laptop owner statements)   |

Deploy pipper.dev **before** shipping this desktop build: desktop sign-in now
requires the `state` value that only the updated `/auth/complete` echoes, so an
older pipper.dev can't sign the app in. Users then sign in once more to
receive a laptop credential.

### Laptop slots and account capacity

Each account may hold 5 laptop tunnels (`MAX_TUNNELS_PER_USER`). A reinstall
or app-data reset mints a new laptop id (and tunnel), so when an account is at
the limit, provisioning deletes that account's longest-offline tunnels
(status `inactive`/`down`) and their DNS records first; an evicted laptop that
comes back simply re-provisions the same hostname. Only 5 laptops _online at
once_ are refused.

Cloudflare's default is 1,000 tunnels per account. Watch usage as users grow
and request an increase (or shard across accounts) before reaching it.

## Desktop environment (development)

| Variable                                                 | Effect                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PIPPER_REMOTE_TRANSPORT`                                | Force `tailscale`, `cloudflare`, or `cloudflare-quick` for this run.                                                            |
| `PIPPER_REMOTE_PORT`                                     | Local port (default 4173).                                                                                                      |
| `PIPPER_REMOTE_APP_URL`                                  | Hosted app URL (default `https://remote.pipper.dev`); its origin is the only one allowed by CORS.                               |
| `PIPPER_API_BASE`                                        | pipper.dev base URL (staging).                                                                                                  |
| `PIPPER_DEV_TUNNEL_TOKEN` / `PIPPER_DEV_TUNNEL_HOSTNAME` | Dev builds only: run a tunnel you created yourself instead of asking pipper.dev. Use an `lt-` hostname so the zone rules apply. |
| `PIPPER_CLOUDFLARED_PATH`                                | Use this cloudflared binary instead of the pinned download.                                                                     |

Never give a connector token a `VITE_` name or read it via `import.meta.env`:
those values are embedded in the shipped app.
