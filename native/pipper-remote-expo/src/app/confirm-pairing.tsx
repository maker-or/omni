import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable } from "react-native";

import { ButtonRow, Form, LabeledRow, Row, Section, StatusRow } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { verifyLaptopOwner, type OwnerCheck } from "@/remote/attestation";
import { errorMessage, RemoteClient } from "@/remote/client";
import { ownerLabel } from "@/remote/catalog";
import { manualPairingLink } from "@/remote/pairing-link";
import { remoteSession } from "@/remote/session";
import type { RemoteLaptopIdentity } from "@/remote/types";

/**
 * Who the laptop is, before this phone redeems the code: a pairing link
 * could point at anyone's laptop, and pairing makes it the destination for
 * every task sent from this phone.
 */
export default function ConfirmPairingScreen() {
  const params = useLocalSearchParams<{ base?: string; code?: string }>();
  // Params may arrive from a deep link too: re-check the address rules.
  const link = manualPairingLink(params.base ?? "", params.code ?? "");
  const [laptop, setLaptop] = useState<RemoteLaptopIdentity | null>(null);
  /** Null when the laptop isn't on a named tunnel, so no owner can be checked. */
  const [owner, setOwner] = useState<OwnerCheck | null>(null);
  const [error, setError] = useState<string | null>(
    link ? null : "This pairing link doesn't point to a Pipper laptop.",
  );
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    const target = manualPairingLink(params.base ?? "", params.code ?? "");
    if (!target) return;
    let cancelled = false;
    RemoteClient.previewPairing(target).then(
      (identity) => {
        if (cancelled) return;
        if (target.isNamedTunnel) {
          setOwner(verifyLaptopOwner(identity.attestation, target.host));
        }
        setLaptop(identity);
      },
      (e: unknown) => !cancelled && setError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [params.base, params.code]);

  const pair = async () => {
    if (!link || pairing) return;
    setPairing(true);
    setError(null);
    try {
      // Pairing flips the route guards: this screen closes and the paired
      // app replaces the pairing screens.
      await remoteSession.pair(link, owner?.verified ? owner.owner : null);
    } catch (e) {
      setError(errorMessage(e));
      setPairing(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          gestureEnabled: !pairing,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              disabled={pairing}
              hitSlop={12}
              onPress={() => router.back()}
            >
              <ThemedText themeColor={pairing ? "textSecondary" : "tint"}>Cancel</ThemedText>
            </Pressable>
          ),
        }}
      />
      <Form>
        <Section footer="After pairing, the tasks you send from this phone go to this laptop.">
          {laptop && link ? (
            <>
              <LabeledRow label="Laptop" value={laptop.name} />
              <LabeledRow label="Address" value={link.host} />
              <OwnerRow owner={owner} />
            </>
          ) : !error ? (
            <Row>
              <ActivityIndicator />
              <ThemedText themeColor="textSecondary">Checking the laptop…</ThemedText>
            </Row>
          ) : null}
        </Section>
        {error ? (
          <Section>
            <StatusRow text={error} color="danger" />
          </Section>
        ) : null}
        <Section>
          <ButtonRow
            title={`Pair with ${laptop?.name ?? "this laptop"}`}
            disabled={!laptop || pairing}
            loading={pairing}
            onPress={() => void pair()}
          />
        </Section>
      </Form>
    </>
  );
}

function OwnerRow({ owner }: { owner: OwnerCheck | null }) {
  const theme = useTheme();
  if (owner?.verified) {
    return (
      <StatusRow
        color="success"
        text={`Belongs to ${ownerLabel(owner.owner)} — verified by Pipper`}
        icon={<Icon ios="checkmark.seal.fill" android="verified" color={theme.success} size={18} />}
      />
    );
  }
  return (
    <StatusRow
      color={owner ? "warning" : "textSecondary"}
      text={
        owner
          ? `Unverified: ${owner.reason} Pair only if you just made this code on your own Mac.`
          : "This laptop isn't on Pipper's network, so its owner can't be checked. Pair only if you just made this code on your own Mac."
      }
      icon={
        <Icon
          ios="exclamationmark.triangle.fill"
          android="warning"
          color={owner ? theme.warning : theme.textSecondary}
          size={18}
        />
      }
    />
  );
}
