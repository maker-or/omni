import { useEffect, useState } from "react";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { pairWithCode, previewPairing, type PairingPreview } from "./api.ts";

/**
 * Shown for pairing links and scanned QR codes before anything is paired: a
 * link can come from anyone, and pairing makes that laptop the destination
 * for this phone's prompts. The user sees whose laptop it is and decides.
 */
export function ConfirmPairing({
  code,
  host,
  onPaired,
  onCancel,
}: {
  code: string;
  host: string | null;
  onPaired: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<PairingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    previewPairing(code, host)
      .then((p) => !cancelled && setPreview(p))
      .catch(
        (err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, [code, host]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await pairWithCode(code, host);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const owner = preview?.owner;
  const verified = owner?.verified ? owner.owner : null;
  const laptopName = preview?.laptop.name ?? "Laptop";

  return (
    <main className="pair-wrap">
      <h1>Pair with this laptop?</h1>
      {!preview && !error && <p>Checking the laptop…</p>}
      {preview && (
        <div className="confirm-card">
          <p className="confirm-laptop">{laptopName}</p>
          {host && <p className="confirm-host">{host}</p>}
          {verified ? (
            <p className="confirm-owner good">
              <CheckCircle size={18} weight="fill" /> Belongs to{" "}
              <strong>{verified.email ?? verified.name ?? "a Pipper account"}</strong>
              {verified.email && verified.name ? ` (${verified.name})` : ""} — verified by Pipper
            </p>
          ) : owner && !owner.verified ? (
            <p className="notice warn">
              <Warning size={16} weight="fill" /> Unverified: {owner.reason} Pair only if you just
              created this code on your own laptop.
            </p>
          ) : (
            <p className="confirm-owner">This is the laptop serving this page.</p>
          )}
          {preview.otherOwners.length > 0 && (
            <p className="notice bad">
              <Warning size={16} weight="fill" /> Your other laptops belong to{" "}
              {preview.otherOwners.join(", ")}. This one doesn't — anything you send next would go
              to its owner instead. Continue only if you trust them.
            </p>
          )}
          <p className="confirm-hint">
            After pairing, the prompts you send from this phone go to this laptop.
          </p>
        </div>
      )}
      {error && <p className="notice bad">{error}</p>}
      <button className="pair-btn" disabled={!preview || busy} onClick={() => void confirm()}>
        {busy ? "Pairing…" : `Pair with ${laptopName}`}
      </button>
      <button className="pair-btn ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </main>
  );
}
