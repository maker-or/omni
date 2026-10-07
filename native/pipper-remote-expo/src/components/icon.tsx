import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ColorValue } from "react-native";

type Names = Exclude<SymbolViewProps["name"], string>;

/** SF Symbol on iOS, Material Symbol on Android. */
export function Icon({
  ios,
  android,
  size = 20,
  color,
  weight,
}: {
  ios: NonNullable<Names["ios"]>;
  android: NonNullable<Names["android"]>;
  size?: number;
  color: ColorValue;
  weight?: "regular" | "semibold" | "bold";
}) {
  return (
    <SymbolView
      name={{ ios, android }}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
    />
  );
}
