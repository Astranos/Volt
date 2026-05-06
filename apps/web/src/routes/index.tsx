import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        color: "white",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚡ Volt Scanner</h1>
      <p style={{ fontSize: "1.25rem", opacity: 0.8, maxWidth: "500px" }}>
        Scan barcodes with your phone and type them at your cursor on desktop.
      </p>
      <p style={{ marginTop: "2rem", opacity: 0.6 }}>
        Open the Volt extension sidepanel and select "Mobile Scanner" to get
        started.
      </p>
    </div>
  );
}
