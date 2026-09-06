import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode as QrCodeIcon, RefreshCw } from "lucide-react";

interface RemoteInfo {
  enabled: boolean;
  port: number | null;
  token: string | null;
  pairingUrl: string | null;
}

/** Settings → Remote access: QR + token pairing for the phone PWA. */
export function RemoteAccessSettings() {
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await window.omni.remote.getInfo();
      setInfo(next);
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!info?.pairingUrl) {
      setQr(null);
      return;
    }
    let cancelled = false;
    setQrError(null);
    QRCode.toDataURL(info.pairingUrl, { width: 220, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setQr(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQrError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [info?.pairingUrl]);

  const regenerate = async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      const next = await window.omni.remote.regenerateToken();
      setInfo((prev) =>
        prev ? { ...prev, token: next.token, pairingUrl: next.pairingUrl } : prev,
      );
    } finally {
      setSpinning(false);
    }
  };

  if (!info?.enabled) {
    return (
      <div className="px-4 py-3 text-[12px] text-muted-foreground">
        Remote access is disabled (PIPPER_REMOTE_ENABLED=0).
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-muted-foreground shadow-surface-1">
        <QrCodeIcon className="size-[18px]" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground">Phone pairing</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          Scan with your phone camera — the link opens the remote app and pairs it automatically.
        </div>
        {qr ? (
          <img
            src={qr}
            alt="Pairing QR code"
            width={220}
            height={220}
            className="mt-3 rounded-xl border border-border/70 bg-white p-2"
          />
        ) : (
          <div className="mt-3 text-[11px] leading-4 text-muted-foreground">
            {info.pairingUrl
              ? (qrError ?? "Generating QR…")
              : "No network address found — connect Tailscale, then reopen Settings."}
          </div>
        )}
        {info.pairingUrl && (
          <div className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
            {info.pairingUrl.split("#")[0]}
          </div>
        )}
        {info.token && (
          <div className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
            {info.token}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <button
          onClick={() => void regenerate()}
          disabled={spinning}
          title="Generate a new token (unpairs phones)"
          className="flex size-9 items-center justify-center rounded-lg bg-surface-3 text-muted-foreground shadow-surface-1 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${spinning ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
