import { Children, Fragment, isValidElement, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** Grouped settings-style list, like SwiftUI's `Form`. */
export function Form({ children, ...rest }: ScrollViewProps & { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.groupedBackground }}
      contentContainerStyle={styles.form}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.section}>
      {header ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.header}>
          {header.toUpperCase()}
        </ThemedText>
      ) : null}
      {rows.length > 0 ? (
        <View style={[styles.rows, { backgroundColor: theme.groupedRow }]}>
          {rows.map((row, i) => (
            <Fragment key={row.key ?? i}>
              {i > 0 ? (
                <View style={[styles.separator, { backgroundColor: theme.separator }]} />
              ) : null}
              {row}
            </Fragment>
          ))}
        </View>
      ) : null}
      {footer ? (
        typeof footer === "string" ? (
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.footer}>
            {footer}
          </ThemedText>
        ) : (
          <View style={styles.footer}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

export function Row({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  const theme = useTheme();
  if (!onPress) return <View style={styles.row}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Label on the left, value on the right (`LabeledContent`). */
export function LabeledRow({
  label,
  value,
  onPress,
  accessory,
}: {
  label: string;
  value?: string | null;
  onPress?: () => void;
  accessory?: ReactNode;
}) {
  return (
    <Row onPress={onPress}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <View style={styles.value}>
        {accessory ?? (
          <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.valueText}>
            {value ?? "—"}
          </ThemedText>
        )}
      </View>
    </Row>
  );
}

export function ButtonRow({
  title,
  onPress,
  disabled,
  loading,
  destructive,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const color: ThemeColor = disabled ? "textSecondary" : destructive ? "danger" : "tint";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && { backgroundColor: theme.backgroundSelected },
      ]}
    >
      <ThemedText themeColor={color} style={styles.label}>
        {title}
      </ThemedText>
      {loading ? <ActivityIndicator /> : null}
    </Pressable>
  );
}

/** Colored status line (notices, errors, checks). */
export function StatusRow({
  text,
  color = "text",
  icon,
}: {
  text: string;
  color?: ThemeColor;
  icon?: ReactNode;
}) {
  return (
    <Row>
      {icon}
      <ThemedText themeColor={color} style={styles.label}>
        {text}
      </ThemedText>
    </Row>
  );
}

const styles = StyleSheet.create({
  form: { paddingVertical: Spacing.three, paddingHorizontal: Spacing.three, gap: Spacing.four },
  section: { gap: Spacing.two - 2 },
  header: { paddingHorizontal: Spacing.three },
  footer: { paddingHorizontal: Spacing.three },
  rows: { borderRadius: 12, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  row: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  label: { flex: 1 },
  value: { flexShrink: 1, maxWidth: "60%", alignItems: "flex-end" },
  valueText: { textAlign: "right" },
});
