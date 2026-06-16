import {
  Calculator,
  LucideIcon,
  HelpCircle,
  Smartphone,
} from "lucide-react";

export type SidepanelToolId =
  | "top-offers"
  | "shopify-help"
  | "mobile-scanner"
  | "mobile-photos";

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
    id: "shopify-help",
    label: "Shopify Help",
    description: "View Shopify tags and sales channels guide",
    icon: HelpCircle,
  },
  {
    id: "mobile-scanner",
    label: "Mobile Scanner",
    description: "Scan barcodes with your phone",
    icon: Smartphone,
  },
];

export function getToolById(
  id: SidepanelToolId
): SidepanelToolMetadata | undefined {
  return SIDEPANEL_TOOLS.find((tool) => tool.id === id);
}

export function getToolLabel(id: SidepanelToolId): string {
  return getToolById(id)?.label || id;
}

export function isSidepanelToolId(value: string): value is SidepanelToolId {
  return SIDEPANEL_TOOLS.some((tool) => tool.id === value);
}
