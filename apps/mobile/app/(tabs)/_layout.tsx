import { NativeTabs as ExpoNativeTabs } from "expo-router/unstable-native-tabs";

const NativeTabs = ExpoNativeTabs as any;

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor="#16a34a"
      iconColor={{ default: "#d6d3d1", selected: "#86efac" }}
      labelStyle={{
        default: { color: "#d6d3d1", fontSize: 11, fontWeight: "600" },
        selected: { color: "#86efac", fontSize: 11, fontWeight: "700" },
      }}
      backgroundColor="rgba(28, 25, 23, 0.72)"
      blurEffect="systemChromeMaterialDark"
      minimizeBehavior="never"
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index" disableScrollToTop>
        <NativeTabs.Trigger.Icon sf={{ default: "doc.text.viewfinder", selected: "doc.text.viewfinder" }} />
        <NativeTabs.Trigger.Label>OCR</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="scanner" disableScrollToTop>
        <NativeTabs.Trigger.Icon sf={{ default: "barcode.viewfinder", selected: "barcode.viewfinder" }} />
        <NativeTabs.Trigger.Label>Scanner</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="photos" disableScrollToTop>
        <NativeTabs.Trigger.Icon sf={{ default: "photo.on.rectangle", selected: "photo.fill.on.rectangle.fill" }} />
        <NativeTabs.Trigger.Label>Photos</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dictation" disableScrollToTop>
        <NativeTabs.Trigger.Icon sf={{ default: "mic", selected: "mic.fill" }} />
        <NativeTabs.Trigger.Label>Dictation</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" disableScrollToTop>
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
