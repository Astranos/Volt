import { BookOpen, Calculator, ClipboardCheck, type LucideIcon, ScanLine } from "lucide-react";

export type SidepanelToolId = "top-offers" | "mobile-scanner" | "mobile-photos" | "handbook" | "shopify-audit";

export interface SidepanelToolMetadata {
  id: SidepanelToolId;
  label: string;
  description: string;
  icon: LucideIcon;
  color?: string;
}

export const SIDEPANEL_TOOLS: SidepanelToolMetadata[] = [
  {
    id: "top-offers",
    label: "Offer Calculator",
    description: "Open offer calculator in the sidepanel",
    icon: Calculator,
  },
  {
    id: "mobile-scanner",
    label: "Scanner",
    description: "Scan barcodes with your phone",
    icon: ScanLine,
  },
  {
    id: "handbook",
    label: "Handbook",
    description: "Look up store info, logins, and setup guides",
    icon: BookOpen,
  },
  {
    // Shown only while a Shopify audit is open or in progress.
    id: "shopify-audit",
    label: "Audit",
    description: "Review yesterday's new Shopify products",
    icon: ClipboardCheck,
  },
];

export function getToolById(
  id: SidepanelToolId,
): SidepanelToolMetadata | undefined {
  return SIDEPANEL_TOOLS.find((tool) => tool.id === id);
}

export function getToolLabel(id: SidepanelToolId): string {
  return getToolById(id)?.label || id;
}

export function isSidepanelToolId(value: string): value is SidepanelToolId {
  return SIDEPANEL_TOOLS.some((tool) => tool.id === value);
}
