import { useState } from "react";
import { QrCode } from "@phosphor-icons/react";
import { pairWithCode, pairingCodeFromUrl } from "./api.ts";

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => {
  detect(v: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
};

/** Read a pairing QR with the camera; resolves to the scanned text or null. */
async function scanQrCode(): Promise<string | null> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Detector) throw new Error("Camera scan isn't supported here — type the code instead.");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    const detector = new Detector({ formats: ["qr_code"] });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const codes = await detector.detect(video).catch(() => []);
      if (codes[0]?.rawValue) return codes[0].rawValue;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function PairScreen({ notice, onPaired }: { notice: string | null; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redeem = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await pairWithCode(value);
      onPaired();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setError(null);
    try {
      const text = await scanQrCode();
      const scanned = text ? pairingCodeFromUrl(text) : null;
      if (scanned) await redeem(scanned);
      else setError("No pairing QR found in 30s — try again or type the code.");
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("type the code")
          ? err.message
          : "Camera unavailable — type the code instead.",
      );
    }
  };

  return (
    <main className="pair-wrap">
      <h1>Omni Remote</h1>
      {notice && <p className="notice warn">{notice}</p>}
      <p>
        On your laptop, open Settings → Remote → Pair a phone, then scan the QR or type the code.
      </p>
      <input
        className="pair-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void redeem(code);
        }}
        placeholder="XXXXX-XXXXX"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
      />
      <button
        className="pair-btn"
        disabled={busy || !code.trim()}
        onClick={() => void redeem(code)}
      >
        {busy ? "Pairing…" : "Pair"}
      </button>
      <button className="pair-btn ghost" disabled={busy} onClick={() => void scan()}>
        <QrCode size={18} style={{ verticalAlign: "-3px" }} /> Scan QR instead
      </button>
      {error && <p className="notice bad">{error}</p>}
    </main>
  );
}
