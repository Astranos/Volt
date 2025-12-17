import {
  Gamepad2,
  Calculator,
  Link as LinkIcon,
  Boxes,
  Tag,
  Layers,
  ShoppingBag,
  LucideIcon,
  Shapes,
  HelpCircle,
  LineChart,
  Search,
  LayoutList,
} from "lucide-react";

export type SidepanelToolId =
  | "controller-testing"
  | "top-offers"
  | "quick-links"
  | "pc-cost-breakdown"
  | "ebay-sold-tool"
  | "ebay-taxonomy-tool"
  | "buying-guide"
  | "shopify-help"
  | "price-charting-tool"
  | "tabs-manager";

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
    id: "quick-links",
    label: "Quick Links",
    description: "Open quick links in the sidepanel",
    icon: LinkIcon,
  },
  {
    id: "pc-cost-breakdown",
    label: "Breakdown Listing",
    description: "Open cost breakdown in the sidepanel",
    icon: Shapes,
  },
  {
    id: "ebay-sold-tool",
    label: "eBay Pricing",
    description: "Open eBay sold listings tool in the sidepanel",
    icon: Tag,
  },
  {
    id: "price-charting-tool",
    label: "PriceCharting Lot",
    description: "Search and build game lots with PriceCharting",
    icon: LineChart,
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
    id: "tabs-manager",
    label: "Tabs Manager",
    description: "View and manage open tabs",
    icon: LayoutList,
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
