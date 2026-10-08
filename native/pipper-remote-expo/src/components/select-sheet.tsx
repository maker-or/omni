import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Form, LabeledRow, Row, Section } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export interface SelectOption {
  id: string;
  label: string;
  detail?: string;
}

/** A sheet listing options with a checkmark on the current one. */
export function SelectSheet({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={Platform.OS === "ios" ? [] : ["top", "bottom"]}
        style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}
      >
        <View style={styles.bar}>
          <ThemedText type="headline">{title}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12} style={styles.done}>
            <ThemedText themeColor="tint" style={styles.doneText}>
              Done
            </ThemedText>
          </Pressable>
        </View>
        <Form>
          <Section>
            {options.map((option) => (
              <Row
                key={option.id}
                onPress={() => {
                  onSelect(option.id);
                  onClose();
                }}
              >
                <View style={styles.option}>
                  <ThemedText>{option.label}</ThemedText>
                  {option.detail ? (
                    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                      {option.detail}
                    </ThemedText>
                  ) : null}
                </View>
                {option.id === selected ? (
                  <Icon
                    ios="checkmark"
                    android="check"
                    color={theme.tint}
                    size={18}
                    weight="semibold"
                  />
                ) : null}
              </Row>
            ))}
          </Section>
        </Form>
      </SafeAreaView>
    </Modal>
  );
}

/** Form row that opens a `SelectSheet` (SwiftUI's `Picker` in a `Form`). */
export function PickerRow({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: SelectOption[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === selected)?.label ?? "—";
  return (
    <>
      <LabeledRow
        label={label}
        value={current}
        onPress={disabled ? undefined : () => setOpen(true)}
      />
      <SelectSheet
        visible={open}
        title={label}
        options={options}
        selected={selected}
        onSelect={onSelect}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  done: { position: "absolute", right: Spacing.three, top: Spacing.three },
  doneText: { fontWeight: "600" },
  option: { flex: 1, gap: 2 },
});
