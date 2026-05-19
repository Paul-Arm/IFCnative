import { type ReactNode, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";

import { MOSAIC_TITLES } from "./constants";
import { styles } from "./styles";
import type { MosaicViewId } from "./types";

export function Button({
  disabled,
  label,
  onPress,
  primary,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonPrimaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MosaicWindowMenu({
  closedIds,
  onRestore,
}: {
  closedIds: MosaicViewId[];
  onRestore(id: MosaicViewId): void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.windowMenu}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.button,
          styles.windowMenuButton,
          (open || pressed) && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>
          Windows{closedIds.length ? ` (${closedIds.length})` : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.windowMenuPanel}>
          {closedIds.length ? (
            closedIds.map((id) => (
              <Pressable
                key={id}
                onPress={() => {
                  onRestore(id);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.windowMenuOption,
                  pressed && styles.windowMenuOptionPressed,
                ]}
              >
                <Text style={styles.windowMenuOptionText} numberOfLines={1}>
                  {MOSAIC_TITLES[id]}
                </Text>
                <Text style={styles.windowMenuOptionMeta}>Open</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.windowMenuEmpty}>All windows are open</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <ScrollView
      accessibilityRole="tablist"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.segmented}
      contentContainerStyle={styles.segmentedContent}
    >
      {options.map((option) => {
        const selected = value === option;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentActive,
              pressed && !selected && styles.segmentPressed,
            ]}
          >
            <Text
              style={[styles.segmentText, selected && styles.segmentTextActive]}
              numberOfLines={1}
            >
              {option}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function LabeledInput({
  keyboardType,
  label,
  multiline,
  mono,
  onChangeText,
  value,
}: {
  keyboardType?: "default" | "numeric";
  label: string;
  multiline?: boolean;
  mono?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.textArea,
          mono && styles.monoInput,
        ]}
        value={value}
      />
    </View>
  );
}

export interface DropdownOption {
  value: string;
  label: string;
  detail?: string;
}

export function DropdownField({
  label,
  overlay,
  options,
  value,
  onChange,
}: {
  label: string;
  overlay?: boolean;
  options: (string | DropdownOption)[];
  value: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = useMemo(
    () => normalizeDropdownOptions(options),
    [options],
  );
  const selected = normalized.find((option) => option.value === value) ?? {
    detail: "custom value",
    label: value || "Select",
    value,
  };

  return (
    <View style={[styles.field, overlay && styles.dropdownFieldOverlay]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={styles.dropdownButton}
      >
        <View style={styles.dropdownTextWrap}>
          <Text style={styles.dropdownButtonText} numberOfLines={1}>
            {selected.label}
          </Text>
          {selected.detail ? (
            <Text style={styles.dropdownDetail} numberOfLines={1}>
              {selected.detail}
            </Text>
          ) : null}
        </View>
        <Text style={styles.dropdownCaret}>{open ? "^" : "v"}</Text>
      </Pressable>
      {open ? (
        <View
          style={[styles.dropdownMenu, overlay && styles.dropdownMenuOverlay]}
        >
          <ScrollView nestedScrollEnabled style={styles.dropdownList}>
            {normalized.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.dropdownOption,
                  value === option.value && styles.dropdownOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    value === option.value && styles.dropdownOptionTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {option.detail ? (
                  <Text
                    style={[
                      styles.dropdownOptionDetail,
                      value === option.value && styles.dropdownOptionTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {option.detail}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function EntityDropdown({
  document,
  label,
  value,
  onChange,
}: {
  document: NativeIfcDocument;
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const options = useMemo(() => {
    const selected = document.entityById.get(Number(value));
    const priorityTypes = new Set([
      "IFCPROJECT",
      "IFCSITE",
      "IFCBUILDING",
      "IFCBUILDINGSTOREY",
      "IFCSPACE",
      "IFCBUILDINGELEMENTPROXY",
      "IFCBUILTELEMENT",
      "IFCWALL",
      "IFCSLAB",
      "IFCBEAM",
      "IFCCOLUMN",
      "IFCDOOR",
      "IFCWINDOW",
      "IFCPROPERTYSET",
      "IFCELEMENTQUANTITY",
      "IFCMATERIAL",
      "IFCGROUP",
    ]);
    const priority = document.entities
      .filter((entity) => priorityTypes.has(entity.type))
      .slice(0, 260);
    const fallback = document.entities.slice(0, 260);
    return normalizeDropdownOptions([
      ...(selected ? [entityDropdownOption(selected)] : []),
      ...priority.map(entityDropdownOption),
      ...fallback.map(entityDropdownOption),
    ]);
  }, [document, value]);

  return (
    <DropdownField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function normalizeDropdownOptions(options: (string | DropdownOption)[]) {
  const seen = new Set<string>();
  const normalized: DropdownOption[] = [];
  for (const option of options) {
    const item =
      typeof option === "string"
        ? { label: shortType(option), value: option }
        : option;
    if (!item.value || seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);
    normalized.push(item);
  }
  return normalized;
}

export function typeOption(value: string): DropdownOption {
  return {
    label: shortType(value),
    value,
  };
}

function entityDropdownOption(entity: NativeIfcEntity): DropdownOption {
  return {
    detail: entity.name || entity.globalId || entity.description || "",
    label: `#${entity.id} ${shortType(entity.type)}`,
    value: String(entity.id),
  };
}

export function InfoSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.infoSection}>
      <Text style={styles.infoTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function CollapsibleSection({
  children,
  defaultOpen = false,
  meta,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.collapsibleSection}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.collapsibleHeader,
          pressed && styles.segmentPressed,
        ]}
      >
        <View style={styles.collapsibleHeaderText}>
          <Text style={styles.collapsibleTitle}>{title}</Text>
          {meta ? (
            <Text style={styles.collapsibleMeta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Text style={styles.dropdownCaret}>{open ? "^" : "v"}</Text>
      </Pressable>
      {open ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoText}>{value}</Text>
    </View>
  );
}

function shortType(type: string) {
  return type.replace(/^IFC/i, "");
}
