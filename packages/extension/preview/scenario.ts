import type { ReactNode } from "react";
import type { ChromeFixture } from "./chrome-stub";

export type Scenario = {
  /** One line, shown by `pnpm shots --list`. */
  description: string;
  viewport: { width: number; height: number };
  /** Capture the whole scrollable page instead of just the viewport. */
  fullPage?: boolean;
  chrome?: ChromeFixture;
  /** `params` is the scenario's query string, e.g. `scanner-history?state=loading`. */
  render: (params: URLSearchParams) => ReactNode;
  /** Runs after the first render and before capture, e.g. to type a search. */
  act?: (params: URLSearchParams) => Promise<void>;
};

export const defineScenario = (scenario: Scenario) => scenario;
