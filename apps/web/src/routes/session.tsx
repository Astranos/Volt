import { createFileRoute } from "@tanstack/react-router";

import { ScannerDemo } from "./scanner-demo";

export const Route = createFileRoute("/session")({
  component: ScannerDemo,
});
