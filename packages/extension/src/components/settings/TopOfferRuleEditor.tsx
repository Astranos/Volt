import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  formatCurrency,
  getRatePercentage,
  percentageFromInputValue,
  percentageToInputValue,
} from "@/src/domain/top-offers";
import type { OfferRateTable, RateRule } from "@/src/types/settings";

// Sales price | % of sale | vs. guide | delete — mirrors the printed Max Offer Guide.
const ROW_GRID =
  "grid grid-cols-[15rem_10rem_minmax(0,1fr)_2.5rem] items-center gap-3 px-3";

const INPUT_CLASS =
  "w-full py-1.5 border border-border rounded-lg bg-background text-sm font-semibold tabular-nums focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors";

interface RateRuleEditorProps {
  title?: string;
  headerAction?: ReactNode;
  valueLabel?: string;
  /** Standard guide to compare against, shown as "+10% over guide". */
  guide?: OfferRateTable;
  rules: RateRule[];
  defaultPercentage: number;
  onRuleChange: (
    index: number,
    field: keyof RateRule,
    value: number
  ) => void;
  onSortRules: () => void;
  onAddRule: () => void;
  onRemoveRule: (index: number) => void;
  onDefaultPercentageChange: (value: number) => void;
}

const money = (value: number) => `$${formatCurrency(value)}`;

export function RateRuleEditor({
  title,
  headerAction,
  valueLabel = "Max cash % of sale",
  guide,
  rules,
  defaultPercentage,
  onRuleChange,
  onSortRules,
  onAddRule,
  onRemoveRule,
  onDefaultPercentageChange,
}: RateRuleEditorProps) {
  const lastThreshold = rules[rules.length - 1]?.threshold;
  // Guide rates across [from, to); a row can span several guide tiers.
  const guideRates = (from: number, to: number) =>
    guide
      ? [from, ...guide.rules.map((rule) => rule.threshold).filter((t) => t > from && t < to)]
          .map((price) => getRatePercentage(price, guide.rules, guide.defaultPercentage))
      : undefined;
  const topLabel =
    lastThreshold === undefined ? "All sales prices" : `${money(lastThreshold)} & up`;

  return (
    <div>
      {(title || headerAction) && (
        <div className="mb-3 flex items-center justify-between gap-4">
          {title ? <h3 className="font-semibold text-lg">{title}</h3> : <div />}
          {headerAction}
        </div>
      )}
      <RateTableHeader valueLabel={valueLabel} showGuide={Boolean(guide)} />
      <div className="space-y-1">
        <RateTableRow
          label={topLabel}
          ariaLabel={`${valueLabel}, ${topLabel}`}
          value={defaultPercentage}
          guideValues={guideRates(lastThreshold ?? 0, Infinity)}
          onChange={onDefaultPercentageChange}
        />
        {rules
          .map((rule, index) => ({ rule, index }))
          .reverse()
          .map(({ rule, index }) => {
            const from = index === 0 ? 0 : rules[index - 1].threshold;
            // Thresholds are exclusive ("under 500"), so a middle tier reads
            // like the paper: "$200 – $499".
            const offset = index === 0 ? 0 : 1;
            const rangeLabel =
              index === 0
                ? `Under ${money(rule.threshold)}`
                : `${money(from)} – ${money(rule.threshold - 1)}`;
            return (
              <RateTableRow
                key={index}
                ariaLabel={`${valueLabel}, ${rangeLabel}`}
                label={
                  <>
                    <span className="w-16">{index === 0 ? "Under" : `${money(from)} –`}</span>
                    <span className="relative w-24">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <input
                        type="number"
                        aria-label={`Price tier ${index + 1} upper bound`}
                        step="1"
                        value={rule.threshold - offset}
                        onChange={(event) => {
                          // Whole dollars keep the "$200 – $499" ranges exact.
                          const value = Math.round(parseFloat(event.target.value));
                          if (Number.isFinite(value)) {
                            onRuleChange(index, "threshold", value + offset);
                          }
                        }}
                        onBlur={onSortRules}
                        className={`${INPUT_CLASS} pl-6 pr-2`}
                      />
                    </span>
                  </>
                }
                value={rule.percentage}
                guideValues={guideRates(from, rule.threshold)}
                onChange={(value) => onRuleChange(index, "percentage", value)}
                onRemove={() => onRemoveRule(index)}
              />
            );
          })}
      </div>
      <div className="pt-2">
        <button
          onClick={onAddRule}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add price tier
        </button>
      </div>
    </div>
  );
}

export function RateTableHeader({
  valueLabel = "Max cash % of sale",
  showGuide = false,
}: {
  valueLabel?: string;
  showGuide?: boolean;
}) {
  return (
    <div
      className={`${ROW_GRID} mb-1 border-b-2 border-foreground/80 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
    >
      <div>Sales price</div>
      <div>{valueLabel}</div>
      <div>{showGuide ? "vs. guide" : null}</div>
      <div />
    </div>
  );
}

export function RateTableRow({
  label,
  ariaLabel,
  value,
  guideValues,
  onChange,
  onRemove,
}: {
  label: ReactNode;
  ariaLabel: string;
  value: number;
  guideValues?: number[];
  onChange: (value: number) => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`${ROW_GRID} rounded-lg py-1.5 even:bg-muted/60`}>
      <div className="flex items-center gap-2 text-sm font-semibold">{label}</div>
      <div className="relative">
        <input
          type="number"
          step="0.1"
          min="0"
          max="100"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={percentageToInputValue(value)}
          onChange={(event) => {
            const percentage = parseFloat(event.target.value);
            if (Number.isFinite(percentage)) {
              onChange(percentageFromInputValue(percentage));
            }
          }}
          className={`${INPUT_CLASS} pl-3 pr-7`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          %
        </span>
      </div>
      <div>
        {guideValues === undefined ? null : (
          <GuideDelta value={value} guideValues={guideValues} />
        )}
      </div>
      <div className="flex justify-end">
        {onRemove ? (
          <button
            onClick={onRemove}
            aria-label="Remove price tier"
            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function GuideDelta({ value, guideValues }: { value: number; guideValues: number[] }) {
  const deltas = guideValues.map(
    (guideValue) => Math.round(percentageToInputValue(value - guideValue) * 10) / 10
  );
  const low = Math.min(...deltas);
  const high = Math.max(...deltas);
  if (low === 0 && high === 0) {
    return <span className="text-xs text-muted-foreground">Same as guide</span>;
  }
  const signed = (delta: number) => `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}%`;
  const text =
    low === high
      ? `${signed(low)} ${low > 0 ? "over" : "under"} guide`
      : low >= 0
        ? `+${low}–${high}% over guide`
        : high <= 0
          ? `−${Math.abs(high)}–${Math.abs(low)}% under guide`
          : `${signed(low)} to ${signed(high)} vs. guide`;
  return (
    <span
      className={
        low >= 0
          ? "rounded-md bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800"
          : "rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
      }
    >
      {text}
    </span>
  );
}
