import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, TextInput } from "react-native";

import { ButtonRow, Form, Row, Section, StatusRow } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { confirmPairing } from "@/remote/navigation";
import { manualPairingLink, parsePairingLink } from "@/remote/pairing-link";
import { useRemoteSession } from "@/remote/session";

/**
 * Pair with the laptop: scan the QR from Pipper → Settings → Remote → Pair a
 * phone, or paste its pairing link (or type the address and code).
 */
export default function PairScreen() {
  const theme = useTheme();
  const { pairNotice } = useRemoteSession();
  // pipper-remote://pair?url=<encoded pairing link>
  const { url } = useLocalSearchParams<{ url?: string }>();
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const link = url ? parsePairingLink(url) : null;
    if (link) confirmPairing(link);
  }, [url]);

  const manual = manualPairingLink(address, code);
  const inputStyle = [styles.input, { color: theme.text }];

  return (
    <Form>
      {pairNotice ? (
        <Section>
          <StatusRow
            text={pairNotice}
            color="warning"
            icon={
              <Icon
                ios="exclamationmark.triangle"
                android="warning"
                color={theme.warning}
                size={18}
              />
            }
          />
        </Section>
      ) : null}
      <Section footer="On your Mac: Pipper → Settings → Remote → Pair a phone.">
        <Row onPress={() => router.push("/scan")}>
          <Icon ios="qrcode.viewfinder" android="qr_code_scanner" color={theme.tint} />
          <ThemedText themeColor="tint" style={styles.flex}>
            Scan pairing QR
          </ThemedText>
        </Row>
      </Section>
      <Section
        header="Or enter manually"
        footer="Paste the pairing link from your Mac, or type its address (lt-….pipper.dev) and the code shown under the QR."
      >
        <Row>
          <TextInput
            style={inputStyle}
            value={address}
            onChangeText={(value) => {
              setAddress(value);
              // A pasted pairing link carries its own code: show it.
              const link = parsePairingLink(value);
              if (link) setCode(link.code);
            }}
            placeholder="Pairing link or laptop address"
            placeholderTextColor={theme.textSecondary}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Row>
        <Row>
          <TextInput
            style={inputStyle}
            value={code}
            onChangeText={setCode}
            placeholder="Code (XXXXX-XXXXX)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            textContentType="oneTimeCode"
            returnKeyType="go"
            onSubmitEditing={() => manual && confirmPairing(manual)}
          />
        </Row>
      </Section>
      <Section>
        <ButtonRow
          title="Continue"
          disabled={!manual}
          onPress={() => manual && confirmPairing(manual)}
        />
      </Section>
    </Form>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  input: { flex: 1, fontSize: 17, paddingVertical: 0 },
});
