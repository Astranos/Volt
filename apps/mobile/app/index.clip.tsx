import { StyleSheet, Text, View } from "react-native";

export default function ClipIndex() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Volt Clip</Text>
      <Text style={styles.text}>Scan a Volt Chrome extension QR code to start a capture session.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: "#ffffff",
  },
  title: {
    color: "#1c1917",
    fontSize: 28,
    fontWeight: "800",
  },
  text: {
    color: "#57534e",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
