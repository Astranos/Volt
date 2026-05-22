import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor="#16a34a"
      iconColor={{ default: "#78716c", selected: "#16a34a" }}
      labelStyle={{
        default: { color: "#78716c", fontSize: 11, fontWeight: "600" },
        selected: { color: "#16a34a", fontSize: 11, fontWeight: "600" },
      }}
      backgroundColor="#ffffff"
      blurEffect="systemChromeMaterialLight"
      minimizeBehavior="never"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index" disableScrollToTop>
        <Icon sf={{ default: "doc.text.viewfinder", selected: "doc.text.viewfinder" }} />
        <Label>OCR</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="scanner" disableScrollToTop>
        <Icon sf={{ default: "barcode.viewfinder", selected: "barcode.viewfinder" }} />
        <Label>Scanner</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dictation" disableScrollToTop>
        <Icon sf={{ default: "mic", selected: "mic.fill" }} />
        <Label>Dictation</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" disableScrollToTop>
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
