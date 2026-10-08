import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { confirmPairing } from "@/remote/navigation";
import { parsePairingLink } from "@/remote/pairing-link";

const NOT_PAIRING_QR =
  "That QR isn't a Pipper pairing code. Make a new one on your Mac: Settings → Remote → Pair a phone.";

/** Camera QR reader for the laptop's pairing code. */
export default function ScanScreen() {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  /** The camera reports the same code many times a second; act once. */
  const handled = useRef(false);
  const lastRejected = useRef<string | null>(null);

  if (!permission) return <View style={styles.camera} />;

  if (!permission.granted) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText type="headline">Camera access needed</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          Allow camera access to scan the QR, or enter the pairing link manually.
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            permission.canAskAgain ? void requestPermission() : void Linking.openSettings()
          }
        >
          <ThemedText themeColor="tint" style={styles.action}>
            {permission.canAskAgain ? "Allow camera" : "Open Settings"}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.camera}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || data === lastRejected.current) return;
          const link = parsePairingLink(data);
          if (link) {
            handled.current = true;
            confirmPairing(link, true);
          } else {
            lastRejected.current = data;
            setError(NOT_PAIRING_QR);
          }
        }}
      />
      <View pointerEvents="none" style={styles.overlay}>
        <View style={styles.frame} />
        {error ? (
          <ThemedText style={styles.error} type="footnote">
            {error}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, backgroundColor: "#000" },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
  },
  error: {
    color: "#fff",
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 10,
    marginHorizontal: Spacing.four,
    overflow: "hidden",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    padding: Spacing.four,
  },
  centerText: { textAlign: "center" },
  action: { fontWeight: "600", marginTop: Spacing.two },
});
