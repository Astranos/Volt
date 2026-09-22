export type ToolTabMeasurement = {
  offsetLeft: number;
  offsetWidth: number;
};

export type ToolTabIndicator = {
  x: number;
  width: number;
  visible: boolean;
};

export function computeToolTabIndicator(
  tabs: ToolTabMeasurement[] | null | undefined,
  activeIndex: number,
): ToolTabIndicator {
  if (!tabs || !Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= tabs.length) {
    return { x: 0, width: 0, visible: false };
  }

  const tab = tabs[activeIndex];
  if (!tab || !Number.isFinite(tab.offsetLeft) || !Number.isFinite(tab.offsetWidth)) {
    return { x: 0, width: 0, visible: false };
  }

  return {
    x: Math.max(0, tab.offsetLeft),
    width: Math.max(0, tab.offsetWidth),
    visible: true,
  };
}
