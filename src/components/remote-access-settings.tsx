import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  CloudArrowUp,
  DeviceMobile,
  QrCode as QrCodeIcon,
  SignIn,
  Trash,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  RemoteDevice,
  RemoteDevicesState,
  RemotePairingOffer,
  RemoteServerInfo,
  RemoteTunnelStatus,
} from "../../contracts/remote.ts";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatLastSeen(at: number | null, now: number): string {
  if (!at) return "Never used";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `Last used ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last used ${hours} h ago`;
  return `Last used ${Math.floor(hours / 24)} d ago`;
}

function tunnelLabel(status: RemoteTunnelStatus, now: number): string {
  switch (status.state) {
    case "stopped":
      return "Tunnel stopped.";
    case "installing":
      return "Preparing cloudflared — the first run downloads it (about 20–55 MB).";
    case "starting":
      return "Starting tunnel…";
    case "connected":
      return `Online at ${status.url}`;
    case "reconnecting": {
      const wait = Math.max(0, Math.ceil((status.retryAt - now) / 1000));
      return `Reconnecting in ${wait}s${status.lastError ? ` — ${status.lastError}` : ""}`;
    }
    case "error":
      return status.message;
  }
}

/**
 * The named tunnel needs the laptop credential pipper.dev issues at sign-in.
 * Sign-ins from before it existed lack one, and pipper.dev can expire or
 * revoke it; either way only a fresh browser sign-in fixes it. The tunnel
 * restarts on its own once the sign-in completes.
 */
function ReauthenticatePrompt() {
  const [state, setState] = useState<"idle" | "opening" | "waiting">("idle");
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setState("opening");
    setError(null);
    try {
      await window.omni.shell.openExternal("clerk:sign-in");
      setState("waiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };

  return (
    <div className="mt-2 rounded-[10px] bg-surface-3 px-3 py-2.5 shadow-surface-1">
      <div className="text-[12px] font-medium text-foreground">Sign in again to connect</div>
      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        Pipper on this Mac doesn't have a valid laptop credential, the key pipper.dev uses to give
        this laptop its own tunnel address. Sign-ins from older versions of Pipper didn't receive
        one, and pipper.dev stops accepting it if it expires or is revoked. Signing in again in your
        browser issues a new one; the tunnel starts as soon as it finishes.
      </div>
      {error && <div className="mt-1 text-[11px] leading-4 text-red-500">{error}</div>}
      <div className="mt-2 flex items-center gap-3">
        <Button
          size="sm"
          leadingIcon={SignIn}
          disabled={state === "opening"}
          onClick={() => void signIn()}
        >
          {state === "opening" ? "Opening browser…" : "Sign in again"}
        </Button>
        {state === "waiting" && (
          <span className="text-[11px] text-muted-foreground">
            Finish signing in in your browser, then come back here.
          </span>
        )}
      </div>
    </div>
  );
}

/** Choose how phones reach this laptop: Tailscale or a Cloudflare tunnel. */
function ConnectionSection({
  info,
  now,
  busy,
  onToggle,
}: {
  info: RemoteServerInfo;
  now: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const viaTunnel = info.transport !== "tailscale";
  const quick = info.transport === "cloudflare-quick";
  return (
    <div className="flex items-start gap-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        <CloudArrowUp className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">Connection</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {quick
            ? "Development quick tunnel: the address changes whenever it restarts, so phones pair again after that."
            : viaTunnel
              ? "Phones connect over HTTPS at this laptop's own fixed address through Cloudflare — nothing to install. Uses your Pipper sign-in."
              : "Phones connect over Tailscale. Both devices need Tailscale installed and signed in."}
        </div>
        {/* -ml-3 cancels the Switch's hover-pill padding so the track aligns with the text. */}
        <div className="mt-1 -ml-3">
          <Switch
            label="Use Cloudflare tunnel"
            checked={viaTunnel}
            disabled={busy}
            onToggle={onToggle}
          />
        </div>
        {viaTunnel && (
          <div
            className={`mt-2 text-[11px] leading-4 break-all ${
              info.tunnel.state === "connected" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {tunnelLabel(info.tunnel, now)}
          </div>
        )}
        {viaTunnel && info.tunnel.state === "error" && info.tunnel.signInRequired && (
          <ReauthenticatePrompt />
        )}
      </div>
    </div>
  );
}

function PairingOffer({
  offer,
  now,
  onCancel,
}: {
  offer: RemotePairingOffer;
  now: number;
  onCancel: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    if (!offer.pairingUrl) return;
    let cancelled = false;
    setQr(null);
    setQrError(null);
    QRCode.toDataURL(offer.pairingUrl, { width: 200, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setQr(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQrError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [offer.pairingUrl]);

  return (
    <div className="mt-3 flex items-start gap-4 pl-[52px]">
      {offer.pairingUrl &&
        (qr ? (
          <img
            src={qr}
            alt="Pairing QR code"
            width={200}
            height={200}
            className="shrink-0 rounded-xl border border-border/70 bg-white p-2"
          />
        ) : (
          <div className="flex size-[200px] shrink-0 items-center justify-center rounded-xl border border-border/70 text-[11px] text-muted-foreground">
            {qrError ?? "Generating QR…"}
          </div>
        ))}
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">Or type this code on the phone</div>
        <div className="mt-1 font-mono text-[20px] tracking-[0.12em] text-foreground select-all">
          {offer.code}
        </div>
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Works once · expires in {formatCountdown(offer.expiresAt - now)}
          {offer.scopes.includes("run") ? "" : " · read-only"}
        </div>
        <Button className="mt-3" variant="tertiary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DeviceRow({
  device,
  now,
  onRevoke,
}: {
  device: RemoteDevice;
  now: number;
  onRevoke: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <DeviceMobile className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{device.name}</div>
        <div className="text-[11px] leading-4 text-muted-foreground">
          {device.scopes.includes("run") ? "Can start tasks" : "Read-only"} ·{" "}
          {formatLastSeen(device.lastSeenAt, now)}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${device.name}`}
        title="Remove — this phone must pair again"
        onClick={onRevoke}
      >
        <Trash size={16} />
      </Button>
    </li>
  );
}

/** Settings → Remote: one-time pairing codes and the paired-device list. */
export function RemoteAccessSettings() {
  const [info, setInfo] = useState<RemoteServerInfo | null>(null);
  const [state, setState] = useState<RemoteDevicesState | null>(null);
  const [allowRun, setAllowRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [nextInfo, nextState] = await Promise.all([
      window.omni.remote.getInfo().catch(() => null),
      window.omni.remote.getDevices().catch(() => null),
    ]);
    setInfo(nextInfo);
    setState(nextState);
  }, []);

  useEffect(() => {
    void load();
    const offDevices = window.omni.remote.onDevicesChanged(setState);
    const offInfo = window.omni.remote.onInfoChanged(setInfo);
    return () => {
      offDevices();
      offInfo();
    };
  }, [load]);

  // Tick for the expiry countdown and "last used" labels; an expired offer
  // is dropped locally (the laptop has already stopped accepting it).
  const offer = state?.offer && state.offer.expiresAt > now ? state.offer : null;
  const fastTick = Boolean(offer) || info?.tunnel.state === "reconnecting";
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), fastTick ? 1_000 : 30_000);
    return () => clearInterval(timer);
  }, [fastTick]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!info?.enabled) {
    return (
      <div className="px-4 py-3 text-[12px] text-muted-foreground">
        Remote access is disabled (PIPPER_REMOTE_ENABLED=0).
      </div>
    );
  }

  const unreachable = !info.serving
    ? (info.error ?? "The remote server couldn't start. Check the app log for [Remote] lines.")
    : info.publicUrl
      ? null
      : info.transport === "tailscale"
        ? "No Tailscale address — connect Tailscale, then reopen Settings."
        : info.tunnel.state === "error" && info.tunnel.signInRequired
          ? "Sign in again above; phones can pair once the tunnel is online."
          : "Waiting for the tunnel to come online before phones can pair.";
  const devices = state?.devices ?? [];

  return (
    <div className="px-4 py-3">
      <ConnectionSection
        info={info}
        now={now}
        busy={busy}
        onToggle={() =>
          void run(() =>
            window.omni.remote.setTransport(
              info.transport === "tailscale" ? "cloudflare" : "tailscale",
            ),
          )
        }
      />
      <div className="mt-4 flex items-start gap-4 border-t border-border/60 pt-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
          <QrCodeIcon className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground">Phone pairing</div>
          <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {unreachable ??
              "Each phone gets its own access that you can remove at any time. Codes work once and expire after 5 minutes."}
          </div>
        </div>
        {!offer && (
          <Button
            size="sm"
            leadingIcon={QrCodeIcon}
            disabled={busy || unreachable !== null}
            onClick={() => void run(() => window.omni.remote.createPairing({ allowRun }))}
          >
            Pair a phone
          </Button>
        )}
      </div>

      {offer ? (
        <PairingOffer
          offer={offer}
          now={now}
          onCancel={() => void run(() => window.omni.remote.cancelPairing())}
        />
      ) : (
        <div className="mt-2 pl-10">
          <Switch
            label="Allow starting tasks from the phone"
            checked={allowRun}
            onToggle={() => setAllowRun((value) => !value)}
          />
        </div>
      )}

      <div className="mt-4 border-t border-border/60 pt-3 pl-[52px]">
        <div className="text-[12px] font-medium text-foreground">Paired devices</div>
        {devices.length === 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground">No phones paired yet.</div>
        ) : (
          <ul className="mt-1 divide-y divide-border/50">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                now={now}
                onRevoke={() => void run(() => window.omni.remote.revokeDevice(device.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
