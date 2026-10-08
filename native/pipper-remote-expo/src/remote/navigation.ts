import { router } from "expo-router";

import type { PairingLink } from "./pairing-link";

/**
 * Links, scans, and the URL scheme can come from anyone, so every route into
 * pairing ends on the confirmation screen; nothing pairs silently.
 */
export function confirmPairing(link: PairingLink, replace = false): void {
  const href = {
    pathname: "/confirm-pairing",
    params: { base: link.baseURL, code: link.code },
  } as const;
  if (replace) router.replace(href);
  else router.push(href);
}
