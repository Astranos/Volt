import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { RateRule } from "@/src/types/settings";

interface RateRuleEditorProps {
  title?: string;
  headerAction?: ReactNode;
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

export function RateRuleEditor({
  title,
  headerAction,
  rules,
  defaultPercentage,
  onRuleChange,
  onSortRules,
  onAddRule,
  onRemoveRule,
  onDefaultPercentageChange,
}: RateRuleEditorProps) {
  return (
    <div>
      {(title || headerAction) && (
        <div className="mb-4 flex items-center justify-between gap-4">
          {title ? <h3 className="font-semibold text-lg">{title}</h3> : <div />}
          {headerAction}
        </div>
      )}
      <div className="space-y-3">
        <RateRuleHeader />
        {rules.map((rule, index) => (
          <div key={index} className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-5">
              <input
                type="number"
                value={rule.threshold}
                onChange={(event) =>
                  onRuleChange(
                    index,
                    "threshold",
                    parseFloat(event.target.value)
                  )
                }
                onBlur={onSortRules}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
            <div className="col-span-5">
              <input
                type="number"
                step="0.01"
                value={rule.percentage}
                onChange={(event) =>
                  onRuleChange(
                    index,
                    "percentage",
                    parseFloat(event.target.value)
                  )
                }
                className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>
            <div className="col-span-2 flex justify-end">
              <button
                onClick={() => onRemoveRule(index)}
                className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        <DefaultPercentageRow
          value={defaultPercentage}
          onChange={onDefaultPercentageChange}
        />
        <div className="pt-2">
          <button
            onClick={onAddRule}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>
    </div>
  );
}

export function RateRuleHeader() {
  return (
    <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground px-2">
      <div className="col-span-5">Under Amount ($)</div>
      <div className="col-span-5">Percentage (0.1 = 10%)</div>
      <div className="col-span-2"></div>
    </div>
  );
}

export function DefaultPercentageRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-4 items-center pt-2">
      <div className="col-span-5 text-sm font-medium pl-2">
        Everything else
      </div>
      <div className="col-span-5">
        <input
          type="number"
          step="0.01"
          value={value}
          onChange={(event) => onChange(parseFloat(event.target.value))}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        />
      </div>
      <div className="col-span-2"></div>
    </div>
  );
}
