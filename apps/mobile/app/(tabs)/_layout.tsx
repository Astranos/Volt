import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor="#16a34a"
      iconColor={{ default: "#78716c", selected: "#16a34a" }}
      labelStyle={{
        default: { color: "#78716c", fontSize: 11, fontWeight: "600" },
        selected: { color: "#16a34a", fontSize: 11, fontWeight: "700" },
      }}
      backgroundColor="#ffffff"
      blurEffect="systemChromeMaterialLight"
      minimizeBehavior="automatic"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "barcode.viewfinder", selected: "barcode.viewfinder" }} />
        <Label>Scanner</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <Icon sf={{ default: "clock", selected: "clock.fill" }} />
        <Label>History</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dictation">
        <Icon sf={{ default: "mic", selected: "mic.fill" }} />
        <Label>Dictation</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
