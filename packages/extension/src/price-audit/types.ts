export type AuditItem = {
  id: string;
  title: string;
  variant: string;
  sku: string;
  description: string;
  url: string;
  priceCents: number;
  currency: "USD";
};

export type PriceCandidate = { id: string; text: string; cents: number };
export type ListingCandidate = {
  id: string;
  url: string;
  text: string;
  prices: PriceCandidate[];
};

export type SoldComparable = {
  id: string;
  url: string;
  text: string;
  priceCents: number;
  confidence: number;
};

export type AuditAssessment =
  | { kind: "insufficient"; reason: string }
  | {
      kind: "high" | "low" | "fair";
      medianCents: number;
      lowCents: number;
      highCents: number;
      differencePercent: number;
    };

export type ItemResult = {
  item: AuditItem;
  comparables: SoldComparable[];
  assessment: AuditAssessment;
  searchUrl: string | null;
  checkedAt: string;
  note: string;
};

export type AuditSettings = {
  storeUrl: string;
  tolerancePercent: number;
  maxSearchPages: number;
};

export type AuditSnapshot = {
  status: "idle" | "running" | "stopping" | "stopped" | "complete" | "error";
  phase: string;
  total: number;
  processed: number;
  catalogComplete: boolean;
  results: ItemResult[];
  error: string | null;
  startedAt: string | null;
  requests: number;
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
export type ChoiceAnswer = { choice: string; confidence: number };
export type JevClient = {
  choose: (
    state: unknown,
    questions: Record<string, ChoiceQuestion>,
    signal: AbortSignal,
  ) => Promise<Record<string, ChoiceAnswer>>;
};

export type AuditDecisions = {
  reviewItem: (item: AuditItem, signal: AbortSignal) => Promise<boolean>;
  chooseQuery: (item: AuditItem, signal: AbortSignal) => Promise<string | null>;
  selectComparables: (item: AuditItem, candidates: ListingCandidate[], signal: AbortSignal) => Promise<SoldComparable[]>;
  verifyResult: (item: AuditItem, comparables: SoldComparable[], signal: AbortSignal) => Promise<boolean>;
  chooseNextPage: (links: { id: string; text: string; url: string }[], signal: AbortSignal) => Promise<string | null>;
};
