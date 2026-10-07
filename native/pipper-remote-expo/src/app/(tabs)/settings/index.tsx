import { Stack } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ConnectionCheck } from "@/components/connection-check";
import { ButtonRow, Form, LabeledRow, Row, Section, StatusRow } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { configAddress, ownerLabel } from "@/remote/catalog";
import { dateTime } from "@/remote/format";
import { remoteSession, useRemoteSession } from "@/remote/session";

export default function SettingsScreen() {
  const theme = useTheme();
  const { config, catalog, catalogError, lastCatalogRefresh } = useRemoteSession();
  const [refreshing, setRefreshing] = useState(false);
  const [unpairing, setUnpairing] = useState(false);

  return (
    <>
      <Stack.Screen options={{ title: "Settings", headerLargeTitle: true }} />
      <Form>
        <Section header="Mac">
          <LabeledRow label="Name" value={config?.laptopName} />
          <LabeledRow label="Address" value={config ? configAddress(config) : null} />
          {config?.owner ? (
            <StatusRow
              color="success"
              text={`Belongs to ${ownerLabel(config.owner)} — verified by Pipper`}
              icon={
                <Icon
                  ios="checkmark.seal.fill"
                  android="verified"
                  color={theme.success}
                  size={18}
                />
              }
            />
          ) : null}
          {config?.deviceName ? <LabeledRow label="This phone" value={config.deviceName} /> : null}
        </Section>

        <ConnectionCheck />

        <Section
          header="Catalog"
          footer="Projects and agents from your Mac, cached so the app opens with them even when the Mac is asleep. Refreshes automatically when the app opens."
        >
          <ButtonRow
            title="Refresh catalog"
            loading={refreshing}
            disabled={refreshing}
            onPress={async () => {
              setRefreshing(true);
              await remoteSession.refreshCatalog();
              setRefreshing(false);
            }}
          />
          {catalogError ? <StatusRow color="danger" text={catalogError} /> : null}
          {lastCatalogRefresh ? (
            <LabeledRow label="Updated" value={dateTime(lastCatalogRefresh)} />
          ) : null}
        </Section>

        <Section header={`Projects (${catalog.projects.length})`}>
          {catalog.projects.map((p) => (
            <Row key={p.id}>
              <View style={styles.flex}>
                <ThemedText>{p.name}</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                  {p.path}
                </ThemedText>
              </View>
            </Row>
          ))}
        </Section>

        <Section header="Agents">
          {catalog.agents.map((a) => (
            <Row key={a.id}>
              <ThemedText>{a.displayName}</ThemedText>
              {a.id === catalog.defaultAgentId ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  default
                </ThemedText>
              ) : null}
              <View style={styles.flex} />
              <ThemedText type="caption" themeColor={a.available ? "success" : "textSecondary"}>
                {a.available ? "available" : "not installed"}
              </ThemedText>
            </Row>
          ))}
        </Section>

        <Section footer="Removes this phone from your Mac too, so its access ends everywhere.">
          <ButtonRow
            title="Unpair"
            destructive
            loading={unpairing}
            disabled={unpairing}
            onPress={async () => {
              setUnpairing(true);
              await remoteSession.unpair();
            }}
          />
        </Section>
      </Form>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
