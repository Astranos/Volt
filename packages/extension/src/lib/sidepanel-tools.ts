import {
  Gamepad2,
  Calculator,
  Layers,
  ShoppingBag,
  LucideIcon,
  HelpCircle,
  Smartphone,
} from "lucide-react";

export type SidepanelToolId =
  | "controller-testing"
  | "top-offers"
  | "ebay-taxonomy-tool"
  | "buying-guide"
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
    id: "controller-testing",
    label: "Controller Testing",
    description: "Open controller testing in the sidepanel",
    icon: Gamepad2,
  },
  {
    id: "top-offers",
    label: "Top Offer Calculator",
    description: "Open top offer calculator in the sidepanel",
    icon: Calculator,
  },
  {
    id: "ebay-taxonomy-tool",
    label: "eBay Categories",
    description: "Search eBay categories",
    icon: Layers,
  },
  {
    id: "buying-guide",
    label: "Buying Guide",
    description: "View buying requirements and guidelines",
    icon: ShoppingBag,
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
