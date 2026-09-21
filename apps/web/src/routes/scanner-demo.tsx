import { createFileRoute } from "@tanstack/react-router";
import { useScannerDemoRuntime } from "./-scanner-demo-runtime";
import { ScannerDemoView } from "./-scanner-demo-view";
export type { CaptureItem, PhotoItem, DemoStatus } from "./-scanner-demo-model";

export const Route = createFileRoute("/scanner-demo")({
  component: ScannerDemo,
});

export function ScannerDemo() {
  return <ScannerDemoView {...useScannerDemoRuntime()} />;
}
