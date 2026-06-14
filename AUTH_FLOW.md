# Auth Flow Notes

## Intent

The goal is to keep the desktop launcher simple while moving authentication to the web.

What this means in practice:

- The Electron launcher should let the user start the auth flow.
- The web app should perform authentication using Clerk's built-in components.
- After auth succeeds, the browser should hand the user back to the desktop app.
- The desktop app should store only a minimal identity snapshot for tracking.
- App data such as projects, threads, and messages should remain local and separate from auth identity.

## Current Flow

1. The user opens the Electron launcher.
2. The launcher exposes a `Sign in` action that opens the marketing site in the browser.
3. The marketing site is an Astro app configured with Clerk.
4. The marketing site uses Clerk redirect buttons for sign in and sign up.
5. After successful auth, the browser goes to `/auth/complete`.
6. The `/auth/complete` page reads the signed-in user from Clerk server-side.
7. That page redirects to the desktop callback URL:
   - `http://127.0.0.1:<port>/auth/callback?userId=...&email=...&name=...&avatarUrl=...`
8. Electron receives the localhost callback.
9. Electron parses the callback payload and stores the user in SQLite.

## What Was Implemented

### Desktop side

- Added a localhost callback server for auth handoff.
- Added a single-instance lock so the app can receive callback launches.
- Added local SQLite storage for auth users.
- Added an `auth_users` table to persist a minimal identity snapshot.
- Added helper functions to upsert auth users into SQLite.
- Kept the launcher focused on opening the browser auth flow instead of embedding auth UI.

### Marketing side

- Turned the Astro app into a Clerk-backed auth surface.
- Added the Astro Node adapter so Clerk server-side helpers can work.
- Added Clerk middleware.
- Added a landing page with built-in Clerk `SignInButton` and `SignUpButton`.
- Added `/auth/complete` to read Clerk user data and redirect back to the desktop protocol.

## Files Changed

### Desktop app

- `/Users/harshithpasupuleti/code/omni/electron/main.ts`
- `/Users/harshithpasupuleti/code/omni/electron/db.ts`
- `/Users/harshithpasupuleti/code/omni/src/launch/app.tsx`

### Marketing app

- `/Users/harshithpasupuleti/code/omni/marketing/astro.config.mjs`
- `/Users/harshithpasupuleti/code/omni/marketing/package.json`
- `/Users/harshithpasupuleti/code/omni/marketing/bun.lock`
- `/Users/harshithpasupuleti/code/omni/marketing/src/middleware.ts`
- `/Users/harshithpasupuleti/code/omni/marketing/src/layouts/Layout.astro`
- `/Users/harshithpasupuleti/code/omni/marketing/src/pages/index.astro`
- `/Users/harshithpasupuleti/code/omni/marketing/src/pages/auth/complete.astro`

## Data Stored Locally

The auth snapshot stored in SQLite is intentionally small:

- `provider`
- `provider_user_id`
- `email`
- `name`
- `avatar_url`
- `created_at`
- `updated_at`
- `last_seen_at`

This is for tracking and attribution only.

## End Goal

The final target is:

- Auth happens on the web.
- Electron launches the browser auth page.
- Clerk handles the sign-in/sign-up experience.
- The browser returns control to the desktop app through a localhost callback after auth.
- Electron persists a local identity snapshot.
- The launcher continues to project selection only after auth and background workspace setup are both complete.

## Current Status

What is working now:

- Marketing builds successfully.
- Electron has a protocol-based auth callback path.
- SQLite persistence for auth users exists.
- Launcher opens the browser auth flow.

What still needs attention if we keep iterating:

- Renderer-side auth state access through a clean IPC API.
- Possible normalization of the callback payload if Clerk returns more fields later.
- Additional UI polish around the post-auth desktop transition.
